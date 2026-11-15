"""Oyunlaştırma motoru: olay yolundan gelen olayları idempotent ödüllere çevirir.

Akış (araştırma D.1): olay → kural → ödül (deterministik anahtar) → tek SQLite işlemi (defter → azalma → toplam →
seviye → başarım → görev → jeton) → `game.*` olayları. Motor değişmez; yalnızca olaylar okunur.

İlkeler (araştırma A.1/A.2): XP hacimden değil kaliteden gelir; hiçbir değer düşmez; onay ve ret eşit XP alır;
oyun verisi ajan istemlerine girmez; süre baskısı, seri ve kayıp yoktur.

İş parçacığı: `handle()` ve HTTP eylemleri `self._lock` altında yürür; `bus.publish` yalnızca olay döngüsünde
çağrılır (api.py dönen olayları yayınlar).
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import sqlite3
import statistics
import threading
import time
import uuid
import zlib
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable, NamedTuple

from studio._edition import EDITION

from studio import admin as admin_mode
from studio.game import catalog as C
from studio.game import rules as R
from studio.game.db import GameDB
from studio.game.en_xp import xp_reason_en
from studio.office.ranks import rank_label

if TYPE_CHECKING:
    from studio.api import Studio

log = logging.getLogger("studio.game")

HUMAN = ("human", "me")
OFFICE = ("office", "office")
AGENT_STEP_TYPES = ("agent", "delegate")
TOOL_KINDS = {"web", "read", "shell", "plan", "write"}
UI_SIGNALS = ("context.opened", "species.previewed")
_EXT_END = re.compile(r"(?:end|ended|stop|stopped|finish|finished|complete|completed|done|closed)$")


class ConfirmRequired(ValueError):
    pass


class StoreSet(NamedTuple):
    """Jetonla da alınabilen kozmetik set (2026-10-19 gece kararı: aynı eşya parayla da, jetonla da). `game/` set
    kataloğunu içe AKTARMAZ: `cosmetics.catalog` açılışta kaydeder (bağımlılık yönü cosmetics → game). `owned`
    giyilebilir sahip olunan parçaları döner (para hakkı iade edilmiş parça sahip sayılmaz); yoksa envanter okunur."""
    id: str                                   # store:<set>
    label: str
    coin_price: int                           # [H] jeton; para fiyatından TÜRETİLMEZ (sabit kur yok)
    pieces: tuple[str, ...]                   # store:<set>-<parça>
    owned: Callable[["GameService"], set[str]] | None = None
    enabled: Callable[["GameService"], bool] | None = None   # bayrak (store.cosmetics_enabled); kapalıyken satılmaz


STORE_SETS: dict[str, StoreSet] = {}
# `store:*` set ve parça adları (TR, EN). `cosmetics` açılışta kaydeder (bağımlılık yönü cosmetics → game);
# kilit açma bildirimi ham kimlik ("store:garden-lab-seed-shower") yerine parçanın adını gösterir.
STORE_LABELS: dict[str, tuple[str, str]] = {}


def register_store_labels(labels: dict[str, tuple[str, str]]) -> None:
    for k, (tr, en) in labels.items():
        if isinstance(k, str) and k.startswith("store:") and isinstance(tr, str) and tr:
            STORE_LABELS[k] = (tr, en if isinstance(en, str) and en else tr)


def item_labels(item_id: str) -> tuple[str, str]:
    """Öğe adı (TR, EN): dükkân kataloğu, kayıtlı `store:*` adları; bilinmiyorsa kimlik (her iki dilde)."""
    item = C.SHOP_BY_ID.get(item_id)
    if item is not None:
        return item.label_tr, item.label_en or item.label_tr
    return STORE_LABELS.get(item_id, (item_id, item_id))


def register_store_set(s: StoreSet) -> None:
    if not s.id.startswith("store:") or not s.pieces or any(not p.startswith(f"{s.id}-") for p in s.pieces):
        raise ValueError("Geçersiz kozmetik set kaydı")
    if isinstance(s.coin_price, bool) or not isinstance(s.coin_price, int) or s.coin_price <= 0:
        raise ValueError("Geçersiz kozmetik set kaydı")
    STORE_SETS[s.id] = s


class InsufficientCoins(ValueError):
    pass


class RunCtx:
    """Bir çalıştırmanın kurallar için gereken bağlamı (adımlar, turlar, araç sonuçları, teslimler, kararlar)."""

    def __init__(self, run_id: str):
        self.id = run_id
        self.kind = "task"
        self.workflow = ""
        self.title = ""
        self.input_sig = ""
        self.steps: dict[str, dict[str, Any]] = {}
        self.started: dict[str, float] = {}
        self.route: dict[str, dict[str, Any]] = {}
        self.status: dict[str, str] = {}
        self.output: dict[str, str] = {}
        self.tokens: dict[str, int] = {}
        self.rounds: dict[str, int] = {}
        self.warned: set[str] = set()
        self.tools: dict[str, list[bool]] = {}
        self.kinds: dict[str, set[str]] = {}
        self.artifacts: dict[str, int] = {}
        self.handoffs: list[tuple[str, str, str]] = []
        self.decisions: dict[str, bool] = {}

    def add_step(self, s: dict[str, Any]) -> None:
        sid = str(s.get("id") or "")
        if not sid:
            return
        cur = self.steps.setdefault(sid, {})
        for k in ("type", "agent", "depends_on", "revise", "parent", "title"):
            if s.get(k) is not None:
                cur[k] = s[k]
        cur.setdefault("type", "agent")
        cur.setdefault("depends_on", [])


def _data_dir(studio: Any) -> Path:
    changes = getattr(studio, "changes", None)
    if changes is not None and getattr(changes, "data_dir", None):
        return Path(changes.data_dir)
    from studio.config import DATA_DIR
    return Path(DATA_DIR)


def _tokens_total(tokens: Any) -> int:
    if not isinstance(tokens, dict):
        return 0
    total = tokens.get("total")
    if isinstance(total, (int, float)) and total > 0:
        return int(total)
    return int(sum(v for k, v in tokens.items() if k in ("input", "output") and isinstance(v, (int, float))))


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).isoformat(timespec="seconds")


class GameService:
    def __init__(self, studio: "Studio", data_dir: str | Path | None = None):
        self.studio = studio
        self.db = GameDB(Path(data_dir or _data_dir(studio)) / "game.sqlite")
        self._lock = threading.RLock()
        self._runs: OrderedDict[str, RunCtx] = OrderedDict()
        self._out: list[tuple[str, dict[str, Any]]] = []
        self._xp_acc: dict[tuple[str, str], dict[str, Any]] = {}
        self._graph: list[tuple[str, str, C.Achievement, int, float]] = []
        self._agents: dict[str, dict[str, Any]] = {}
        self._demo: set[str] = set()  # S40 demo ajan slug'ları (yönetici modu; hiçbir ödül yazılmaz)
        self._replay = False
        self._facts: dict[str, Any] = {}
        self._facts_at = 0.0
        self._signals: list[float] = []
        self._read_conn: sqlite3.Connection | None = None
        self._quest_period = ""
        self.bootstrap()

    # ================================================================ kurulum
    def bootstrap(self) -> None:
        with self._lock:
            self._refresh_agents()
            now = time.time()
            with self.db.tx():
                if self.db.meta("created_at") is None:
                    self.db.set_meta("created_at", now)
                    self.db.set_meta("rule_version", R.RULE_VERSION)
                    existing = self._has_history()
                    self.db.set_meta("migrated", 1 if existing else 0)
                    studio_agents = [a for a in self._agents.values() if a.get("created_by") == "studio"
                                     and not a.get("hired_by")]
                    self.db.set_meta("agents_baseline", 0 if existing else len(studio_agents))
                    if existing:
                        # Geçiş (B.11): oyunlaştırmadan önce var olan tüm kozmetikler açık kalır; hiçbir şey kilitlenmez.
                        for item in C.SHOP:
                            if item.legacy:
                                self.db.grant(item.id, "migration", now)
                        self._unlock(C.ACH_BY_ID["kurucu_ekip"], 1, *HUMAN, now)
                if self.db.meta("xp_basis") != R.XP_BASIS:
                    # G2-D (R-2) geçişi: var olan XP, seviye, jeton ve başarımlar OLDUĞU GİBİ kalır (hiçbir şey geri
                    # alınmaz, yeniden hesaplanmaz). Yalnız bu andan sonraki ajan XP'si kullanıcı kabulünü bekler;
                    # eski kuralla zaten yazılmış bir adım (aynı anahtar) ikinci kez ödül almaz.
                    self.db.set_meta("xp_basis", R.XP_BASIS)
                    self.db.set_meta("xp_basis_since", now)
                for slug, info in self._agents.items():
                    if self.db.meta(f"avatar:{slug}") is None:
                        self.db.set_meta(f"avatar:{slug}", self._avatar_sig(info.get("avatar")))
                self._check_state(now)
                self._backfill_rewards(now)
                self._wardrobe(now)
            self._drain()  # açılışta kutlama yok

    def _backfill_rewards(self, ts: float) -> None:
        """QA SP-QA-01: ödülü sonradan eklenen bir başarımı (ör. premium sahne) önceden kazanmış olan da ödülü alır."""
        for row in self.db.q("SELECT DISTINCT achievement_id FROM game_achievements"):
            ach = C.ACH_BY_ID.get(row["achievement_id"])
            if ach and ach.reward_item and not self.db.owns(ach.reward_item):
                self._grant(ach.reward_item, "achievement", ts)

    def _has_history(self) -> bool:
        try:
            return bool(self.studio.store.nodes("Run", limit=1))
        except Exception:  # noqa: BLE001
            return False

    def close(self) -> None:
        if self._read_conn is not None:
            try:
                self._read_conn.close()
            except Exception:  # noqa: BLE001
                pass
        self.db.close()

    # ================================================================ ajan önbelleği
    @staticmethod
    def _agent_info(a: dict[str, Any]) -> dict[str, Any]:
        return {"slug": a.get("slug"), "name": a.get("name") or a.get("slug"), "team": a.get("team") or None,
                "rank": a.get("rank") or None, "avatar": a.get("avatar") or {}, "created_by": a.get("created_by"),
                "hired_by": a.get("hired_by") or None, "connection": a.get("connection"),
                "hidden": bool(a.get("hidden"))}

    def _refresh_agents(self) -> None:
        try:
            # S40: yönetici modunun demo ajanları oyunda yok sayılır (sayaç, başarım, XP yazılmaz)
            agents = self.studio.agents.list()
            self._agents = {a["slug"]: self._agent_info(a) for a in agents if a.get("demo") is not True}
            self._demo = {str(a["slug"]) for a in agents if a.get("demo") is True}
        except Exception:  # noqa: BLE001 - graf erişilemezse önbellek korunur
            pass

    def _is_demo(self, slug: Any) -> bool:
        """S40: demo ajan mı? Demo/test eylemleri deftere, jetona, envantere ve başarımlara hiçbir şey yazmaz.
        Önbellekte olmayan slug için graf okunur (demo ajanlar önbellek yenilenmeden de eklenebilir)."""
        if not slug:
            return False
        slug = str(slug)
        if slug in self._demo:
            return True
        if slug in self._agents:
            return False
        try:
            node = self.studio.agents.node(slug)
        except Exception:  # noqa: BLE001 - graf erişilemezse demo sayılmaz
            return False
        if node and node["props"].get("demo") is True:
            self._demo.add(slug)
            return True
        return False

    def _demo_run(self, ctx: RunCtx | None) -> bool:
        """Koşunun ajanlı adımlarının tümü demo ajansa koşu düzeyi ödüller (başlatma, başarı, ofis) yazılmaz."""
        if ctx is None:
            return False
        agents = {d.get("agent") for d in ctx.steps.values() if d.get("agent")}
        return bool(agents) and all(self._is_demo(a) for a in agents)

    def _name(self, slug: str | None) -> str:
        if not slug:
            return "Ajan"
        return str((self._agents.get(slug) or {}).get("name") or slug)

    @staticmethod
    def _avatar_sig(avatar: Any) -> str:
        return json.dumps(avatar or {}, sort_keys=True, ensure_ascii=False)

    def _scene(self) -> str | None:
        if self._replay:
            return None
        try:
            scene = str(self.studio.settings.get("scene") or "") or None
        except Exception:  # noqa: BLE001
            return None
        # S40: yalnızca yönetici/test moduyla açılan sahne, sahneye bağlı ödül/görev sayacı üretmez (atla, verme).
        # Mod kapandıktan sonra (ör. mod kapatıldı) da geçerli (AUDIT B-04)
        if scene and not self.is_owned(f"scene:{scene}", bypass=False):
            return None
        return scene

    # ================================================================ olay girişi
    def handle(self, ev: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
        """Tek bir olay yolu olayını işler; yayınlanacak `game.*` olaylarını döndürür."""
        etype = str(ev.get("type") or "")
        if etype not in _HANDLERS and not etype.startswith("ext."):
            return []  # akış olayları (step.delta vb.) ve kendi game.* olaylarımız: yazma işlemi açma
        ts = float(ev.get("ts") or time.time())
        with self._lock:
            try:
                with self.db.tx():
                    self._dispatch(etype, ev, ts)
            except Exception:  # noqa: BLE001 - oyun hatası stüdyoyu bozmamalı
                log.exception("oyun olayı işlenemedi: %s", etype)
                self._xp_acc.clear()
                self._out.clear()
                return []
            return self._drain()

    def _is_practice(self, etype: str, ev: dict[str, Any]) -> bool:
        """Akademi alıştırma koşusu mu? (demo; ajan XP'si, görev ve insan kararı puanı üretmez — ders ödülü ayrıdır)"""
        rid = ev.get("run_id")
        if not rid:
            return False
        detail = ev.get("detail") if isinstance(ev.get("detail"), dict) else {}
        if str(detail.get("workflow") or "") in R.PRACTICE_WORKFLOWS:
            ctx = self._ctx(str(rid))  # sonraki adım olayları da tanınsın diye bağlamı akış adıyla işaretle
            if ctx is not None:
                ctx.workflow = str(detail["workflow"])
            return True
        ctx = self._runs.get(str(rid))
        if ctx is None and etype != "run.started":
            ctx = self._ctx(str(rid))
        return bool(ctx and ctx.workflow in R.PRACTICE_WORKFLOWS)

    def _dispatch(self, etype: str, ev: dict[str, Any], ts: float) -> None:
        if ev.get("hidden"):
            return  # AUDIT P1: gizli sistem koşusu (ör. kalite denetçisi) oyun ödülü/XP üretmez
        if self._is_practice(etype, ev):
            return
        handler = _HANDLERS.get(etype)
        if handler is not None:
            handler(self, ev, ts)
        elif etype.startswith("ext."):
            self._on_ext(ev, ts)

    def _emit(self, etype: str, **payload: Any) -> None:
        if not self._replay:
            self._out.append((etype, payload))

    def _drain(self) -> list[tuple[str, dict[str, Any]]]:
        out: list[tuple[str, dict[str, Any]]] = []
        for (st, sid), acc in self._xp_acc.items():
            xp, level = self.db.state(st, sid)
            prog = R.progress(xp, level)
            reason = " · ".join(dict.fromkeys(acc["reasons"]))[:200]
            if not self._replay:
                out.append(("game.xp", {"agent": sid if st == "agent" else None, "subject_type": st, "subject": sid,
                                         "amount": acc["amount"], "reason": reason,
                                         "reason_en": xp_reason_en(reason), "total": xp,
                                         "level": prog["level"], "progress": prog["progress"],
                                         "xp_to_next": prog["xp_to_next"]}))
                who = "Sen" if st == "human" else self._name(sid) if st == "agent" else sid
                self.db.feed(time.time(), "xp", st, sid, f"{who} +{acc['amount']} XP · {reason}", acc["amount"])
        self._xp_acc.clear()
        out += self._out
        self._out = []
        return [] if self._replay else out

    # ================================================================ bağlam
    def _ctx(self, run_id: str | None) -> RunCtx | None:
        if not run_id:
            return None
        ctx = self._runs.get(run_id)
        if ctx is None:
            ctx = RunCtx(run_id)
            if not self._replay:
                self._fill_from_engine(ctx)
            self._runs[run_id] = ctx
            while len(self._runs) > 300:
                self._runs.popitem(last=False)
        else:
            self._runs.move_to_end(run_id)
        return ctx

    def _fill_from_engine(self, ctx: RunCtx) -> None:
        """Tüketici çalıştırmanın ortasında başladıysa adım listesini motordan al (salt okuma)."""
        try:
            data = self.studio.engine.get_run(ctx.id)
        except Exception:  # noqa: BLE001
            data = None
        if data:
            self._load_detail(ctx, data)

    @staticmethod
    def _load_detail(ctx: RunCtx, detail: dict[str, Any]) -> None:
        ctx.kind = str(detail.get("kind") or ctx.kind)
        ctx.workflow = str(detail.get("workflow") or ctx.workflow or "")
        ctx.title = str(detail.get("title") or ctx.title or "")
        inputs = detail.get("inputs") or {}
        sig = json.dumps(inputs, sort_keys=True, ensure_ascii=False, default=str)
        ctx.input_sig = sig + ("|" + ctx.title if ctx.kind == "task" else "")
        for s in detail.get("steps") or []:
            if isinstance(s, dict):
                ctx.add_step(s)

    # ================================================================ ödül çekirdeği
    def _xp(self, st: str, sid: str, rule: str, raw: int, idem: str, ts: float, explain: str, *,
            run: str | None = None, step: str | None = None, diminish: bool = False, cap_key: str | None = None,
            verified: bool = False) -> int:
        if self._awarded(idem):
            return 0
        if st == "agent" and rule in R.VERIFIED_RULES and int(raw) > 0 and not verified:
            return self._defer(sid, rule, int(raw), idem, ts, explain, run=run, step=step, diminish=diminish,
                               cap_key=cap_key)
        day = R.day_of(ts)
        raw = max(0, int(raw))
        capped = raw
        if cap_key and capped:
            used = int(self.db.scalar("SELECT COALESCE(SUM(capped),0) FROM game_ledger WHERE cap_key=?", cap_key))
            capped = max(0, min(capped, R.STEP_CAP - used))
        amount = capped
        if diminish and capped:
            before = int(self.db.scalar(
                "SELECT COALESCE(SUM(capped),0) FROM game_ledger WHERE subject_type=? AND subject_id=? AND day=? "
                "AND diminish=1", st, sid, day))
            amount = R.diminish_delta(before, capped)
        text = explain
        if capped < raw:
            text += " · adım tavanı"
        if amount < capped:
            text += f" · günlük azalma: +{amount}"
        self.db.exec(
            "INSERT INTO game_ledger(idem,ts,day,subject_type,subject_id,rule,rule_version,raw,capped,amount,diminish,"
            "cap_key,run_id,step_id,explain) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            idem, ts, day, st, sid, rule, R.RULE_VERSION, raw, capped, amount, 1 if diminish else 0, cap_key, run,
            step, text)
        if amount > 0:
            self._add_xp(st, sid, amount, ts, explain.split(" (")[0])
        return amount

    # ---------------------------------------------------------------- G2-D / R-2: doğrulanmış işe ajan XP'si
    def _awarded(self, idem: str) -> bool:
        """Anahtar deftere yazıldı mı ya da kullanıcı kabulünü mü bekliyor? (H5: revize turu yeniden taban üretmez)"""
        return bool(self.db.one("SELECT 1 FROM game_ledger WHERE idem=?", idem)
                    or self.db.one("SELECT 1 FROM game_pending WHERE idem=?", idem))

    def _defer(self, agent: str, rule: str, raw: int, idem: str, ts: float, explain: str, *, run: str | None,
               step: str | None, diminish: bool, cap_key: str | None) -> int:
        """Koşu sırasında hesaplanan ajan XP'si: deftere değil bekleyen kayda (kabulde verilir). Adım tavanı (H4) burada
        uygulanır; günlük azalma ve ofis adalet tavanı kabul gününe göre `_settle_verified` içinde. Döndürülen 0:
        şimdi XP yok."""
        capped = raw
        if cap_key:
            used = int(self.db.scalar("SELECT COALESCE(SUM(capped),0) FROM game_pending WHERE cap_key=? AND "
                                      "status!='void'", cap_key)) \
                + int(self.db.scalar("SELECT COALESCE(SUM(capped),0) FROM game_ledger WHERE cap_key=?", cap_key))
            capped = max(0, min(raw, R.STEP_CAP - used))
        self.db.exec("INSERT OR IGNORE INTO game_pending(idem,ts,run_id,step_id,agent,rule,raw,capped,diminish,cap_key,"
                     "explain) VALUES(?,?,?,?,?,?,?,?,?,?,?)", idem, ts, str(run or ""), step, agent, rule, raw, capped,
                     1 if diminish else 0, cap_key, explain)
        return 0

    def _record_version(self, aid: str, acc: dict[str, Any], run_id: str) -> str:
        """Kabul kaydını teslimin sürüm zincirine bağlar (kök = ilk sürümün kimliği); kökü döndürür."""
        root = str(acc.get("root_id") or "")
        if not root:
            prev = str(acc.get("previous_id") or "")
            row = self.db.one("SELECT root_id FROM game_versions WHERE acceptance_id=?", prev) if prev else None
            root = row["root_id"] if row else (prev or aid)
        try:
            version = int(acc.get("version") or 1)
        except (TypeError, ValueError):
            version = 1
        if run_id:
            self.db.exec("INSERT INTO game_versions(acceptance_id,root_id,run_id,version) VALUES(?,?,?,?) "
                         "ON CONFLICT(acceptance_id) DO UPDATE SET root_id=excluded.root_id, run_id=excluded.run_id, "
                         "version=excluded.version", aid, root, run_id, version)
        return root

    def _settle_verified(self, root: str, aid: str, run_id: str, ts: float, factor: float = 1.0) -> int:
        """Kullanıcı teslimi kabul etti → bekleyen ajan XP'si o işi yapan ajanlara verilir. Teslim (sürüm zinciri)
        başına BİR kez: yerini yeni sürüm alan eski sürümlerin aynı adım/kural kaydı yalnız en yeni sürümden sayılır
        (çift ödül yok), diğerleri `void` olur. Tavanlar kabul gününe göre uygulanır (`_xp`).
        `factor` kısmi kabulde XP'yi ölçekler (`usable: partial` → yarı); zincir zaten ödüllendirildiyse bu
        koşunun bekleyen satırları `void` olur (sonsuza dek `pending` kalmaz)."""
        if not self.db.once(f"verified:{root}", ts):
            if run_id:
                self.db.exec("UPDATE game_pending SET status='void', settled_at=?, settled_by=? WHERE status='pending' "
                             "AND run_id=?", ts, aid, run_id)
            return 0
        chain = [r["run_id"] for r in self.db.q("SELECT run_id FROM game_versions WHERE root_id=? ORDER BY version, "
                                                "acceptance_id", root)]
        if run_id and run_id not in chain:
            chain.append(run_id)
        order = {rid: i for i, rid in enumerate(dict.fromkeys(chain))}
        if not order:
            return 0
        marks = ",".join("?" * len(order))
        rows = self.db.q(f"SELECT * FROM game_pending WHERE status='pending' AND run_id IN ({marks})", *order)
        chosen: dict[tuple[str, str, str], sqlite3.Row] = {}
        for r in sorted(rows, key=lambda r: (order.get(r["run_id"], 0), r["ts"])):
            chosen[(r["rule"], r["step_id"] or "", r["agent"])] = r   # en yeni sürüm kazanır
        total = 0
        for (rule, step, agent), r in sorted(chosen.items(), key=lambda kv: kv[1]["ts"]):
            if self._is_demo(agent):
                continue
            amount = int(int(r["capped"]) * max(0.0, min(1.0, factor)))
            if amount <= 0:
                continue
            total += self._xp("agent", agent, rule, amount, f"verified:v1:{root}:{rule}:{step}:{agent}", ts,
                              f"{r['explain']} · kabul edildi", run=r["run_id"], step=r["step_id"],
                              diminish=bool(r["diminish"]), cap_key=r["cap_key"], verified=True)
            counter = R.VERIFIED_COUNTERS.get(rule)
            if counter:
                self._bump("agent", agent, counter, f"{r['run_id']}:{step}", ts)
        granted = {r["idem"] for r in chosen.values()}
        for r in rows:
            self.db.exec("UPDATE game_pending SET status=?, settled_at=?, settled_by=? WHERE idem=?",
                         "granted" if r["idem"] in granted else "void", ts, aid, r["idem"])
        return total

    def _add_xp(self, st: str, sid: str, amount: int, ts: float, reason: str) -> None:
        office = st == "office"
        xp, level = self.db.state(st, sid)
        xp += amount
        new_level = max(level, R.level_for(xp, office=office))
        self.db.set_state(st, sid, xp, new_level, ts)
        if not office:
            acc = self._xp_acc.setdefault((st, sid), {"amount": 0, "reasons": []})
            acc["amount"] += amount
            acc["reasons"].append(reason)
        for lv in range(level + 1, new_level + 1):
            self._on_level(st, sid, lv, ts)
        if not office:
            share = self._office_share(amount, ts)  # §6.1: ofis günlük adalet tavanı
            if share > 0:
                self._add_xp(*OFFICE, share, ts, reason)
            self._xp_coins(ts)

    def _office_share(self, amount: int, ts: float) -> int:
        """Ofise giren etkin XP: günün ham ofis toplamına göre `R.office_delta` (ilk 400 %100, 400–800 %50, sonra
        %10). Ham ve etkin günlük toplamlar `game_meta`da tutulur; jeton hedefi etkin toplamdan hesaplanır."""
        day = R.day_of(ts)
        before = int(self.db.meta(f"office_raw:{day}") or 0)
        share = R.office_delta(before, max(0, int(amount)))
        self.db.set_meta(f"office_raw:{day}", before + max(0, int(amount)))
        self.db.set_meta(f"office_eff:{day}", int(self.db.meta(f"office_eff:{day}") or 0) + share)
        return share

    def _xp_coins(self, ts: float) -> None:
        """XP'den jeton (H12): günlük etkin XP / 10; 150 jetondan sonrası %50."""
        day = R.day_of(ts)
        # §6.1: jeton, ofisin adalet tavanlı etkin günlük XP'sinden (150 yumuşak tavanı ofis düzeyinde)
        day_xp = int(self.db.meta(f"office_eff:{day}") or 0)
        target = R.xp_coin_target(day_xp)
        granted = int(self.db.scalar("SELECT COALESCE(SUM(amount),0) FROM game_coins WHERE day=? AND reason='xp'", day))
        if target > granted:
            self.db.add_coins(f"xpcoins:{day}:{target}", ts, day, target - granted, "xp",
                              f"XP'den jeton (+{target - granted})")

    def _on_level(self, st: str, sid: str, level: int, ts: float) -> None:
        day = R.day_of(ts)
        if st == "agent":
            coins = 10 * level
            self.db.add_coins(f"lvl:agent:{sid}:{level}", ts, day, coins, "levelup",
                              f"{self._name(sid)} Sv {level} (+{coins} jeton)", ref=sid)
            band_changed = R.band_index(level) != R.band_index(level - 1)
            title = R.seniority(level)
            self.db.feed(ts, "levelup", st, sid, f"{self._name(sid)} {level}. seviyeye ulaştı · Kıdem: {title}", level)
            self._emit("game.levelup", subject_type=st, subject=sid, agent=sid, name=self._name(sid), level=level,
                       title=title, band_changed=band_changed, coins=coins)
            self._set_max("agent", sid, "level", level, ts)
        elif st == "human":
            title = R.manager_title(level)
            self.db.feed(ts, "levelup", st, sid, f"{level}. seviyeye ulaştın · {title}", level)
            self._emit("game.levelup", subject_type=st, subject=sid, agent=None, name="Sen", level=level,
                       title=title, band_changed=R.manager_title(level - 1) != title, coins=0)
        elif st == "office":
            coins = 50 * level
            self.db.add_coins(f"lvl:office:{level}", ts, day, coins, "levelup", f"Ofis Sv {level} (+{coins} jeton)")
            self.db.feed(ts, "levelup", st, sid, f"Ofis {level}. seviyeye ulaştı", level)
            self._emit("game.levelup", subject_type=st, subject=sid, agent=None, name="Ofis", level=level,
                       title=f"Ofis Sv {level}", band_changed=False, coins=coins)
            for item in C.SHOP:
                if item.unlock_level and item.unlock_level <= level:
                    self._grant(item.id, "level", ts)
            for decor in C.DECOR:  # S35: dekor seviyeden türetilir (envanter yok); seviye bir kez atlandığı için tek bildirim
                if decor.unlock_level == level:
                    self.db.feed(ts, "unlock", None, None, f"Kilit açıldı: {decor.label_tr}", None,
                                 {"item": f"decor:{decor.id}", "source": "level"})
                    self._emit("game.unlock", item=f"decor:{decor.id}", label=decor.label, kind="decor", source="level")
            self._set_max(*OFFICE, "office_level", level, ts)
        else:
            self.db.feed(ts, "levelup", st, sid, f"{sid} {level}. seviyeye ulaştı", level)

    # ---------------------------------------------------------------- sayaçlar ve başarımlar
    def _bump(self, st: str, sid: str, counter: str, key: str | None, ts: float, by: float = 1) -> float | None:
        if key is not None and not self.db.once(f"c:{st}:{sid}:{counter}:{key}", ts):
            return None
        value = self.db.incr(st, sid, counter, by)
        self._check_counter(st, sid, counter, value, ts)
        return value

    def _set_max(self, st: str, sid: str, counter: str, value: float, ts: float) -> None:
        v = self.db.set_max(st, sid, counter, value)
        self._check_counter(st, sid, counter, v, ts)

    def _check_counter(self, st: str, sid: str, counter: str, value: float, ts: float) -> None:
        for ach in C.ACH_BY_COUNTER.get((st, counter), []):
            for i, (threshold, _rarity) in enumerate(ach.tiers):
                if value >= threshold:
                    self._unlock(ach, i + 1, st, sid, ts)

    def _unlock(self, ach: C.Achievement, tier: int, st: str, sid: str, ts: float) -> bool:
        idem = f"ach:{ach.id}:{tier}:{st}:{sid}"
        if self.db.exec("INSERT OR IGNORE INTO game_achievements(subject_type,subject_id,achievement_id,tier,"
                        "unlocked_at,idem,seen) VALUES(?,?,?,?,?,?,?)",
                        st, sid, ach.id, tier, ts, idem, 1 if self._replay else 0) != 1:
            return False
        rarity = ach.tiers[tier - 1][1]
        name = ach.tier_name(tier)
        coins = 0
        if not ach.special:
            coins = R.RARITY_COINS[rarity]
            self.db.add_coins(f"achcoins:{ach.id}:{tier}:{st}:{sid}", ts, R.day_of(ts), coins, "achievement",
                              f"Başarım: {name} (+{coins} jeton)", ref=ach.id)
            xp = R.RARITY_XP[rarity]
            target = (st, sid) if st == "agent" else HUMAN
            self._xp(*target, "achievement", xp, f"achxp:{ach.id}:{tier}:{st}:{sid}", ts, f"Başarım: {name} (+{xp})")
        if ach.reward_item:
            self._grant(ach.reward_item, "achievement", ts)
        self._graph.append((st, sid, ach, tier, ts))
        who = self._name(sid) if st == "agent" else "Ofis" if st == "office" else "Sen"
        self.db.feed(ts, "achievement", st, sid, f"{who}: {name} ({R.RARITY_LABEL[rarity]})", coins,
                     {"achievement": ach.id, "tier": tier})
        # DECB-FIX: iki dilde ad ve açıklama; arayüz kendi diline göre seçer (olay arka planda, istek dili yok)
        self._emit("game.achievement", achievement=ach.id, tier=tier, name=name, description=ach.description,
                   name_tr=ach.tier_name(tier, "tr"), name_en=ach.tier_name(tier, "en"),
                   description_tr=ach.description_tr, description_en=ach.description_en or ach.description_tr,
                   rarity=rarity, icon=ach.icon, category=ach.category, subject_type=st, subject=sid,
                   agent=sid if st == "agent" else None, who=who, coins=coins, hidden=ach.hidden)
        return True

    def _grant(self, item_id: str, source: str, ts: float) -> bool:
        if not self.db.grant(item_id, source, ts):
            return False
        item = C.SHOP_BY_ID.get(item_id)
        label_tr, label_en = item_labels(item_id)  # ham `store:*` kimliği değil, parçanın adı
        label = item.label if item else label_tr
        self.db.feed(ts, "unlock", None, None, f"Kilit açıldı: {label_tr}", None, {"item": item_id, "source": source})
        # olay arka planda (istek dili yok): iki dilde ad, arayüz kendi diline göre seçer (DECB-FIX deseni)
        self._emit("game.unlock", item=item_id, label=label, label_tr=label_tr, label_en=label_en,
                   kind=item.kind if item else "cosmetic", source=source)
        if item and item.kind in ("cosmetic", "celebration"):
            self._wardrobe(ts)
        return True

    def _wardrobe(self, ts: float) -> None:
        owned = sum(1 for i in C.SHOP if i.kind in ("cosmetic", "celebration") and self.db.owns(i.id))
        self._set_max(*HUMAN, "wardrobe", len(C.STARTER_COSMETICS) + owned, ts)

    def _active_day(self, ts: float) -> None:
        self._bump(*HUMAN, "active_days", R.day_of(ts), ts)

    def _human(self, rule: str, idem: str, ts: float, label: str, *, run: str | None = None,
               step: str | None = None) -> int:
        """Yönetici XP'si (B.3); günlük sınır aşılırsa defterde 0 XP ile görünür (şeffaflık)."""
        xp, cap = R.HUMAN_RULES[rule]
        if cap is not None:
            used = int(self.db.scalar("SELECT COUNT(*) FROM game_ledger WHERE rule=? AND subject_type='human' AND "
                                      "day=? AND amount>0", rule, R.day_of(ts)))
            if used >= cap:
                return self._xp(*HUMAN, rule, 0, idem, ts, f"{label}: günlük sınır doldu", run=run, step=step)
        return self._xp(*HUMAN, rule, xp, idem, ts, f"{label} (+{xp})", run=run, step=step)

    def award_academy_lesson(self, lesson_id: str, title: str) -> list[tuple[str, dict[str, Any]]]:
        """S31 Akademi: ders gerçek eylemle bitti → ders başına bir kez yönetici XP'si + "Akademi" başarım sayacı.

        Anahtarlar deterministiktir (academy:v1:<ders>, c:…:academy_lessons:<ders>); yeniden denetim, tekrar
        oynatma ya da yeniden başlatma ikinci kez ödül vermez. Yayınlanacak `game.*` olaylarını döndürür."""
        ts = time.time()
        with self._lock:
            with self.db.tx():
                self._human("academy_lesson", f"academy:v1:{lesson_id}", ts, f"Akademi dersi: {title}")
                self._bump(*HUMAN, "academy_lessons", lesson_id, ts)
            return self._drain()

    def _zeroed(self, run_id: str, sid: str) -> bool:
        return self.db.one("SELECT 1 FROM game_seen WHERE idem=?", f"zero:{run_id}:{sid}") is not None

    # ================================================================ olay işleyicileri
    def _on_run_started(self, ev: dict[str, Any], ts: float) -> None:
        ctx = self._ctx(ev.get("run_id"))
        if ctx is None:
            return
        detail = ev.get("detail") if isinstance(ev.get("detail"), dict) else {}
        self._load_detail(ctx, detail)
        if self._demo_run(ctx):
            return  # S40: yalnızca demo ajanlı koşu ödül üretmez
        self._human("run_start", f"run_start:v1:{ctx.id}", ts, "Çalıştırma başlattın", run=ctx.id)
        self._bump(*HUMAN, "runs_started", ctx.id, ts)
        self._active_day(ts)

    def _on_step_added(self, ev: dict[str, Any], ts: float) -> None:
        ctx = self._ctx(ev.get("run_id"))
        step = ev.get("step")
        if ctx is not None and isinstance(step, dict):
            ctx.add_step(step)

    def _on_step_started(self, ev: dict[str, Any], ts: float) -> None:
        ctx = self._ctx(ev.get("run_id"))
        sid = str(ev.get("step") or "")
        if ctx is None or not sid:
            return
        s = ctx.steps.setdefault(sid, {"type": "agent", "depends_on": []})
        if ev.get("agent"):
            s["agent"] = ev["agent"]
        if s.get("type") not in AGENT_STEP_TYPES:
            s["type"] = "agent"
        ctx.started.setdefault(sid, ts)
        if isinstance(ev.get("route"), dict):
            ctx.route[sid] = ev["route"]

    def _on_step_tool_result(self, ev: dict[str, Any], ts: float) -> None:
        ctx = self._ctx(ev.get("run_id"))
        sid = str(ev.get("step") or "")
        if ctx is None or not sid:
            return
        ok = bool(ev.get("ok"))
        ctx.tools.setdefault(sid, []).append(ok)
        agent = (ctx.steps.get(sid) or {}).get("agent")
        if not agent or self._is_demo(agent):
            return
        key = f"{ctx.id}:{ev.get('seq')}:{sid}"
        self._bump("agent", agent, "tool_total", key, ts)
        if ok:
            self._bump("agent", agent, "tool_ok", key, ts)
            kind = R.tool_kind(str(ev.get("name") or ""))
            if kind:
                ctx.kinds.setdefault(agent, set()).add(kind)

    def _on_step_artifacts(self, ev: dict[str, Any], ts: float) -> None:
        ctx = self._ctx(ev.get("run_id"))
        if ctx is not None and ev.get("step"):
            ctx.artifacts[str(ev["step"])] = len(ev.get("files") or [])

    def _on_step_round(self, ev: dict[str, Any], ts: float) -> None:
        ctx = self._ctx(ev.get("run_id"))
        sid = str(ev.get("step") or "")
        if ctx is not None and sid:
            ctx.rounds[sid] = max(ctx.rounds.get(sid, 0), int(ev.get("round") or 1))

    def _on_step_warning(self, ev: dict[str, Any], ts: float) -> None:
        ctx = self._ctx(ev.get("run_id"))
        if ctx is not None and ev.get("kind") == "revise_limit" and ev.get("step"):
            ctx.warned.add(str(ev["step"]))

    def _on_handoff(self, ev: dict[str, Any], ts: float) -> None:
        ctx = self._ctx(ev.get("run_id"))
        if ctx is None or not ev.get("step") or not ev.get("from"):
            return
        item = (str(ev["step"]), str(ev["from"]), str(ev.get("to") or ""))
        if item not in ctx.handoffs:
            ctx.handoffs.append(item)

    def _on_step_decided(self, ev: dict[str, Any], ts: float) -> None:
        ctx = self._ctx(ev.get("run_id"))
        sid = str(ev.get("step") or "")
        if ctx is None or not sid:
            return
        approved = bool(ev.get("approved"))
        ctx.decisions[sid] = approved
        ctx.steps.setdefault(sid, {"depends_on": []})["type"] = "approval"
        if self._demo_run(ctx):
            return
        key = f"{ctx.id}:{sid}"
        # H8: onay ve ret aynı XP
        self._human("decision", f"decision:v1:{key}", ts, "Onay kapısı kararı", run=ctx.id, step=sid)
        self._bump(*HUMAN, "decisions", key, ts)
        self._quest_signal("decision", key, ts)
        self._season_sp("decision", key, ts)
        if str(ev.get("note") or "").strip():
            self._human("decision_note", f"decision_note:v1:{key}", ts, "Karara gerekçe notu", run=ctx.id, step=sid)
            self._bump(*HUMAN, "decision_notes", key, ts)
            self._quest_signal("decision_note", key, ts)
        self._active_day(ts)

    def _on_step_tool_approval_resolved(self, ev: dict[str, Any], ts: float) -> None:
        if ev.get("timed_out"):
            return  # zaman aşımı bir insan kararı değildir
        if self._demo_run(self._runs.get(str(ev.get("run_id") or ""))):
            return
        aid = str(ev.get("approval_id") or f"{ev.get('run_id')}:{ev.get('seq')}")
        self._human("tool_decision", f"tool_decision:v1:{aid}", ts, "Araç onayı kararı", run=ev.get("run_id"),
                    step=ev.get("step"))
        self._quest_signal("decision", f"tool:{aid}", ts)
        self._season_sp("decision", f"tool:{aid}", ts)
        self._active_day(ts)

    def _on_step_finished(self, ev: dict[str, Any], ts: float) -> None:
        ctx = self._ctx(ev.get("run_id"))
        sid = str(ev.get("step") or "")
        if ctx is None or not sid:
            return
        status = str(ev.get("status") or "")
        out = str(ev.get("output") or "")
        ctx.status[sid] = status
        ctx.output[sid] = out
        tok = _tokens_total(ev.get("tokens"))
        if tok:
            ctx.tokens.setdefault(sid, tok)
        s = ctx.steps.get(sid) or {}
        agent = s.get("agent")
        if status != "done" or not agent or s.get("type") not in AGENT_STEP_TYPES or self._is_demo(agent):
            return
        key = f"{ctx.id}:{sid}"
        if self._awarded(f"step_done:v1:{key}"):
            return  # H5: revize turu yeniden taban XP üretmez
        tools = ctx.tools.get(sid, [])
        trivial = len(out.strip()) < R.TRIVIAL_CHARS and not ctx.artifacts.get(sid) and not any(tools)
        h = hashlib.sha1(f"{agent}|{ctx.workflow}|{sid}|{ctx.input_sig}".encode()).hexdigest()
        repeat = self.db.one("SELECT 1 FROM game_repeat WHERE hash=? AND ts>=? AND run_id!=?",
                             h, ts - R.REPEAT_WINDOW_S, ctx.id) is not None
        self.db.exec("INSERT INTO game_repeat(hash, ts, run_id) VALUES(?,?,?)", h, ts, ctx.id)
        if trivial or repeat:
            self.db.once(f"zero:{key}", ts)
            why = "XP yok: çıktı çok kısa" if trivial else "XP yok: aynı iş 24 saat içinde tekrarlandı"
            self._xp("agent", agent, "step_done", 0, f"step_done:v1:{key}", ts, why, run=ctx.id, step=sid)
            return
        self._xp("agent", agent, "step_done", R.STEP_DONE, f"step_done:v1:{key}", ts,
                 f"Adım tamamlandı (+{R.STEP_DONE})", run=ctx.id, step=sid, diminish=True, cap_key=key)
        if tools and all(tools):
            self._xp("agent", agent, "clean_tools", R.CLEAN_TOOLS, f"clean_tools:v1:{key}", ts,
                     f"Temiz araç kullanımı (+{R.CLEAN_TOOLS})", run=ctx.id, step=sid, diminish=True, cap_key=key)
        if tok and ctx.workflow:
            self.db.exec("INSERT OR IGNORE INTO game_tokens(workflow,step,run_id,tokens,ts) VALUES(?,?,?,?,?)",
                         ctx.workflow, sid, ctx.id, tok, ts)
        # G2-D (R-2): "steps_done" sayacı (ve "İlk Teslimat") kullanıcının kabulünde artar (`_settle_verified`)
        self._quest_signal("step_done", key, ts)
        route = ctx.route.get(sid) or {}
        if route.get("connection") == "ollama" or route.get("connector") == "ollama":
            self._bump(*OFFICE, "local_steps", key, ts)
            self._quest_signal("local_step", key, ts)
            if ts - ctx.started.get(sid, ts) >= 1800:
                self._bump("agent", agent, "long_local_steps", key, ts)
        scene = self._scene()
        if scene:
            if scene in C.STARTER_SCENES:
                self._bump(*OFFICE, "scenes_visited", scene, ts)
            self._quest_signal("scene_step", key, ts, value=scene)
        total = self.db.counter("agent", agent, "tool_total")
        if total >= 100 and self.db.counter("agent", agent, "tool_ok") / total >= 0.95:
            self._unlock(C.ACH_BY_ID["temiz_is"], 1, "agent", agent, ts)

    def _on_run_finished(self, ev: dict[str, Any], ts: float) -> None:
        ctx = self._ctx(ev.get("run_id"))
        if ctx is None:
            return
        status = str(ev.get("status") or "")
        rid = ctx.id
        agent_steps = [s for s, d in ctx.steps.items() if d.get("agent") and d.get("type") in AGENT_STEP_TYPES
                       and not self._is_demo(d.get("agent"))]
        done_steps = [s for s in agent_steps if ctx.status.get(s) == "done"]
        if self._demo_run(ctx):
            self._runs.pop(rid, None)
            return  # S40: yalnızca demo ajanlı koşu: başarı, başarım, ofis ve devretme ödülü yok
        self._review_bonuses(ctx, ts)
        self._gate_shares(ctx, ts)
        self._handoff_bonuses(ctx, ts)
        if status == "done":
            for agent in dict.fromkeys(ctx.steps[s]["agent"] for s in done_steps):
                self._xp("agent", agent, "run_success", R.RUN_SUCCESS, f"run_success:v1:{rid}:{agent}", ts,
                         f"Akış başarıyla bitti (+{R.RUN_SUCCESS})", run=rid, diminish=True)
            self._run_achievements(ctx, done_steps, ts)
            self._delegation(ctx, done_steps, ts)
        elif status == "failed" and ctx.kind == "workflow" and ctx.workflow:
            self.db.once(f"fail:{ctx.workflow}:{R.day_of(ts)}", ts)
        self._runs.pop(rid, None)

    def _review_bonuses(self, ctx: RunCtx, ts: float) -> None:
        # "ilk turda onay" yalnız kullanıcının yazdığı / arayüzden kaydettiği akışta (MCP'nin yazdığı değil)
        user_flow = not (ctx.kind == "workflow" and ctx.workflow) or self._is_user_workflow(ctx.workflow)
        for rev_id, rev in ctx.steps.items():
            rv = rev.get("revise")
            if not isinstance(rv, dict) or ctx.status.get(rev_id) != "done":
                continue
            target = str(rv.get("target") or "")
            tgt = ctx.steps.get(target) or {}
            t_agent = tgt.get("agent")
            if not t_agent or self._is_demo(t_agent) or ctx.status.get(target) != "done" \
                    or self._zeroed(ctx.id, target):
                continue
            approved = R.strict_approved(ctx.output.get(rev_id), rv.get("until"))
            rounds = ctx.rounds.get(rev_id, 0)
            key = f"{ctx.id}:{target}"
            if approved and rounds == 0 and rev.get("agent") != t_agent and user_flow:   # H6: öz-inceleme hariç
                self._xp("agent", t_agent, "first_try", R.FIRST_TRY, f"first_try:v1:{key}", ts,
                         f"İlk turda onay (+{R.FIRST_TRY})", run=ctx.id, step=target, diminish=True, cap_key=key)
                self._quest_signal("first_try", key, ts)
                self._season_sp("first_try", key, ts)
                tok = ctx.tokens.get(target)
                med = self._median_tokens(ctx.workflow, target, ctx.id)
                if tok and med is not None and tok <= med:
                    self._xp("agent", t_agent, "efficient", R.EFFICIENT, f"efficient:v1:{key}", ts,
                             f"Verimli adım (+{R.EFFICIENT})", run=ctx.id, step=target, diminish=True, cap_key=key)
            elif approved and rounds >= 1 and rev_id not in ctx.warned:
                self._xp("agent", t_agent, "recovery", R.RECOVERY, f"recovery:v1:{key}", ts,
                         f"Revizeden toparlandı (+{R.RECOVERY})", run=ctx.id, step=target, diminish=True, cap_key=key)

    def _median_tokens(self, workflow: str, step: str, run_id: str) -> float | None:
        if not workflow:
            return None
        rows = self.db.q("SELECT tokens FROM game_tokens WHERE workflow=? AND step=? AND run_id!=? ORDER BY ts DESC "
                         "LIMIT 10", workflow, step, run_id)
        return statistics.median([r["tokens"] for r in rows]) if len(rows) >= 5 else None

    def _gate_shares(self, ctx: RunCtx, ts: float) -> None:
        for gate, approved in ctx.decisions.items():
            if not approved:
                continue
            for sid in self._gate_ancestors(ctx, gate):
                agent = ctx.steps[sid].get("agent")
                if not agent or self._is_demo(agent) or ctx.status.get(sid) != "done" or self._zeroed(ctx.id, sid):
                    continue
                key = f"{ctx.id}:{sid}"
                self._xp("agent", agent, "gate_share", R.GATE_SHARE, f"gate_share:v1:{key}", ts,
                         f"Onay kapısından geçti (+{R.GATE_SHARE})", run=ctx.id, step=sid, diminish=True, cap_key=key)

    @staticmethod
    def _gate_ancestors(ctx: RunCtx, gate: str) -> list[str]:
        out: list[str] = []
        stack, seen = list((ctx.steps.get(gate) or {}).get("depends_on") or []), set()
        while stack:
            sid = stack.pop()
            if sid in seen or sid not in ctx.steps:
                continue
            seen.add(sid)
            d = ctx.steps[sid]
            if d.get("type") == "approval":
                continue  # önceki kapıda dur
            if d.get("agent"):
                out.append(sid)
            stack.extend(d.get("depends_on") or [])
        return out

    @staticmethod
    def _giver_step(ctx: RunCtx, to_sid: str, giver: str) -> str | None:
        stack, seen = list((ctx.steps.get(to_sid) or {}).get("depends_on") or []), set()
        while stack:
            sid = stack.pop()
            if sid in seen or sid not in ctx.steps:
                continue
            seen.add(sid)
            d = ctx.steps[sid]
            if d.get("type") == "approval":
                stack.extend(d.get("depends_on") or [])
            elif d.get("agent") == giver:
                return sid
        return None

    def _handoff_bonuses(self, ctx: RunCtx, ts: float) -> None:
        per_giver: dict[str, int] = {}
        for to_sid, giver, _receiver in ctx.handoffs:
            if ctx.status.get(to_sid) != "done":
                continue
            from_sid = self._giver_step(ctx, to_sid, giver)
            if not from_sid or self._is_demo(giver) or self._zeroed(ctx.id, from_sid):
                continue
            if per_giver.get(from_sid, 0) * R.HANDOFF_USED >= R.HANDOFF_STEP_MAX:
                continue
            per_giver[from_sid] = per_giver.get(from_sid, 0) + 1
            self._xp("agent", giver, "handoff_used", R.HANDOFF_USED, f"handoff:v1:{ctx.id}:{from_sid}:{to_sid}", ts,
                     f"Teslim işe yaradı (+{R.HANDOFF_USED})", run=ctx.id, step=from_sid, diminish=True,
                     cap_key=f"{ctx.id}:{from_sid}")
            self._bump(*OFFICE, "handoffs_used", f"{ctx.id}:{from_sid}:{to_sid}", ts)

    def _run_achievements(self, ctx: RunCtx, done_steps: list[str], ts: float) -> None:
        rid = ctx.id
        if self._perfect_run(ctx, done_steps):
            self._bump(*OFFICE, "perfect_runs", rid, ts)
        teams = {(self._agents.get(ctx.steps[s]["agent"]) or {}).get("team") for s in done_steps} - {None, ""}
        if len(teams) >= 3:
            self._bump(*OFFICE, "multi_team_runs", rid, ts)
            self._quest_signal("multi_team_run", rid, ts)
        if len(done_steps) >= 8:
            self._bump(*OFFICE, "long_runs", rid, ts)
        for agent, kinds in ctx.kinds.items():
            if TOOL_KINDS <= kinds and not self._is_demo(agent):
                self._unlock(C.ACH_BY_ID["cok_yonlu"], 1, "agent", agent, ts)
        if ctx.kind == "workflow" and ctx.workflow:
            wf = ctx.workflow
            if self._is_user_workflow(wf):
                self._human("wf_first_success", f"wf_first_success:v1:{wf}", ts, "Kendi akışın ilk kez başarılı",
                            run=rid)
                self._bump(*HUMAN, "workflows_succeeded", wf, ts)
                self._quest_signal("wf_first_success", wf, ts)
                self._season_sp("workflow", f"first:{wf}", ts)  # akış iyileştirme: ilk başarı
            scene = self._scene()
            if scene:
                self._quest_signal("scene_run", rid, ts, value=scene)
                if scene in ("sea", "yacht"):
                    self._bump(*OFFICE, "sea_runs", rid, ts)
                if scene == "camp" and "rapor" in f"{wf} {ctx.title}".lower():
                    self._bump(*OFFICE, "camp_reports", rid, ts)
                if C.is_city(scene):  # SP-W0 pasaport damgası: şehir sahnesinde biten akış (koşu başına bir kez)
                    self._bump(*OFFICE, "city_flows", rid, ts)
            day = R.day_of(ts)
            if self.db.one("SELECT 1 FROM game_seen WHERE idem=?", f"fail:{wf}:{day}"):
                self._bump(*OFFICE, "comebacks", f"{wf}:{day}", ts)
                if self._is_user_workflow(wf):  # akış iyileştirme: aynı gün başarısızlıktan düzeltilip dönüş
                    self._season_sp("workflow", f"comeback:{wf}:{day}", ts)

    def _perfect_run(self, ctx: RunCtx, done_steps: list[str]) -> bool:
        """ "Kusursuz Akış": ≥3 biten ajan adımı, ≥1 onay kapısı (hepsi onaylı), ≥1 biten gözden geçiren adım
        (`revise`), 0 revize turu. Boş kapı listesi üzerinde `all` artık geçmez; örnek/alıştırma/tarif akışı sayılmaz."""
        gates = [g for g, d in ctx.steps.items() if d.get("type") == "approval"]
        reviewers = [s for s, d in ctx.steps.items() if isinstance(d.get("revise"), dict) and ctx.status.get(s) == "done"]
        if len(done_steps) < 3 or not gates or not reviewers or sum(ctx.rounds.values()) != 0:
            return False
        if not all(ctx.decisions.get(g) is True for g in gates):
            return False
        return not self._bundled_run(ctx)

    def _bundled_run(self, ctx: RunCtx) -> bool:
        """Depoyla gelen örnek (`workflows/`), akademi alıştırması ya da tarif akışı mı?"""
        wf = ctx.workflow
        if not wf:
            return False
        if wf in R.PRACTICE_WORKFLOWS:
            return True
        if EDITION == "full":
            try:
                from studio.full.recipes import recipe_id_of  # noqa: PLC0415
                if recipe_id_of(wf):
                    return True
            except Exception:  # noqa: BLE001
                pass
        lib = getattr(self.studio, "library", None)
        if lib is None or not hasattr(lib, "dir"):
            return False
        try:
            return not (Path(lib.dir) / f"{wf}.yaml").is_file()  # kullanıcı klasöründe yoksa örnek (ya da silinmiş)
        except (OSError, TypeError, ValueError):
            return False

    def _delegation(self, ctx: RunCtx, done_steps: list[str], ts: float) -> None:
        roots = {d.get("agent") for d in ctx.steps.values() if d.get("type") == "delegate" and d.get("agent")
                 and not self._is_demo(d.get("agent"))}
        for root in roots:
            others = {ctx.steps[s]["agent"] for s in done_steps} - {root}
            if len(others) >= 3:
                self._bump("agent", root, "delegations", ctx.id, ts)
            earned = int(self.db.scalar("SELECT COALESCE(SUM(amount),0) FROM game_ledger WHERE run_id=? AND "
                                        "subject_type='agent' AND subject_id!=? AND rule!='achievement'",
                                        ctx.id, root))
            # G2-D (R-2): astların bu koşudaki XP'si artık kabulü bekler; pay da onunla birlikte kabulde verilir
            earned += int(self.db.scalar("SELECT COALESCE(SUM(capped),0) FROM game_pending WHERE run_id=? AND "
                                         "agent!=? AND status='pending'", ctx.id, root))
            share = min(R.TEAM_SHARE_MAX, int(earned * R.TEAM_SHARE_RATE))
            if share > 0:
                self._xp("agent", root, "team_share", share, f"team_share:v1:{ctx.id}:{root}", ts,
                         f"Ekibin başarısından pay (+{share})", run=ctx.id, diminish=True)

    def _is_user_workflow(self, slug: str) -> bool:
        users = self._facts.get("user_workflows")
        if users is not None and slug not in users:
            return False
        return self._workflow_by_user(slug)

    def _workflow_by_user(self, slug: str) -> bool:
        """akışı son kaydeden kullanıcı mı (`Workflow.author`). MCP (`mcp:<x>`) ya da başlıksız yerel süreç
        (`local`) kaydettiyse hayır. Yazar alanı olmayan eski kayıtlar ve şablon/paket kurulumları kullanıcınındır."""
        try:
            node = self.studio.store.find("Workflow", slug)
        except Exception:  # noqa: BLE001
            return True
        author = (node or {}).get("props", {}).get("author") if node else None
        return author in (None, "", "user")

    def _on_memory_fact(self, ev: dict[str, Any], ts: float) -> None:
        fact = ev.get("fact") if isinstance(ev.get("fact"), dict) else {}
        fid = str(fact.get("id") or "")
        if not fid:
            return
        # yalnızca kullanıcının (arayüz) yaptığı GERÇEK değişiklik sayılır; ajan/MCP eylemi, boş `{}` ve aynı
        # durumu yeniden yazma insan XP'si, görev ya da sayaç üretmez. Bilgi başına günde bir bakım (eylemden bağımsız):
        # sabitle + çöz iki kez sayılmaz.
        if ev.get("by") != "user" or ev.get("changed") is not True:
            return
        props = fact.get("props") or {}
        action = "invalid" if props.get("invalid_at") else "pin" if props.get("pinned") else "edit"
        day = R.day_of(ts)
        key = f"{fid}:{day}"
        self._human("memory_curate", f"memory_curate:v2:{key}", ts, "Bellek bakımı")
        self._bump(*HUMAN, "curations", key, ts)
        self._quest_signal("curation", key, ts)
        if action == "pin":
            self._bump(*HUMAN, "pins", fid, ts)
        elif action == "invalid":
            self._bump(*HUMAN, "invalidations", fid, ts)
        self._active_day(ts)

    def _on_memory_updated(self, ev: dict[str, Any], ts: float) -> None:
        agent = ev.get("agent")
        res = ev.get("result") if isinstance(ev.get("result"), dict) else {}
        if agent and not res.get("skipped") and not self._is_demo(agent):
            self._bump("agent", str(agent), "memories", f"{ev.get('run_id')}:{ev.get('step')}", ts)

    def _on_agent_updated(self, ev: dict[str, Any], ts: float) -> None:
        agent = ev.get("agent") if isinstance(ev.get("agent"), dict) else {}
        slug = agent.get("slug")
        if not slug or agent.get("demo") is True:
            return
        old = self._agents.get(slug)
        info = self._agent_info(agent)
        self._agents[slug] = info
        sig = self._avatar_sig(info["avatar"])
        prev = self.db.meta(f"avatar:{slug}") or (self._avatar_sig(old.get("avatar")) if old else None)
        self.db.set_meta(f"avatar:{slug}", sig)
        if prev is not None and prev != sig:
            self._bump(*HUMAN, "avatar_changes", f"{slug}:{hashlib.sha1(sig.encode()).hexdigest()[:12]}", ts)
        old_rank = (old or {}).get("rank")
        if old_rank and info["rank"] and R.rank_index(info["rank"]) > R.rank_index(old_rank):
            self._bump(*OFFICE, "promotions", f"{slug}:{info['rank']}", ts)
        self._check_state(ts)

    def _on_agent_removed(self, ev: dict[str, Any], ts: float) -> None:
        self._refresh_agents_if_live()

    def _on_agent_hired(self, ev: dict[str, Any], ts: float) -> None:
        by = ev.get("by")
        new = ev.get("agent")
        new_slug = new.get("slug") if isinstance(new, dict) else new
        demo_new = (isinstance(new, dict) and new.get("demo") is True) or self._is_demo(new_slug)
        if by and not self._is_demo(by) and not demo_new:
            self._bump("agent", str(by), "hires", str(new_slug or ev.get("name") or ev.get("seq")), ts)
        self._refresh_agents_if_live()
        self._check_state(ts)

    def _on_office_changed(self, ev: dict[str, Any], ts: float) -> None:
        self._refresh_agents_if_live()
        if ev.get("template"):
            self._bump(*HUMAN, "agents_created", f"template:{ev['template']}", ts)
        self._check_state(ts)

    def _on_goal_completed(self, ev: dict[str, Any], ts: float) -> None:
        goal = ev.get("goal") if isinstance(ev.get("goal"), dict) else {}
        gid = str(ev.get("goal_id") or goal.get("id") or ev.get("id") or "")
        if not gid:
            return
        # ( deseni): yalnız KULLANICININ tamamladığı hedef ödül alır — arayüzden "bitti" işareti ya da
        # kullanıcının başlattığı hedef koşusunun "done" bitişi. MCP / başlıksız süreç hedef açıp kapatabilir, ama
        # sezon puanı, XP, jeton, görev ilerlemesi ya da sürpriz kutu kazanmaz.
        if ev.get("by") != "user":
            return
        title = str(goal.get("title") or ev.get("title") or "Hedef")
        self._human("goal_completed", f"goal:v1:{gid}", ts, f"Hedef tamamlandı: {title[:60]}")
        owner = goal.get("owner_agent") or ev.get("owner_agent")
        if owner and owner in self._agents:
            self._xp("agent", str(owner), "goal_owner", R.GOAL_OWNER_XP, f"goal_owner:v1:{gid}", ts,
                     f"Hedefi tamamlandı (+{R.GOAL_OWNER_XP})")
        self._bump(*HUMAN, "goals_completed", gid, ts)
        self._quest_signal("goal_completed", gid, ts)
        self._season_sp("goal", gid, ts)
        self._active_day(ts)

    def _on_acceptance_updated(self, ev: dict[str, Any], ts: float) -> None:
        """kabul edilen teslim → sezon puanı. Kullanıcının reddi kabulle EŞİT puan alır (Y9: karar yönü ödülü
        değiştirmez); ajan hakemin reddi bir insan kararı değildir. Teslim başına bir kez (kabul kimliği)."""
        acc = ev.get("acceptance") if isinstance(ev.get("acceptance"), dict) else {}
        aid = str(ev.get("acceptance_id") or acc.get("id") or "")
        status = str(ev.get("status") or acc.get("status") or "")
        run_id = str(ev.get("run_id") or acc.get("run_id") or "")
        root = self._record_version(aid, acc, run_id) if aid else ""   # G2-D: sürüm zinciri (her durumda)
        if not aid or status not in ("accepted", "rejected"):
            return
        # ajan hakemin kararı (kabul ya da ret) tavsiyedir ve hiçbir yönde puan kazandırmaz; yalnız
        # kullanıcının kendi kararı sayılır, kabul ve ret eşit (Y9)
        kind = acc.get("reviewer_kind") if "reviewer_kind" in acc else ev.get("reviewer_kind")
        legacy = kind is None  # `reviewer_kind` taşımayan eski kayıt — ilk oturum kartı onu kullanıcı kararı sayar
        if kind != "user" and not legacy:
            return
        if status == "accepted":  # Karar 4: `ilk_mesai` ilk KABUL EDİLEN teslimde açılır (kabul kimliği başına bir kez)
            self._bump(*HUMAN, "deliveries_accepted", aid, ts)
        if legacy:
            return  # kabul ve ödül adımı ayrışmaz; sezon puanı yalnız açık kullanıcı kararına
        if status == "accepted" and str(acc.get("review_status") or "accepted") == "accepted":
            # G2-D / karar R-2: ajan XP'si kullanıcının doğruladığı işe (teslim başına bir kez). Ret, revizyon isteği
            # ve ajan hakem kararı ajan XP'si vermez; kullanıcının kendi karar puanı (Y9) aşağıda aynen kalır.
            partial = str(acc.get("usable") or "full") == "partial"
            self._settle_verified(root, aid, run_id, ts, R.PARTIAL_XP_FACTOR if partial else 1.0)
        if self.db.one("SELECT 1 FROM season_points WHERE idem IN (?,?)", f"sp:delivery:{aid}", f"sp:review:{aid}"):
            return  # ret sonra kabul (ya da tersi) iki kez sayılmaz
        self._season_sp("delivery" if status == "accepted" else "review", aid, ts)

    def _on_goal_run_finished(self, ev: dict[str, Any], ts: float) -> None:
        if ev.get("goal_id"):
            self._bump(*OFFICE, "goal_runs", f"{ev.get('goal_id')}:{ev.get('run_id')}", ts)

    # ---------------------------------------------------------------- W4 takdir bağları
    def _on_recognition_given(self, ev: dict[str, Any], ts: float) -> None:
        """Çıktıya bağlı takdir: sunucu kaydıyla doğrulanır (gift_log yalnızca kullanıcı ucunda ve admin dışında yazılır)."""
        rid = ev.get("recognition_id")
        if not rid or self.admin():
            return
        row = self.db.one("SELECT run_id, deliverable_id FROM gift_log WHERE recognition_id=? ORDER BY id LIMIT 1",
                          str(rid))
        output = row and (row["deliverable_id"] or row["run_id"])
        if not output:
            return
        self._human("recognition", f"recognition:v1:{rid}", ts, "Takdir")
        self._bump(*HUMAN, "thanked_outputs", str(output), ts)
        self._quest_signal("thanks_output", str(rid), ts)

    def _on_weekly_pick(self, ev: dict[str, Any], ts: float) -> None:
        """Haftanın çalışanı: yalnızca kullanıcının seçimi (weekly_pick tablosu); sistem hesaplamaz ve önermez."""
        week = str(ev.get("week") or "")
        if not week or self.admin():
            return
        row = self.db.one("SELECT agent FROM weekly_pick WHERE week=?", week)
        if row is None or (ev.get("agent") and ev.get("agent") != row["agent"]):
            return
        self._bump(*HUMAN, "weekly_picks", week, ts)
        self._quest_signal("weekly_pick", week, ts)
        if self.db.once(f"weekly_pick_feed:{week}:{row['agent']}", ts):
            self.db.feed(ts, "weekly_pick", "agent", row["agent"], f"Haftanın çalışanı: {self._name(row['agent'])}",
                         None, {"week": week, "agent": row["agent"]})

    def _on_ext(self, ev: dict[str, Any], ts: float) -> None:
        """Harici oturumlar (Claude Code/Codex): oturum bitişi başına hafif XP (×0,5; araştırma B.16)."""
        etype = str(ev.get("type") or "")
        # izleyici (S9) oturum bitişini `ext.ended` olarak yayınlar; eski/genel adlar da kabul edilir (QA-F3 M1)
        if not (etype == "ext.ended" or ("session" in etype and _EXT_END.search(etype)) or etype.endswith(".stop")):
            return
        sess = ev.get("session") if isinstance(ev.get("session"), dict) else {}
        sess_id = ev.get("session_id") or sess.get("id") or ev.get("id")
        if not sess_id:
            return
        source = str(ev.get("source") or sess.get("source") or ("codex" if "codex" in etype else "claude-code"))
        amount = int(R.EXTERNAL_SESSION_XP * R.EXTERNAL_MULTIPLIER)
        self._xp("external", source, "ext_session", amount, f"ext_session:v1:{source}:{sess_id}", ts,
                 f"Harici oturum tamamlandı (+{amount})", diminish=True)

    def _refresh_agents_if_live(self) -> None:
        if not self._replay:
            self._refresh_agents()

    def _check_state(self, ts: float) -> None:
        """Duruma bağlı başarımlar: ilk ajan / şablon, organizasyon şeması."""
        studio_agents = [a for a in self._agents.values() if a.get("created_by") == "studio" and not a.get("hired_by")]
        baseline = int(self.db.meta("agents_baseline") or 0)
        if len(studio_agents) > baseline:
            self._bump(*HUMAN, "agents_created", "agent", ts)
        ranks = {a.get("rank") for a in self._agents.values() if a.get("rank")}
        if ranks and all(ranks & tier for tier in C.ORG_TIERS):
            self._unlock(C.ACH_BY_ID["org_semasi"], 1, *OFFICE, ts)

    # ================================================================ görevler (B.10)
    def season_premium(self) -> Any:
        """ kontrol noktası C12: `entitlements.check("season_premium")` (Pro, kurucu, yönetici). Motor bağlı değilse
        None. Satın alma yolu yok; premium yol yalnız kozmetiktir."""
        from studio.entitlements import gate  # noqa: PLC0415

        ent = gate(self.studio)
        return ent.check("season_premium") if ent is not None else None

    # ---- (PK2-LOOP) kontrol noktası C1 yardımcıları: İkili ofis, açılım yolu, ofis sağlığı buradan sorar (T15)
    def seat_info(self) -> dict[str, Any] | None:
        """C1 okuma: boş koltuk ve paket sayım sınırları (yalnız bilgi; yeni kilit değil). Motor yok/yönetici → None."""
        from studio.entitlements import gate, usage  # noqa: PLC0415

        ent = gate(self.studio)
        if ent is None or ent.admin_active():
            return None
        r = ent.resolve()
        return {"seats": r.seats, "free": max(0, r.seats - usage.seats(self.studio)["used"]), "limits": dict(r.limits)}

    def roster_state(self) -> dict[str, Any]:
        """C1 okuma: kadro düğümleri, çalışan ajanlar ve son kullanım (seats yardımcıları; salt okunur)."""
        from studio.entitlements import seats, usage  # noqa: PLC0415

        return {"nodes": usage.roster_nodes(self.studio), "busy": seats.busy_agents(self.studio),
                "last_used": seats.last_used(self.studio)}

    def swap_seat(self, slug: str, out: str) -> bool:
        """C1 E2: ücretsiz koltuk değişimi (seats.activate; hiçbir şey silinmez). Motor yok/yönetici → False."""
        from studio.entitlements import EntitlementError, gate, seats  # noqa: PLC0415

        ent = gate(self.studio)
        if ent is None or ent.admin_active():
            return False
        try:
            seats.activate(self.studio, ent, slug, swap_out=out)
        except (seats.SeatError, EntitlementError):
            return False
        return True

    # ---- 2026-10-19 üyelik : sandıklar ve özellik paketleri buradan sorar (T15; chests/expanse motoru sormaz)
    def membership(self) -> dict[str, Any] | None:
        """Üyelik özeti: {plan, source, chest_tier, chests (plans.CHESTS satırı), packs, persist}. Motor yok → None.
        Yönetici modu ve test paketi yalnız ÖNİZLER (persist=False; S40)."""
        from studio.entitlements import gate  # noqa: PLC0415
        from studio.entitlements.plans import CHESTS  # noqa: PLC0415

        ent = gate(self.studio)
        if ent is None:
            return None
        r = ent.resolve()
        return {"plan": r.plan, "source": r.source, "chest_tier": r.chests,
                "chests": dict(CHESTS.get(r.chests, CHESTS["free"])), "packs": sorted(r.packs),
                "persist": r.source not in ("admin", "test")}

    def feature_pack(self, pack_id: str) -> str:
        """Özellik paketi durumu (`entitlements.check("pack:<id>")`): "active" (gerçek hak), "preview" (yönetici ya da
        test paketi; kalıcı yazım yok) ya da "" (yok). Motor bağlı değilse "" — Free paketsiz tam çalışır."""
        from studio.entitlements import gate  # noqa: PLC0415

        ent = gate(self.studio)
        if ent is None:
            return ""
        d = ent.check(f"pack:{pack_id}")
        if not d.allowed:
            return ""
        return "preview" if d.source in ("admin", "test") else "active"

    def _season_sp(self, source: str, key: str, ts: float) -> None:
        """gerçek iş sinyalinden sezon puanı (game/season.py; kendi SAVEPOINT'inde, idempotent)."""
        from studio.game import season  # noqa: PLC0415

        season.award(self, source, key, ts)

    def _quest_signal(self, signal: str, key: str, ts: float, *, value: str | None = None) -> None:
        rows = self.db.q("SELECT * FROM game_quests WHERE status='active' AND created_at<=?", ts)
        for r in rows:
            tpl = C.QUEST_BY_ID.get(r["template"])
            if tpl is None or tpl.signal != signal:
                continue
            params = json.loads(r["params"] or "{}")
            if signal == "scene_step" and (not value or value == params.get("scene")):
                continue
            k = value if tpl.distinct else key
            if not k or not self.db.once(f"qp:{r['id']}:{k}", ts):
                continue
            progress = int(r["progress"]) + 1
            done = progress >= int(r["target"])
            self.db.exec("UPDATE game_quests SET progress=?, status=?, done_at=? WHERE id=?", progress,
                         "done" if done else "active", ts if done else None, r["id"])
            title = self._quest_title(tpl, int(r["target"]))
            if done:
                self.db.feed(ts, "quest", *HUMAN, f"Görev tamamlandı: {title}", None, {"quest": r["id"]})
                if r["kind"] == "weekly":  # haftalık görev bitti → ücretsiz sürpriz teslim kutusu
                    from studio.game import surprise  # noqa: PLC0415

                    surprise.earn(self, r["id"], ts)
            self._emit("game.quest", quest=r["id"], template=tpl.id, kind=tpl.kind, status="done" if done else "active",
                       progress=progress, target=int(r["target"]), title=title)

    @staticmethod
    def _quest_title(tpl: C.QuestTemplate, target: int) -> str:
        return tpl.title.format(n=target)

    def gather_facts(self) -> dict[str, Any]:
        """Görev uygulanabilirliği için gerçekler (dosya okur; olay döngüsü dışında çağrılmalı)."""
        now = time.time()
        if self._facts and now - self._facts_at < 60:
            return self._facts
        facts: dict[str, Any] = {"pending": 0, "facts": 0, "goals": 0, "teams": 0, "ollama": False,
                                 "approval_flows": False, "review_flows": False, "user_workflows": None,
                                 "scene": None}
        try:
            for run in list(self.studio.engine.runs.values()):
                for st in list(run.steps.values()):
                    if st.status in ("awaiting_approval", "awaiting_tool_approval"):
                        facts["pending"] += 1
        except Exception:  # noqa: BLE001
            pass
        try:
            by_type = self.studio.store.stats().get("by_type", {})
            facts.update(facts=by_type.get("Fact", 0), goals=by_type.get("Goal", 0), teams=by_type.get("Team", 0))
        except Exception:  # noqa: BLE001
            pass
        facts["ollama"] = any(a.get("connection") == "ollama" for a in self._agents.values())
        try:
            flows = self.studio.library.list()
            steps = [s for w in flows for s in (w.get("steps") or []) if isinstance(s, dict)]
            facts["approval_flows"] = any(s.get("type") == "approval" for s in steps)
            facts["review_flows"] = any(s.get("revise") for s in steps)
            facts["user_workflows"] = {w["slug"] for w in flows if not w.get("example")}
        except Exception:  # noqa: BLE001
            pass
        try:
            facts["scene"] = self.studio.settings.get("scene")
        except Exception:  # noqa: BLE001
            pass
        try:  # W4: yürüme görevleri (son 7 günde yürüme + kalan hatıra/vize)
            from studio.walk.service import quest_facts
            facts.update(quest_facts(self, now))
        except Exception:  # noqa: BLE001
            pass
        self._facts, self._facts_at = facts, now
        return facts

    def _applicable(self, tpl: C.QuestTemplate, facts: dict[str, Any]) -> bool:
        req = tpl.requires
        return {
            None: True,
            "pending": facts.get("pending", 0) >= 1,
            "approval_flows": bool(facts.get("approval_flows")),
            "facts10": facts.get("facts", 0) >= 10,
            "facts30": facts.get("facts", 0) >= 30,
            "ollama": bool(facts.get("ollama")),
            "review_flows": bool(facts.get("review_flows")),
            "teams3": facts.get("teams", 0) >= 3,
            "goals": facts.get("goals", 0) >= 1,
            # W4 yürüme: son 7 günde yürüme modu + sonlu hedef kaldıysa
            "walk": bool(facts.get("walk")),
            "walk_souvenirs": bool(facts.get("walk")) and facts.get("walk_souvenirs", 0) >= 2,
            "walk_souvenir_scenes": bool(facts.get("walk")) and facts.get("walk_souvenir_scenes", 0) >= 3,
            "walk_landmarks": bool(facts.get("walk")) and facts.get("walk_landmarks", 0) >= 1,
        }.get(req, False)

    def _quest_target(self, tpl: C.QuestTemplate, facts: dict[str, Any], now: float) -> int:
        if tpl.id == "karar_turu":
            return max(1, min(3, int(facts.get("pending", 1))))
        if tpl.adaptive:
            rows = self.db.q("SELECT ts FROM game_ledger WHERE rule='first_try' AND ts>=?", now - 28 * 86400)
            weeks: dict[str, int] = {}
            for r in rows:
                weeks[R.week_of(r["ts"])] = weeks.get(R.week_of(r["ts"]), 0) + 1
            if weeks:
                return max(3, min(15, round(0.8 * statistics.median(weeks.values()))))
        return tpl.target

    def ensure_quests(self, now: float | None = None, facts: dict[str, Any] | None = None) -> None:
        """Boş görev yuvalarını doldurur. Bitmemiş görevler yerinde kalır (süre dolmaz)."""
        now = now or time.time()
        facts = facts if facts is not None else self._facts
        with self._lock, self.db.tx():
            for kind, slots in C.SLOTS.items():
                period = R.day_of(now) if kind == "daily" else R.week_of(now)
                rows = self.db.q("SELECT * FROM game_quests WHERE kind=? AND status!='swapped'", kind)
                occupied = {r["slot"]: r for r in rows
                            if r["status"] in ("active", "done") or (r["status"] == "claimed" and r["period"] == period)}
                used = {r["template"] for r in occupied.values()}
                for slot in range(slots):
                    if slot in occupied:
                        continue
                    tpl = self._pick(kind, period, slot, used, facts)
                    if tpl is not None:
                        self._create_quest(tpl, period, slot, now, facts)
                        used.add(tpl.id)
            self._quest_period = R.day_of(now)

    def _pick(self, kind: str, period: str, slot: int, exclude: set[str], facts: dict[str, Any]) -> C.QuestTemplate | None:
        cands = [t for t in C.QUESTS if t.kind == kind and t.id not in exclude and self._applicable(t, facts)]
        if any(C.is_walk_quest(C.QUEST_BY_ID.get(t)) for t in exclude):  # W4: panoda en çok 1 yürüme görevi
            cands = [t for t in cands if not C.is_walk_quest(t)]
        if not cands:
            return None
        return cands[zlib.crc32(f"{period}:{slot}".encode()) % len(cands)]

    def _create_quest(self, tpl: C.QuestTemplate, period: str, slot: int, now: float, facts: dict[str, Any]) -> str:
        n = int(self.db.scalar("SELECT COUNT(*) FROM game_quests WHERE period=? AND slot=? AND kind=?",
                               period, slot, tpl.kind))
        qid = f"{tpl.kind[0]}-{period}-{slot}-{n}"
        params: dict[str, Any] = {}
        if tpl.id == "mekan_degisikligi":
            params["scene"] = facts.get("scene")
        self.db.exec("INSERT INTO game_quests(id,template,kind,period,slot,params,progress,target,status,created_at) "
                     "VALUES(?,?,?,?,?,?,0,?,'active',?)", qid, tpl.id, tpl.kind, period, slot,
                     json.dumps(params), self._quest_target(tpl, facts, now), now)
        return qid

    def quests_stale(self, now: float | None = None) -> bool:
        return self._quest_period != R.day_of(now or time.time())

    def quests(self) -> dict[str, Any]:
        now = time.time()
        period = {"daily": R.day_of(now), "weekly": R.week_of(now)}
        rows = self.db.q("SELECT * FROM game_quests WHERE status!='swapped' ORDER BY kind, slot, created_at")
        items = []
        for r in rows:
            if r["status"] == "claimed" and r["period"] != period[r["kind"]]:
                continue
            tpl = C.QUEST_BY_ID.get(r["template"])
            if tpl is None:
                continue
            coins, xp = R.QUEST_REWARD[r["kind"]]
            items.append({"id": r["id"], "template": tpl.id, "kind": r["kind"], "slot": r["slot"],
                          "title": self._quest_title(tpl, int(r["target"])), "why": tpl.why, "go": tpl.go,
                          "progress": int(r["progress"]), "target": int(r["target"]), "status": r["status"],
                          "reward": {"coins": coins, "xp": xp}, "walk": C.is_walk_quest(tpl),
                          "created_at": r["created_at"],
                          "done_at": r["done_at"], "claimed_at": r["claimed_at"]})
        return {"items": items, "refill": {"daily": _iso(R.next_day_start(now)), "day_start_hour": R.DAY_START_HOUR},
                "ready": sum(1 for i in items if i["status"] == "done")}

    def claim_quest(self, qid: str) -> dict[str, Any]:
        now = time.time()
        with self._lock:
            with self.db.tx():
                r = self.db.one("SELECT * FROM game_quests WHERE id=?", qid)
                if r is None:
                    raise KeyError("Görev yok")
                if r["status"] == "claimed":
                    return {"ok": True, "already": True, "balance": self.db.balance()}
                if r["status"] != "done":
                    raise ValueError("Görev henüz tamamlanmadı")
                coins, xp = R.QUEST_REWARD[r["kind"]]
                tpl = C.QUEST_BY_ID.get(r["template"])
                title = self._quest_title(tpl, int(r["target"])) if tpl else qid
                self.db.exec("UPDATE game_quests SET status='claimed', claimed_at=? WHERE id=?", now, qid)
                self.db.add_coins(f"quest:{qid}", now, R.day_of(now), coins, "quest", f"Görev: {title} (+{coins} jeton)",
                                  ref=qid)
                self._xp(*HUMAN, "quest", xp, f"questxp:{qid}", now, f"Görev ödülü (+{xp})")
                self._season_sp(f"quest_{r['kind']}", qid, now)  # görev yuvası → sezon puanı
                self._active_day(now)
                self.db.feed(now, "quest", *HUMAN, f"Ödül alındı: {title} (+{coins} jeton, +{xp} XP)", coins,
                             {"quest": qid})
                self._emit("game.quest", quest=qid, template=r["template"], kind=r["kind"], status="claimed",
                           progress=int(r["progress"]), target=int(r["target"]), title=title, coins=coins, xp=xp)
            events = self._drain()
        return {"ok": True, "balance": self.db.balance(), "coins": coins, "xp": xp, "events": events}

    def swap_quest(self, qid: str, facts: dict[str, Any]) -> dict[str, Any]:
        now = time.time()
        with self._lock, self.db.tx():
            r = self.db.one("SELECT * FROM game_quests WHERE id=?", qid)
            if r is None:
                raise KeyError("Görev yok")
            if r["status"] != "active":
                raise ValueError("Yalnızca devam eden görev değiştirilebilir")
            active = {x["template"] for x in self.db.q(
                "SELECT template FROM game_quests WHERE kind=? AND status IN ('active','done')", r["kind"])}
            cands = [t for t in C.QUESTS if t.kind == r["kind"] and t.id not in active and self._applicable(t, facts)]
            others = {x["template"] for x in self.db.q(  # W4: değiştirmede de panoda en çok 1 yürüme görevi
                "SELECT template FROM game_quests WHERE kind=? AND id!=? AND (status IN ('active','done') OR "
                "(status='claimed' AND period=?))", r["kind"], qid, r["period"])}
            if any(C.is_walk_quest(C.QUEST_BY_ID.get(t)) for t in others):
                cands = [t for t in cands if not C.is_walk_quest(t)]
            if not cands:
                raise ValueError("Şu an başka uygun görev yok")
            n = int(self.db.scalar("SELECT COUNT(*) FROM game_quests WHERE period=? AND slot=? AND kind=?",
                                   r["period"], r["slot"], r["kind"]))
            tpl = cands[n % len(cands)]
            self.db.exec("UPDATE game_quests SET status='swapped' WHERE id=?", qid)
            new_id = self._create_quest(tpl, r["period"], int(r["slot"]), now, facts)
        return {"ok": True, "quest": new_id}

    # ================================================================ mağaza (B.11)
    def creative(self) -> bool:
        return self.db.meta("creative") == "1"

    def admin(self) -> bool:
        """S40 yönetici/test modu: kilitleri yalnızca ATLAR (envanter/defter yazılmaz); kapanınca kilitler aynen döner."""
        return admin_mode.is_active(self.studio.settings)

    def office_level(self) -> int:
        return self.db.state(*OFFICE)[1]

    def is_owned(self, item_id: str, *, bypass: bool = True) -> bool:
        """bypass=True: görüntüleme kilidi (yaratıcı mod ve yönetici/test modu açar).
        bypass=False: gerçek sahiplik — yaratıcı mod da yönetici modu da sayılmaz (sahneye bağlı ödüller, yürüme
        ödülleri, avatar kozmetiği; FIX-SEC yaratıcı modla kilitli sahnede jeton kazanılamaz)."""
        item = C.SHOP_BY_ID.get(item_id)
        if item is None:
            return True  # bilinmeyen kimlik açık sayılır
        if item.kind == "consumable":
            return False
        if (bypass and (self.creative() or self.admin())) or self.db.owns(item_id):
            return True
        if item.unlock_level and self.office_level() >= item.unlock_level:
            return True
        # E10: pakete dahil sahne paketi (Pro) — envantere YAZILMAZ; abonelik bitince kalıntı kalmaz. Yönetici
        # modu burada sahiplik vermez (atla, verme).
        from studio.entitlements import gate  # noqa: PLC0415
        if item.kind == "scene" and not self.admin() and (ent := gate(self.studio)) is not None:
            # 2026-10-19 gece kararı (K6 gevşedi): etkin `scene:<id>` hakkı (parayla ya da promosyonla) da sahipliktir.
            # Envantere yazılmaz; jeton + seviye yolu aynen kalır. Defter yalnız okunur.
            return self._scene_right(ent, item_id) or ent.check(item_id).allowed
        return False

    @staticmethod
    def _scene_right(ent: Any, item_id: str) -> bool:
        led = getattr(ent, "ledgers", None)
        if led is None:
            return False
        try:
            return sum(led.available(item_id).values()) > 0
        except Exception:  # noqa: BLE001 - defter okunamazsa sahiplik verilmez
            return False

    def shop(self) -> dict[str, Any]:
        level, balance = self.office_level(), self.db.balance()
        admin = self.admin()
        items = []
        for it in C.SHOP:
            owned = self.is_owned(it.id)
            level_ok = admin or level >= it.min_level
            items.append({"id": it.id, "kind": it.kind, "label": it.label, "price": it.price, "rarity": it.rarity,
                          "description": it.description, "min_level": it.min_level, "unlock_level": it.unlock_level,
                          "achievement": it.achievement,
                          "achievement_name": C.ACH_BY_ID[it.achievement].name if it.achievement else None,
                          "owned": owned, "level_ok": level_ok,
                          "can_buy": (not admin) and (not owned) and level_ok and balance >= it.price and C.coin_buyable(it),
                          **self._scene_fields(it)})
        return {"balance": balance, "office_level": level, "creative": self.creative(), "admin": admin, "items": items,
                "free_scenes": [f"scene:{s}" for s in C.ALWAYS_OPEN_SCENES],
                "packs": self._packs(), "passport": self.passport()}

    @staticmethod
    def _scene_fields(it: C.ShopItem) -> dict[str, Any]:
        """SP-W0: sahne öğesinin katman/paket/kazanım yolu/risk puanı (yalnız sahne öğelerinde)."""
        if it.kind != "scene":
            return {}
        ex = it.extra or {}
        return {"tier": ex.get("tier", "core"), "pack": ex.get("pack"), "earn": ex.get("earn", "level"),
                "ip_risk": ex.get("ip_risk", 0), "culture_risk": ex.get("culture_risk", 0)}

    @staticmethod
    def _packs() -> list[dict[str, Any]]:
        return [{"id": p.id, "tier": p.tier, "label": p.label, "scenes": list(p.scenes), "free": p.free}
                for p in C.SCENE_PACKS.values()]

    # ---------------------------------------------------------------- SP-W0 sahne paketleri: pasaport damgası
    def passport(self) -> dict[str, Any]:
        """Şehir akışı sayacı ve damgalar: ilk akış 1 damga, sonra her `PASSPORT_FLOWS` akış bir damga; damga bir şehri açar."""
        flows = int(self.db.counter(*OFFICE, "city_flows"))
        earned = C.stamps_earned(flows)
        spent = int(self.db.scalar("SELECT COUNT(*) FROM game_inventory WHERE source='stamp'") or 0)
        nxt = 1 if flows < 1 else 1 + earned * C.PASSPORT_FLOWS
        return {"flows": flows, "earned": earned, "spent": spent, "available": max(0, earned - spent),
                "per_stamp": C.PASSPORT_FLOWS, "next_at": nxt}

    def redeem_stamp(self, scene: str, *, confirm: bool) -> dict[str, Any]:
        """Bir damgayla seçilen şehri kalıcı açar (jeton harcanmaz, para yok). Yalnız katmanı "city" olan, mağazada bulunan
        ve henüz açılmamış şehir. Yönetici/test modunda kapalı (envantere yazılmaz)."""
        item_id = f"scene:{scene}"
        item = C.SHOP_BY_ID.get(item_id)
        if item is None or item.kind != "scene" or (item.extra or {}).get("tier") != "city":
            raise KeyError("Damgayla açılabilecek böyle bir şehir yok")
        if not confirm:
            raise ConfirmRequired("Damga kullanmak için açık onay gerekli (confirm: true)")
        if self.admin():
            raise ValueError("Yönetici / test modunda damga kullanılamaz")
        now = time.time()
        with self._lock:
            with self.db.tx():
                if self.is_owned(item_id, bypass=False):
                    return {"ok": True, "already": True, "passport": self.passport(), "events": []}
                if self.passport()["available"] < 1:
                    raise ValueError("Kullanılabilir pasaport damgası yok")
                self._grant(item_id, "stamp", now)
            events = self._drain()
        return {"ok": True, "item": item_id, "passport": self.passport(), "events": events}

    def buy(self, item_id: str, *, confirm: bool, request_id: str | None = None) -> dict[str, Any]:
        store = STORE_SETS.get(item_id)
        if store is not None and (store.enabled is None or store.enabled(self)):
            return self._spend_on_store_set(store, confirm=confirm)
        item = C.SHOP_BY_ID.get(item_id)
        if item is None:
            raise KeyError("Mağazada böyle bir öğe yok")
        if not C.coin_buyable(item):
            raise ValueError("Bu şehir jetonla alınmaz; pasaport damgasıyla açılır")
        if not confirm:
            raise ConfirmRequired("Satın alma için açık onay gerekli (confirm: true)")
        if self.admin():  # S40: test modunda gerçek jeton harcanmaz, envantere yazılmaz
            raise ValueError("Yönetici / test modunda satın alma kapalı")
        now = time.time()
        with self._lock:
            with self.db.tx():
                if item.kind != "consumable" and self.is_owned(item_id):
                    return {"ok": True, "already": True, "balance": self.db.balance(), "events": []}
                if self.office_level() < item.min_level:
                    raise ValueError(f"Bu öğe için ofis seviyesi {item.min_level} gerekir")
                balance = self.db.balance()
                if balance < item.price:
                    raise InsufficientCoins(f"Yetersiz jeton: {item.price} gerekli, bakiye {balance}")
                idem = f"buy:{item_id}" if item.kind != "consumable" else f"buy:{item_id}:{request_id or uuid.uuid4().hex}"
                if not self.db.add_coins(idem, now, R.day_of(now), -item.price, "purchase",
                                         f"{item.label} (−{item.price} jeton)", ref=item_id):
                    return {"ok": True, "already": True, "balance": self.db.balance(), "events": []}
                if item.kind == "consumable":
                    self.db.feed(now, "treat", *HUMAN, f"{item.label} 🎉", -item.price, {"item": item_id})
                    self._emit("game.unlock", item=item_id, label=item.label, kind="consumable", source="purchase")
                    if item_id == "treat:party":
                        self._bump(*HUMAN, "parties", idem, now)
                else:
                    self._grant(item_id, "purchase", now)
            events = self._drain()
        return {"ok": True, "balance": self.db.balance(), "item": item_id, "events": events}

    # ---------------------------------------------------------------- COS-A kozmetik setler
    STORE_SOURCES = ("store", "earn", "coin")

    def store_set_owned(self, s: StoreSet) -> set[str]:
        if s.owned is not None:
            return set(s.owned(self))
        return {p for p in s.pieces if self.db.owns(p)}

    def store_set_coin_cost(self, s: StoreSet) -> int:
        """Eksik parça oranında jeton (aynı şey iki kez satılmaz); hepsi sendeyse 0."""
        missing = [p for p in s.pieces if p not in self.store_set_owned(s)]
        return 0 if not missing else -(-s.coin_price * len(missing) // len(s.pieces))

    def _spend_on_store_set(self, s: StoreSet, *, confirm: bool) -> dict[str, Any]:
        """Kozmetik seti jetonla açar: tek `game_coins` satırı (idempotent) + eksik parçalar `source='coin'`. Hak
        defterine dokunmaz; para hakkının iadesi jetonu geri vermez, jeton alımı para hakkı doğurmaz."""
        if not confirm:
            raise ConfirmRequired("Satın alma için açık onay gerekli (confirm: true)")
        if self.admin():
            raise ValueError("Yönetici / test modunda satın alma kapalı")
        now = time.time()
        with self._lock:
            with self.db.tx():
                owned = self.store_set_owned(s)
                missing = [p for p in s.pieces if p not in owned]
                if not missing:
                    return {"ok": True, "already": True, "balance": self.db.balance(), "events": []}
                cost = self.store_set_coin_cost(s)
                balance = self.db.balance()
                if balance < cost:
                    raise InsufficientCoins(f"Yetersiz jeton: {cost} gerekli, bakiye {balance}")
                idem = f"buy:{s.id}:{','.join(missing)}"
                if not self.db.add_coins(idem, now, R.day_of(now), -cost, "purchase", f"{s.label} (−{cost} jeton)",
                                         ref=s.id):
                    return {"ok": True, "already": True, "balance": self.db.balance(), "events": []}
                for p in missing:
                    self._grant(p, "coin", now)   # iade edilmiş para parçasının satırı kalır; jeton sahipliği ref ile
            events = self._drain()
        return {"ok": True, "balance": self.db.balance(), "item": s.id, "cost": cost, "pieces": missing,
                "events": events}

    def grant_store(self, item_id: str, ts: float, *, source: str = "store") -> bool:
        """`store:*` kozmetik parçasını envantere yazar (cosmetics.service projeksiyonu; idempotent). `source`: 'store'
        (hak defterinden), 'earn' (ücretsiz kazanım yolu) ya da 'coin' (jetonla alınmış sete sonradan eklenen parça). Jeton,
        XP, SP ya da başarım sayacı yazmaz; hak defterini
        görmez. Yönetici/test modunda yazmaz (S40). Olaylar `_out`'ta kalır; çağıran boşaltır."""
        if not isinstance(item_id, str) or not item_id.startswith("store:") or source not in self.STORE_SOURCES:
            raise ValueError("Yalnız store:* parçası, store, earn ya da coin kaynağıyla")
        if self.admin():
            return False
        with self._lock:
            with self.db.tx():
                return self._grant(item_id, source, ts)

    # ================================================================ arayüz sinyalleri
    def signal(self, kind: str, data: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
        if kind not in UI_SIGNALS:
            raise ValueError("Bilinmeyen sinyal")
        now = time.time()
        self._signals = [t for t in self._signals if now - t < 60]
        if len(self._signals) >= 60:
            raise ValueError("Çok fazla sinyal; biraz bekle")
        self._signals.append(now)
        with self._lock:
            with self.db.tx():
                if kind == "context.opened":
                    key = f"{data.get('run') or data.get('run_id') or ''}:{data.get('step') or ''}"
                    self._bump(*HUMAN, "context_opened", key, now)
                elif kind == "species.previewed":
                    species = str(data.get("species") or "")[:20]
                    if species:
                        self._bump(*HUMAN, "species_previewed", species, now)
            return self._drain()

    # ================================================================ ayarlar
    def set_creative(self, on: bool) -> None:
        with self._lock:
            self.db.set_meta("creative", "1" if on else "0")

    def focus(self) -> bool:
        """S35 odak modu: oyun katmanları (bildirim, kutlama, dünya kaplaması, rozet) gizlenir; iş KPI'ları kalır."""
        return self.db.meta("focus") == "1"

    def set_focus(self, on: bool) -> None:
        with self._lock:
            self.db.set_meta("focus", "1" if on else "0")

    def dismiss_promotion(self, slug: str) -> None:
        xp, level = self.db.state("agent", slug)
        with self._lock:
            self.db.set_meta(f"promo_dismiss:{slug}:{R.band_index(level)}", 1)

    # ================================================================ okuma
    def _subject_view(self, st: str, sid: str) -> dict[str, Any]:
        xp, level = self.db.state(st, sid)
        prog = R.progress(xp, level, office=st == "office")
        title = (R.seniority(prog["level"]) if st == "agent" else
                 R.manager_title(prog["level"]) if st == "human" else f"Ofis Sv {prog['level']}")
        return {**prog, "title": C.localize_title(title)}  # S16: istek diline göre (TR'de aynı)

    def _today(self, st: str, sid: str) -> dict[str, Any]:
        day = R.day_of(time.time())
        row = self.db.one("SELECT COALESCE(SUM(capped),0) raw, COALESCE(SUM(amount),0) amount FROM game_ledger "
                          "WHERE subject_type=? AND subject_id=? AND day=? AND diminish=1", st, sid, day)
        return {"raw": int(row["raw"]), "xp": int(row["amount"]), "full_until": 150}

    def profile(self) -> dict[str, Any]:
        settings = self.studio.settings.get("game") or {}
        agents = []
        for slug, info in self._agents.items():
            view = self._subject_view("agent", slug)
            agents.append({"slug": slug, "name": info.get("name"), "rank": info.get("rank"),
                           "rank_label": rank_label(info.get("rank")), "hidden": info.get("hidden"),
                           "team": info.get("team"), **view, "today": self._today("agent", slug)})
        external = [{"id": r["subject_id"], **R.progress(int(r["xp"]), int(r["level"]))}
                    for r in self.db.q("SELECT * FROM game_state WHERE subject_type='external'")]
        admin = self.admin()
        unlocked, locked = [], []
        for it in C.SHOP:
            if it.kind == "consumable":
                continue
            if self.is_owned(it.id):
                unlocked.append(it.id)
            else:
                locked.append({"id": it.id, "kind": it.kind, "label": it.label, "price": it.price,
                               "min_level": it.min_level, "unlock_level": it.unlock_level,
                               "achievement": it.achievement, **self._scene_fields(it)})
        earned = int(self.db.scalar("SELECT COUNT(*) FROM game_achievements"))
        total = sum(len(a.tiers) for a in C.ACHIEVEMENTS)
        return {
            "enabled": bool(settings.get("enabled", True)), "celebrations": bool(settings.get("celebrations", True)),
            "sounds": bool(settings.get("sounds", True)),
            "show_world_badges": bool(settings.get("show_world_badges", True)), "creative": self.creative(),
            "focus": self.focus(), "admin": admin,
            "decor": [{"id": d.id, "label": d.label, "unlock_level": d.unlock_level,
                       "unlocked": self.creative() or admin or self.office_level() >= d.unlock_level} for d in C.DECOR],
            "coins": self.db.balance(), "office": self._subject_view(*OFFICE), "manager": self._subject_view(*HUMAN),
            "agents": agents, "external": external, "unlocked": unlocked, "locked": locked,
            "free": [f"scene:{s}" for s in C.ALWAYS_OPEN_SCENES] + list(C.STARTER_COSMETICS),
            "passport": self.passport(),
            "achievements": {"earned": earned, "total": total},
            "quests_ready": int(self.db.scalar("SELECT COUNT(*) FROM game_quests WHERE status='done'")),
            "unseen": int(self.db.scalar("SELECT COUNT(*) FROM game_achievements WHERE seen=0")),
        }

    def agent(self, slug: str) -> dict[str, Any]:
        info = self._agents.get(slug)
        if info is None:
            self._refresh_agents()
            info = self._agents.get(slug)
        if info is None and self.db.one("SELECT 1 FROM game_state WHERE subject_type='agent' AND subject_id=?",
                                        slug) is None:
            raise KeyError("Ajan yok")
        info = info or {"name": slug, "rank": None}
        view = self._subject_view("agent", slug)
        ledger = [dict(r) for r in self.db.q(
            "SELECT ts, rule, raw, amount, explain, run_id, step_id FROM game_ledger WHERE subject_type='agent' AND "
            "subject_id=? ORDER BY id DESC LIMIT 30", slug)]
        achievements = [self._earned_view(r) for r in self.db.q(
            "SELECT * FROM game_achievements WHERE subject_type='agent' AND subject_id=? ORDER BY unlocked_at DESC", slug)]
        promo = R.promotion_hint(view["level"], info.get("rank"))
        if promo and self.db.meta(f"promo_dismiss:{slug}:{promo['band']}"):
            promo = None
        if promo:  # S16: etiketler istek dilinde (TR'de aynı)
            promo = {**promo, "seniority": C.localize_title(promo["seniority"]),
                     "suggested_label": rank_label(promo["suggested_rank"]) or promo["suggested_label"],
                     "current_label": rank_label(info.get("rank")) or promo["current_label"]}
        counters = {r["name"]: r["value"] for r in self.db.q(
            "SELECT name, value FROM game_counters WHERE subject_type='agent' AND subject_id=?", slug)}
        return {"slug": slug, "name": info.get("name"), "rank": info.get("rank"),
                "rank_label": rank_label(info.get("rank")), **view, "today": self._today("agent", slug),
                "ledger": ledger, "achievements": achievements, "promotion": promo,
                "stats": {k: counters.get(k, 0) for k in ("steps_done", "first_try", "recovery", "gate_share",
                                                           "tool_ok", "tool_total")}}

    def _earned_view(self, r: sqlite3.Row) -> dict[str, Any]:
        ach = C.ACH_BY_ID.get(r["achievement_id"])
        if ach is None:
            return {"id": r["achievement_id"], "tier": r["tier"], "unlocked_at": r["unlocked_at"]}
        st, sid = r["subject_type"], r["subject_id"]
        return {"id": ach.id, "tier": r["tier"], "name": ach.tier_name(r["tier"]), "icon": ach.icon,
                "rarity": ach.tiers[r["tier"] - 1][1], "category": ach.category, "description": ach.description,
                "subject_type": st, "subject": sid,
                "who": self._name(sid) if st == "agent" else "Ofis" if st == "office" else "Sen",
                "unlocked_at": r["unlocked_at"], "seen": bool(r["seen"])}

    def achievements(self) -> dict[str, Any]:
        rows = self.db.q("SELECT * FROM game_achievements ORDER BY unlocked_at DESC")
        by_ach: dict[str, list[sqlite3.Row]] = {}
        for r in rows:
            by_ach.setdefault(r["achievement_id"], []).append(r)
        n_agents = max(1, sum(1 for a in self._agents.values() if not a.get("hidden")))
        items = []
        for ach in C.ACHIEVEMENTS:
            earned = by_ach.get(ach.id, [])
            best = max((r["tier"] for r in earned), default=0)
            value = self._progress_value(ach)
            next_tier = next(((i + 1, thr) for i, (thr, _r) in enumerate(ach.tiers) if i + 1 > best), None)
            secret = ach.hidden and not earned
            ownership = None
            if ach.subject == "agent" and earned:
                owners = {r["subject_id"] for r in earned}
                ownership = round(100 * len(owners) / n_agents)
            items.append({
                "id": ach.id, "name": "???" if secret else ach.name, "description": ach.hint if secret else ach.description,
                "condition": ach.hint if secret else ach.condition, "subject": ach.subject, "category": ach.category,
                "category_label": C.CATEGORIES.get(ach.category, ach.category), "icon": ach.icon, "hidden": ach.hidden,
                "secret": secret, "special": ach.special, "reward_item": ach.reward_item,
                "tiers": [{"tier": i + 1, "threshold": thr, "rarity": rar, "name": ach.tier_name(i + 1),
                           "coins": 0 if ach.special else R.RARITY_COINS[rar], "xp": 0 if ach.special else R.RARITY_XP[rar]}
                          for i, (thr, rar) in enumerate(ach.tiers)],
                "best_tier": best, "rarity": ach.tiers[max(0, best - 1)][1],
                "progress": None if value is None or secret else {
                    "value": int(value), "next": next_tier[1] if next_tier else None},
                "earned": [self._earned_view(r) for r in earned][:20], "ownership": ownership,
            })
        total = sum(len(a.tiers) for a in C.ACHIEVEMENTS)
        rarity_counts = {k: 0 for k in R.RARITIES}
        for r in rows:
            ach = C.ACH_BY_ID.get(r["achievement_id"])
            if ach:
                rarity_counts[ach.tiers[r["tier"] - 1][1]] += 1
        return {"summary": {"earned": len(rows), "total": total, "by_rarity": rarity_counts,
                            "kinds_earned": len(by_ach), "kinds_total": len(C.ACHIEVEMENTS)},
                "categories": C.CATEGORIES.for_lang(), "items": items,  # S16: düz sözlük, istek dilinde
                "recent": [self._earned_view(r) for r in rows[:12]]}

    def _progress_value(self, ach: C.Achievement) -> float | None:
        if not ach.counter:
            return None
        if ach.subject == "agent":
            return float(self.db.scalar("SELECT MAX(value) FROM game_counters WHERE subject_type='agent' AND name=?",
                                        ach.counter))
        st, sid = HUMAN if ach.subject == "human" else OFFICE
        return self.db.counter(st, sid, ach.counter)

    def mark_seen(self) -> None:
        with self._lock:
            self.db.exec("UPDATE game_achievements SET seen=1 WHERE seen=0")

    def feed(self, limit: int = 50) -> list[dict[str, Any]]:
        rows = self.db.q("SELECT * FROM game_feed ORDER BY id DESC LIMIT ?", max(1, min(limit, 200)))
        return [{"id": r["id"], "ts": r["ts"], "kind": r["kind"], "subject_type": r["subject_type"],
                 "subject": r["subject_id"], "text": r["text"], "amount": r["amount"],
                 "data": json.loads(r["data"] or "{}")} for r in rows]

    def export(self) -> dict[str, Any]:
        tables = ("game_meta", "game_ledger", "game_coins", "game_state", "game_counters", "game_achievements",
                  "game_quests", "game_inventory", "game_pending")
        return {t: [dict(r) for r in self.db.q(f"SELECT * FROM {t}")] for t in tables}

    # ================================================================ graf (Achievement + EARNED)
    def flush_graph(self) -> None:
        with self._lock:
            pending, self._graph = self._graph, []
        for st, sid, ach, tier, ts in pending:
            self._write_graph(st, sid, ach, tier, ts)

    def sync_graph(self) -> None:
        """Defterdeki tüm başarımları grafa yazar (idempotent; yeniden oynatmadan sonra)."""
        self.flush_graph()
        for r in self.db.q("SELECT * FROM game_achievements"):
            ach = C.ACH_BY_ID.get(r["achievement_id"])
            if ach:
                self._write_graph(r["subject_type"], r["subject_id"], ach, int(r["tier"]), float(r["unlocked_at"]))

    def _write_graph(self, st: str, sid: str, ach: C.Achievement, tier: int, ts: float) -> None:
        store = self.studio.store
        try:
            node = store.upsert_node("Achievement", {
                "id": ach.node_id(tier), "name": ach.tier_name(tier), "description": ach.description,
                "rarity": ach.tiers[tier - 1][1], "icon": ach.icon, "category": ach.category})
            if st == "agent":
                agent = self.studio.agents.node(sid)
                if agent:
                    store.link("EARNED", agent["id"], node["id"], {"tier": tier, "earned_at": _iso(ts)})
        except Exception:  # noqa: BLE001 - graf yazımı oyun hesabını bozmamalı
            log.exception("başarım grafa yazılamadı: %s", ach.id)

    # ================================================================ yeniden oynatma (run_events imleci)
    def _studio_db_path(self) -> str | None:
        try:
            for row in self.studio.store.conn.execute("PRAGMA database_list").fetchall():
                if row[1] == "main" and row[2]:
                    return str(row[2])
        except Exception:  # noqa: BLE001
            pass
        return None

    def _reader(self) -> sqlite3.Connection | None:
        if self._read_conn is None:
            path = self._studio_db_path()
            if not path:
                return None
            try:
                self._read_conn = sqlite3.connect(f"{Path(path).as_uri()}?mode=ro", uri=True, check_same_thread=False)
            except sqlite3.Error:
                self._read_conn = None
        return self._read_conn

    def max_rowid(self) -> int:
        conn = self._reader()
        if conn is None:
            return 0
        try:
            return int(conn.execute("SELECT COALESCE(MAX(rowid),0) FROM run_events").fetchone()[0])
        except sqlite3.Error:
            return 0

    def catch_up(self, limit: int | None = None, batch: int = 400) -> int:
        """`run_events` içinde imleçten sonraki olayları (`limit` rowid'ine kadar) sırayla işler; kutlama yok.

        Açılışta `limit`, aboneliğin alındığı andaki son satırdır: sonraki olaylar canlı kuyruktan kutlamalı gelir."""
        conn = self._reader()
        if conn is None:
            return 0
        cursor = int(self.db.meta("cursor:run_events") or 0)
        limit = self.max_rowid() if limit is None else limit
        processed = 0
        self._replay = True
        try:
            while cursor < limit:
                rows = conn.execute("SELECT rowid, run_id, seq, ts, type, data FROM run_events WHERE rowid>? AND "
                                    "rowid<=? ORDER BY rowid LIMIT ?", (cursor, limit, batch)).fetchall()
                if not rows:
                    break
                with self._lock:
                    with self.db.tx():
                        for rowid, run_id, seq, ts, etype, data in rows:
                            try:
                                ev = {**json.loads(data), "seq": seq, "ts": ts, "type": etype, "run_id": run_id}
                                self._dispatch(etype, ev, float(ts))
                            except Exception:  # noqa: BLE001 - bozuk satır atlanır
                                log.exception("yeniden oynatma satırı atlandı: %s", rowid)
                            processed += 1
                        cursor = int(rows[-1][0])
                        self.db.set_meta("cursor:run_events", cursor)
                    self._drain()
        finally:
            self._replay = False
            self._xp_acc.clear()
            self._out.clear()
        return processed

    def mark_cursor(self) -> None:
        """Kuyruk boşken çağrılır: yayınlanmış her çalıştırma olayı işlenmiştir, imleç ilerleyebilir."""
        rowid = self.max_rowid()
        if rowid:
            with self._lock:
                self.db.set_meta("cursor:run_events", rowid)


_HANDLERS: dict[str, Any] = {
    "run.started": GameService._on_run_started,
    "run.finished": GameService._on_run_finished,
    "step.added": GameService._on_step_added,
    "step.started": GameService._on_step_started,
    "step.tool_result": GameService._on_step_tool_result,
    "step.artifacts": GameService._on_step_artifacts,
    "step.round": GameService._on_step_round,
    "step.warning": GameService._on_step_warning,
    "handoff": GameService._on_handoff,
    "step.decided": GameService._on_step_decided,
    "step.tool_approval_resolved": GameService._on_step_tool_approval_resolved,
    "step.finished": GameService._on_step_finished,
    "memory.fact": GameService._on_memory_fact,
    "memory.updated": GameService._on_memory_updated,
    "agent.updated": GameService._on_agent_updated,
    "agent.removed": GameService._on_agent_removed,
    "agent.hired": GameService._on_agent_hired,
    "office.changed": GameService._on_office_changed,
    "goal.completed": GameService._on_goal_completed,
    "goal.run_finished": GameService._on_goal_run_finished,
    "recognition.given": GameService._on_recognition_given,     # W4
    "recognition.weekly_pick": GameService._on_weekly_pick,     # W4
    "acceptance.updated": GameService._on_acceptance_updated,   # sezon puanı
}
