"""Graf belleği.

Yazma yolu (consolidate): adım çıktısı → Episode (epizodik) + Concept/Fact (semantik) düğümleri,
REMEMBERS / MENTIONS / ASSERTED_IN / ABOUT / RELATED_TO kenarları.

Okuma yolu (recall): görev metni → FTS5 tohumları → kavram komşuluğu üzerinden 1 adım genişleme →
ajan kapsamı + tazelik ağırlığı → bütçeye sığan bağlam bloğu. Kullanılan düğümler çağırana döner
(motor bunları Step -RECALLED-> düğüm olarak bağlar).

Ad alanı izolasyonu (`graph/namespace.py`): her okuma/yazma bir ad alanı alır (`global` ya da
`project:<anahtar>`; varsayılan `global` — "her şey" anlamına gelen bir varsayılan yoktur).
- Yazma: Episode/Fact `namespace` ile damgalanır, Concept `namespaces` listesine eklenir; proje ad alanındaki Fact'in
  anahtarı (hash) ad alanını içerir → aynı önerme iki projede iki ayrı düğümdür (global hash eskisiyle aynı).
- Okuma (`memory.isolation: true`): FTS tohumları SQL'de ad alanıyla süzülür; kavram komşuluğu ve ASSERTED_IN
  genişlemesi, sabitlenmiş bilgiler ve skor normalizasyonu yalnızca aynı ad alanındaki düğümleri görür. Proje koşusu
  global belleği okumaz (çapraz okuma yok). `memory.isolation: false` → eski okuma davranışı (süzgeç yok), yazmalar
  yine damgalı.
- Önbellek yok: recall her çağrıda grafı okur.

Bellek iddiası v1 (`graph/assertion.py`): bilgi köken, epistemik durum, güven, iki eksenli zaman ve kanıt taşır.
Karar R-1 (`memory.shared_write: on_accept`): adım çıktısının anı ve bilgileri ajana ÖZEL yazılır (`visibility:
private`; yalnız o ajan ve kullanıcı görünümü görür), koşu kullanıcıca kabul edilince ortak belleğe terfi eder. Proje
ad alanındaki kişi/şirket/ürün kavramları ad alanına göre anahtarlanır (aynı adlı varlık projeler arasında kendiliğinden
birleşmez); konu kavramları ad anahtarlı kalır.
"""

from __future__ import annotations

import asyncio
import hashlib
import inspect
import logging
import math
import re
import sqlite3
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Iterable

import httpx

from studio.config import Settings
from studio.graph import assertion as asn
from studio.graph import namespace as nsm
from studio.graph.extract import Extraction, fts_query, heuristic_extract, llm_extract, tokens, tr_lower
from studio.graph.namespace import GLOBAL, NamespaceError
from studio.graph.store import GraphStore, now_iso
from studio.i18n import agent_lang
from studio.locales.prompts import texts as prompt_texts
from studio.ontology import normalize_key

log = logging.getLogger("studio.graph.memory")

TYPE_WEIGHT = {"Fact": 1.0, "Episode": 0.85, "Concept": 0.6}
MEMORY_TYPES = ("Fact", "Episode", "Concept")


def fact_hash(statement: str, namespace: str = GLOBAL) -> str:
    """Fact anahtarı. Global: eski hash (geriye uyum); proje: ad alanı tuzlu → projeler arası birleşme olmaz."""
    norm = normalize_key(statement)
    if nsm.is_global(namespace):
        return hashlib.sha1(norm.encode("utf-8")).hexdigest()[:16]
    return hashlib.sha1(f"{namespace}\x1f{norm}".encode("utf-8")).hexdigest()[:16]


# (AW-R14): graf genişlemesi adım sayısı. 1 = FTS tohumu + kavram/anı komşuluğu (varsayılan, eski davranış);
# 0 = yalnız FTS metin eşleşmesi. Ayar `memory.graph_expand`; değerlendirme matrisi yalnız kendi yalıtılmış ad alanı
# için geçici geçersiz kılma kaydeder (kullanıcının koşularını ve ayarını etkilemez).
_EXPAND_OVERRIDES: dict[str, int] = {}


GRAPH_EXPAND_RANGE = (0, 2)  # ayar değeri tam sayı 0..2 (2 = 1 ile aynı; şimdilik tek adım genişleme uygulanır)


def graph_expand_value(raw: object) -> int | None:
    """`memory.graph_expand` ayar değeri → 0..2 tam sayı; geçersizse (bool, metin, kesirli, NaN/Infinity, aralık
    dışı) None."""
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return None
    if isinstance(raw, float) and (raw != raw or raw in (float("inf"), float("-inf")) or not raw.is_integer()):
        return None
    v = int(raw)
    return v if GRAPH_EXPAND_RANGE[0] <= v <= GRAPH_EXPAND_RANGE[1] else None


def set_graph_expand(namespace: str, hops: int | None) -> None:
    """Ad alanına özel genişleme (0|1); None kaydı kaldırır."""
    if hops is None:
        _EXPAND_OVERRIDES.pop(namespace, None)
    else:
        _EXPAND_OVERRIDES[namespace] = 1 if int(hops) > 0 else 0


def ns_clause(alias: str = "nodes") -> str:
    """SQL: düğüm `:ns` ad alanında mı? Concept: `namespaces` listesi (yoksa global); diğerleri: `namespace`
    (yoksa global). Adlandırılmış parametre `:ns` kullanır."""
    a = alias
    return (f"(({a}.type = 'Concept' AND (EXISTS (SELECT 1 FROM json_each({a}.props, '$.namespaces') je "
            f"WHERE je.value = :ns) OR (:ns = 'global' AND "
            f"COALESCE(json_array_length({a}.props, '$.namespaces'), 0) = 0)))"
            f" OR ({a}.type <> 'Concept' AND COALESCE(json_extract({a}.props, '$.namespace'), 'global') = :ns))")


def retire_agent_memories(store: GraphStore, slug: str) -> int:
    """Silinen ajanın Episode/Fact düğümlerinin `agent` özelliğini `deleted:<slug>:<zaman>` mezar taşına taşır
    (AUDIT B-16). Anılar silinmez (bi-temporal ilke) ve ad alanları korunur; ama aynı slug ile yeniden oluşturulan
    ajan bunları "kendi" anısı sanmaz (özel kapsam, ×1.15 öncelik). Hazır hafıza düğümleri (`source` dolu, ör.
    `hero:<id>`) kendi kaynağının yaşam döngüsüne aittir (kahraman kaldırma onları `agent == slug` ile bulur) ve
    yeniden damgalanmaz. Değişen düğüm sayısını döner."""
    tomb = f"deleted:{slug}:{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}"
    return store.retag(("Episode", "Fact"), "agent", slug, tomb, skip_if_set="source")


GIFT_SOURCE = "gift"  # Episode.source = "gift:<tür>:<takdir kimliği ya da istek anahtarı>"


def is_gift_memory(props: dict[str, Any]) -> bool:
    """Takdir/hediye anısı mı? Görev yürütmede hatırlanmaz."""
    return str(props.get("source") or "").startswith(GIFT_SOURCE + ":")


@dataclass
class MemoryPack:
    query: str
    text: str = ""
    namespace: str = GLOBAL
    items: list[dict[str, Any]] = field(default_factory=list)

    @property
    def node_ids(self) -> list[str]:
        return [i["id"] for i in self.items]


def _confidence(v: Any) -> float:
    """güven [0, 1] aralığında ve sonlu (NaN/inf → varsayılan 0.5)."""
    try:
        x = float(v)
    except (TypeError, ValueError):
        return 0.5
    if not math.isfinite(x):
        return 0.5
    return max(0.0, min(1.0, x))


def _age_days(iso: str | None) -> float:
    if not iso:
        return 30.0
    try:
        dt = datetime.fromisoformat(iso)
    except ValueError:
        return 30.0
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return max(0.0, (datetime.now(timezone.utc) - dt).total_seconds() / 86400)


# recall satırı önekleri (📌 sabitleme işareti, "Kullanıcı beyanı:" etiketi) yalnız sistemce üretilir. Bilgi
# metni içinde geçerlerse satır ortasında sahte bir önek görünmesin diye çıkarılır: 📌 her bilgiden, beyan etiketi
# kullanıcı beyanı olmayan bilgiden.
_PIN_RE = re.compile("📌️?")
_USER_LABEL_RE = re.compile(r"(?i)\b(?:kullan[ıi]c[ıi]\s+beyan[ıi]|user\s+statement)\s*:")


_PIN_LIKE_RE = re.compile("[\U0001F4CC\U0001F4CD\U0001F588]️?")  # 📌 ve benzer iğne işaretleri (📍 🖈)


def _label_view(s: str) -> str:
    """etiket araması için karakter karakter (aynı uzunlukta) katlanmış görünüm: görünmez biçim karakteri →
    boşluk, NFKC tek karakter (tam genişlikli `：` → `:`), Kiril/Yunan/Ermeni/Çeroki benzer harf → Latin."""
    import unicodedata  # noqa: PLC0415

    from studio.graph.forget import _CONF_LOWER, _CONF_UPPER, _INVIS_RE  # noqa: PLC0415
    out = []
    for c in s:
        if _INVIS_RE.match(c):
            out.append(" ")
            continue
        n = unicodedata.normalize("NFKC", c)
        c2 = n if len(n) == 1 else c
        c2 = c2.translate(_CONF_UPPER).translate(_CONF_LOWER)
        out.append(c2 if len(c2) == 1 else c)
    return "".join(out)


def _defang(statement: str, *, user: bool) -> str:
    s = _PIN_LIKE_RE.sub("", _PIN_RE.sub("", statement))
    if not user:
        view = _label_view(s)
        for m in reversed(list(_USER_LABEL_RE.finditer(view))):
            s = s[:m.start()] + s[m.end():]
    return " ".join(s.split())


class GraphMemory:
    def __init__(self, store: GraphStore, settings: Settings):
        self.store = store
        self.settings = settings
        # Motor, CPU'yu ajan adımlarıyla paylaşmak için Ollama kilidini buraya verir.
        self.ollama_lock: asyncio.Semaphore | None = None
        # bilinçli birleştirme bitince çağrılır (`fn(run_id)`); kabul servisi geç terfiyi buradan yapar
        self.on_consolidated: list[Any] = []
        # beklemeye alınmış koşular (Run düğümü yoksa da; Run varsa `memory_hold` kalıcı kaynaktır)
        self._held_runs: dict[str, str] = {}
        # PROC2-FIX LLM bellek çıkarımı yerel bir adım (Ollama / Hermes › Ollama / yerel OpenAI uyumlu) çalışırken
        # aynı CPU için yarışmaz: motor `local_busy()` (yerel adım sürüyor mu) ve `local_epoch()` (yerel adım başlangıç
        # sayacı) verir. Çıkarım boşalana kadar ertelenir; yarışma yüzünden "çıkarım sonucu yok" olursa yeniden denenir.
        self.local_busy: Any = None
        self.local_epoch: Any = None
        self.defer_poll_s = 2.0
        self.defer_max_s = 3600.0
        self.extract_retries = 2
        try:  # eski bilgilere güvenli iddia varsayılanları (idempotent; updated_at korunur)
            asn.migrate_facts(store)
        except Exception:  # noqa: BLE001 - göç başarısızsa okuma tarafı aynı varsayılanları uygular
            pass

    @property
    def shared_write(self) -> str:
        """Karar R-1: `on_accept` (varsayılan) | `auto` | `manual`."""
        return asn.shared_write_mode(self.settings)

    # ------------------------------------------------------------ ad alanı
    @property
    def isolated(self) -> bool:
        """`memory.isolation` (çalışma anında değişebilir; her çağrıda okunur)."""
        return bool(self.settings.get("memory.isolation", True))

    def graph_expand(self, namespace: str) -> int:
        """recall'da graf genişlemesi (0|1). Ad alanı geçersiz kılması > `memory.graph_expand` (varsayılan 1)."""
        if namespace in _EXPAND_OVERRIDES:
            return _EXPAND_OVERRIDES[namespace]
        v = graph_expand_value(self.settings.get("memory.graph_expand", 1))  # geçersiz → varsayılan 1
        return 1 if v is None else (1 if v > 0 else 0)

    def _project_exists(self, key: str) -> bool:
        try:
            return self.store.find("Project", key) is not None
        except Exception:  # noqa: BLE001 - anahtar biçim hatası: yok say
            return False

    def namespace(self, value: Any) -> str:
        """İstek/koşu girdisinden kanonik ad alanı (`global` | `project:<k>`); geçersizse NamespaceError.
        Grafta `Project` düğümü olan (uzun) anahtarlar da kabul edilir."""
        if value == nsm.ALL:
            raise NamespaceError("Bellek işlemi tek bir ad alanında yapılır; '*' kabul edilmez")
        return nsm.normalize(value, project_exists=self._project_exists)

    def _read_filter(self, namespace: Any) -> tuple[str, str | None]:
        """(kanonik ad alanı, okuma süzgeci). Süzgeç None → izolasyon kapalı, eski davranış."""
        ns = self.namespace(namespace)
        return ns, (ns if self.isolated else None)

    # ------------------------------------------------------------------ recall
    def _visible(self, node: dict[str, Any], agent: str | None, scope: str, namespace: str | None = None,
                 include_gifts: bool = False) -> bool:
        p = node["props"]
        if is_gift_memory(p) and not include_gifts:
            return False  # takdir/hediye anısı (kurgu): görev yürütmede hatırlanmaz (eşit etki); yalnız sohbette açılır
        if p.get("review_hold"):
            return False  # PROC-FIX P2: revizyonu istenen / reddedilen sürümün anı ve bilgisi kabul edilene kadar beklemede
        if p.get("fact_kind") == "review_finding" or p.get("episode_kind") == "review":
            return False  # PROC2-FIX denetim adımının bulgusu dünyaya dair bilgi değildir; genel hatırlamaya girmez
        if node["type"] == "Fact":
            if not asn.is_current(p):
                return False  # geçersiz kılınmış / yerine yenisi geçmiş bilgi güncel olarak hatırlanmaz (silinmez)
            if asn.expired(p):
                return False  # geçerliliği bitmiş (valid_to geçmiş) bilgi hatırlanmaz
            if p.get("promoted_to"):
                return False  # R-1: terfi etmiş özel not — ortak kopyası hatırlanır
        if p.get("visibility") == "private" and agent and p.get("agent") != agent:
            return False  # R-1: başka ajanın kabul edilmemiş özel notu (agent=None: kullanıcı görünümü)
        if namespace is not None and not nsm.node_in(node, namespace):
            return False  # başka ad alanının anısı
        return not (scope == "private" and agent and p.get("agent") != agent)

    def _pinned(self, only: str | None) -> list[dict[str, Any]]:
        if only is None:  # izolasyon kapalı: eski davranış
            return self.store.find_by_prop("Fact", "pinned", True)
        out = self.store.nodes("Fact", limit=200, props={"pinned": True, "namespace": only})
        if only == GLOBAL:  # eski (damgasız) sabitlenmiş bilgiler global sayılır
            out += self.store.nodes("Fact", limit=200, props={"pinned": True, "namespace": None})
            out.sort(key=lambda n: n.get("updated_at") or "", reverse=True)
        return out

    def _search(self, fq: str, only: str | None, limit: int = 40) -> list[tuple[dict[str, Any], float]]:
        """FTS5 tohumları. İzolasyonda ad alanı SQL'de süzülür: başka projenin eşleşmeleri ne sonuç kümesini
        doldurur (aç bırakma) ne de skor normalizasyonunu etkiler."""
        if only is None:
            return self.store.search(fq, types=list(MEMORY_TYPES), limit=limit)
        sql = ("SELECT nodes_fts.node_id AS node_id, bm25(nodes_fts, 0.0, 0.0, 2.0, 1.0) AS s FROM nodes_fts "
               "JOIN nodes ON nodes.id = nodes_fts.node_id WHERE nodes_fts MATCH :q "
               "AND nodes_fts.type IN ('Fact', 'Episode', 'Concept') "
               f"AND {ns_clause('nodes')} ORDER BY s LIMIT :limit")
        with self.store._read() as conn:  # noqa: SLF001 - graf paketi içi: ad alanı süzgeçli FTS (store.search'te yok)
            try:
                rows = conn.execute(sql, {"q": fq, "ns": only, "limit": int(limit)}).fetchall()
            except sqlite3.OperationalError:
                return []
        found = self.store.get_nodes(r["node_id"] for r in rows)
        return [(found[r["node_id"]], -float(r["s"])) for r in rows if r["node_id"] in found]

    def recall(self, query: str, agent: str | None = None, scope: str = "shared",
               budget: int | None = None, limit: int = 10, lang: str | None = None, *,
               namespace: str = GLOBAL, include_gifts: bool = False) -> MemoryPack:
        """Skor = 0.55·alaka (normalize BM25 + graf genişleme) + 0.25·önem + 0.20·tazelik;
        ajanın kendi anılarına ×1.15. Sabitlenmiş bilgiler sorgudan bağımsız en üste eklenir.
        `lang` (S16): isteme giden bağlam bloğunun dili; verilmezse `agent_lang(settings)`.
        `namespace`: `global` | `project:<k>`; izolasyon açıkken yalnızca bu ad alanının anıları
        (tohum, kavram/ASSERTED_IN genişlemesi, sabitlenmiş bilgi) görülür.
        `include_gifts` (varsayılan False): takdir/hediye anıları (`source: gift:*`) yalnız sohbet amaçlı çağrıda
        (`True`) hatırlanır; görev yürütme (motor, önizleme) bunları hiç görmez — eşit etki."""
        budget = budget or int(self.settings.get("memory.budget_chars", 2400))
        P = prompt_texts(lang or agent_lang(self.settings))
        ns, only = self._read_filter(namespace)
        pack = MemoryPack(query=query, namespace=ns)
        pinned = [n for n in self._pinned(only) if self._visible(n, agent, scope, only, include_gifts)][:6]
        fq = fts_query(query)
        scores: dict[str, float] = {}
        nodes: dict[str, dict[str, Any]] = {}
        via: dict[str, str] = {}

        def add(node: dict[str, Any], score: float, reason: str) -> None:
            if node["type"] not in ("Fact", "Episode"):
                return
            if only is not None and not nsm.node_in(node, only):
                return  # başka ad alanı: skor tablosuna (ve `top` normalizasyonuna) hiç girmez
            nodes[node["id"]] = node
            if score > scores.get(node["id"], 0.0):
                scores[node["id"]] = score
                via[node["id"]] = reason

        hits = self._search(fq, only, limit=40) if fq else []
        expand = self.graph_expand(ns)
        for node, s in hits:
            s = max(s, 0.01) * TYPE_WEIGHT[node["type"]]
            if node["type"] == "Concept":
                if expand:
                    for _e, nb, _d in self.store.neighbors(node["id"], ["ABOUT", "MENTIONS"], "in"):
                        add(nb, s * 0.6, f"kavram: {node['label']}")
            elif node["type"] == "Episode":
                add(node, s, "metin eşleşmesi")
                if expand:
                    for _e, nb, _d in self.store.neighbors(node["id"], ["ASSERTED_IN"], "in"):
                        add(nb, s * 0.5, "aynı anıdan")
            else:
                add(node, s, "metin eşleşmesi")

        top = max(scores.values(), default=1.0) or 1.0
        summaries = self._episode_summaries([nid for nid in scores if nodes[nid]["type"] == "Episode"])
        pinned_ids = {n["id"] for n in pinned}
        ranked: list[tuple[float, dict[str, Any]]] = [(9.0, n) for n in pinned]
        for n in pinned:
            via[n["id"]] = "sabitlenmiş"
        for nid, base in scores.items():
            node = nodes[nid]
            if nid in pinned_ids or not self._visible(node, agent, scope, only, include_gifts):
                continue
            if node["type"] == "Episode" and summaries.get(nid) is None:
                continue  # B-15: özet, geçersiz kılınmış bir önermeyi ayıklanamayacak biçimde taşıyor
            p = node["props"]
            importance = int(p.get("importance") or 5) / 10
            recency = math.exp(-_age_days(p.get("created_at")) / 14)
            score = 0.55 * (base / top) + 0.25 * importance + 0.20 * recency
            if agent and p.get("agent") == agent:
                score *= 1.15
            ranked.append((score, node))
        ranked.sort(key=lambda t: -t[0])

        facts, episodes, used = [], [], 0
        seen_statements: set[str] = set()
        for score, node in ranked[: limit * 2]:
            p = node["props"]
            date = (p.get("created_at") or "")[:10]
            claim: dict[str, Any] = {}
            if node["type"] == "Fact":
                norm = normalize_key(str(p.get("statement") or node["label"]))
                if norm in seen_statements:
                    continue  # aynı önermenin özel ve ortak kopyası: bir kez
                seen_statements.add(norm)
                claim = asn.public_fields(asn.view(node))
                star = "📌 " if node["id"] in pinned_ids else ""
                # satır sonu/denetim karakteri tek boşluk olur; ajan çıktısı başka bir recall satırı uyduramaz
                statement = " ".join(str(p.get("statement", node["label"])).split())
                statement = _defang(statement, user=claim.get("origin") == "user_stated")
                marker = asn.prompt_marker(claim)
                if marker:  # AW-R24/R29: güvenilmeyen/doğrulanmamış ya da tartışmalı bilgi etiketle girer
                    statement = f"{statement} {P.get(f'recall.{marker}', '')}".rstrip()
                line = P["recall.fact_line"].format(star=star, statement=statement,
                                                    agent=p.get("agent", "?"), date=date)
            else:
                line = f"- {date} · {p.get('agent', '?')} · {p.get('title', '')}: {summaries.get(node['id'], '')}"
            if used + len(line) > budget or len(facts) + len(episodes) >= limit:
                break
            used += len(line)
            (facts if node["type"] == "Fact" else episodes).append(line)
            pack.items.append({"id": node["id"], "type": node["type"], "label": node["label"],
                               "agent": p.get("agent"), "created_at": p.get("created_at"),
                               "namespace": nsm.of_node(node), "visibility": p.get("visibility") or "shared",
                               "score": round(score, 3), "via": via[node["id"]], **claim})
        if not pack.items:
            return pack
        parts = [P["recall.intro"]]
        if facts:
            parts.append(P["recall.facts"] + "\n" + "\n".join(facts))
        if episodes:
            parts.append(P["recall.episodes"] + "\n" + "\n".join(episodes))
        pack.text = "\n\n".join(parts)
        return pack

    def _episode_summaries(self, episode_ids: list[str]) -> dict[str, str | None]:
        """Hatırlanacak Episode özetleri (AUDIT B-15): geçersiz kılınmış bilgi, kaynak anının özetiyle geri sızmaz.
        Episode'a ASSERTED_IN ile bağlı geçersiz bir önerme özette aynen geçiyorsa özetten çıkarılır; aynen
        bulunamıyorsa (kırpılmış ya da LLM'in yeniden yazdığı özet) ayıklama güvenilir olmadığından anı hiç
        hatırlanmaz (None). Geçerli bilgiler kendi Fact düğümleriyle hatırlanmaya devam eder."""
        if not episode_ids:
            return {}
        eps = self.store.get_nodes(episode_ids)
        facts = self.store.neighbors_many(episode_ids, ["ASSERTED_IN"], "in")
        out: dict[str, str | None] = {}
        for nid in episode_ids:
            summary: str | None = str((eps.get(nid) or {}).get("props", {}).get("summary") or "")
            stripped = False
            for _e, fact, _d in facts.get(nid, []):
                if fact["type"] != "Fact" or asn.is_current(fact["props"]):
                    continue
                statement = str(fact["props"].get("statement") or "").strip()
                if not statement or statement not in summary:
                    summary = None
                    break
                summary = summary.replace(statement, " ")
                stripped = True
            if summary is not None and stripped:
                summary = " ".join(summary.split()) or None
            out[nid] = summary
        return out

    # ------------------------------------------------------------- takdir/hediye anısı
    def remember_gift(self, agent_node_id: str | None, *, slug: str, key: str, kind: str, ref: str, title: str,
                      summary: str, namespace: Any = GLOBAL, created_at: str | None = None,
                      overwrite: bool = True) -> dict[str, Any]:
        """Kullanıcının hediyesini/teşekkürünü ajanın epizodik belleğine yazar (idempotent: `key` aynıysa aynı anı).
        Ontolojide yeni tür yok: `Episode` (`source: gift:<tür>:<ref>`, `extractor: recognition`) + `REMEMBERS`.
        Özel (`private`) anıdır ve `run_id` taşımaz: koşu kabul/terfi/bekletme akışlarına girmez; görev yürütmede
        hatırlanmaz (`recall(include_gifts=False)`), konuşmada `include_gifts=True` ile açılır."""
        try:
            ns = self.namespace(namespace)
        except NamespaceError:
            ns = GLOBAL
        ep_id = "ep_gift_" + hashlib.sha1(key.encode("utf-8")).hexdigest()[:14]
        if not overwrite and (prior := self.store.find("Episode", ep_id)) is not None:
            return prior  # geriye dönük yazım var olan anıyı (ve notunu) ezmez
        episode = self.store.upsert_node("Episode", {
            "id": ep_id, "title": title[:120], "summary": summary[:600], "agent": slug,
            "extractor": "recognition", "namespace": ns, "importance": 4, "created_at": created_at or now_iso(),
            "visibility": "private", "source": f"{GIFT_SOURCE}:{kind}:{ref}", "complete": True})
        if agent_node_id:
            self.store.link("REMEMBERS", agent_node_id, episode["id"])
        return episode

    def forget_gift(self, ref: str) -> int:
        """Bir takdir kaydı silinince ona bağlı hediye anıları da gider (`source` sonu `:<ref>`)."""
        n = 0
        for ep in self.store.nodes("Episode", limit=500, props={"extractor": "recognition"}):
            if str(ep["props"].get("source") or "").endswith(f":{ref}"):
                self.store.delete_node(ep["id"])
                n += 1
        return n

    # ------------------------------------------------------------- okuma (REST)
    def agent_memory(self, agent_node_id: str, namespace: Any = GLOBAL, *, episodes: int = 30,
                     facts: int = 40) -> dict[str, Any]:
        """`/api/agents/{slug}/memory`: ajanın son anıları ve onlardan çıkan bilgiler — ad alanıyla süzülü."""
        ns, only = self._read_filter(namespace)
        eps = sorted((nb for _e, nb, _d in self.store.neighbors(agent_node_id, ["REMEMBERS"], "out")
                      if only is None or nsm.node_in(nb, only)),
                     key=lambda n: n["created_at"], reverse=True)[:episodes]
        out_facts: list[dict[str, Any]] = []
        for ep in eps[:12]:
            out_facts += [nb for _e, nb, _d in self.store.neighbors(ep["id"], ["ASSERTED_IN"], "in")
                          if only is None or nsm.node_in(nb, only)]
        return {"namespace": ns, "isolation": only is not None, "episodes": eps, "facts": out_facts[:facts]}

    def dump(self, types: Iterable[str] | None, limit: int, namespace: Any, *, offset: int = 0,
             q: str | None = None) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """Bellek gezgini için graf dökümü, ad alanıyla süzülü: Episode/Fact/Concept düğümleri yalnızca bu ad
        alanındakiler; diğer türler (Agent, Run …) olduğu gibi. İzolasyon ayarından bağımsızdır (açık süzgeç)."""
        ns = self.namespace(namespace)
        type_list = [t for t in (types or []) if t]
        where = [f"(nodes.type NOT IN ('Episode', 'Fact', 'Concept') OR {ns_clause('nodes')})"]
        params: dict[str, Any] = {"ns": ns, "limit": int(limit), "offset": max(0, int(offset))}
        if type_list:
            names = []
            for i, t in enumerate(type_list):
                params[f"t{i}"] = t
                names.append(f":t{i}")
            where.append(f"nodes.type IN ({','.join(names)})")
        if q:
            params["like"] = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            where.append("(nodes.label LIKE :like ESCAPE '\\' OR nodes.key LIKE :like ESCAPE '\\')")
        from studio.graph.store import _edge, _node  # noqa: PLC0415 - graf paketi içi satır dönüştürücüleri
        with self.store._read() as conn:  # noqa: SLF001
            rows = conn.execute(f"SELECT * FROM nodes WHERE {' AND '.join(where)} ORDER BY updated_at DESC "
                                "LIMIT :limit OFFSET :offset", params).fetchall()
            nodes = [_node(r) for r in rows]
            ids = [n["id"] for n in nodes]
            if not ids:
                return [], []
            marks = ",".join("?" * len(ids))
            edges = [_edge(r) for r in conn.execute(
                f"SELECT * FROM edges WHERE src IN ({marks}) AND dst IN ({marks})", (*ids, *ids)).fetchall()]
        return nodes, edges

    def namespaces(self) -> list[dict[str, Any]]:
        """Bilinen ad alanları: bellekte anısı olanlar (Episode/Fact sayılarıyla) + grafta `Project` düğümü olan
        ve kurallara uyan anahtarlar. Global her zaman ilk sıradadır."""
        counts: dict[str, dict[str, int]] = {GLOBAL: {"episodes": 0, "facts": 0}}
        with self.store._read() as conn:  # noqa: SLF001
            for r in conn.execute("SELECT COALESCE(json_extract(props, '$.namespace'), 'global') AS ns, type, "
                                  "COUNT(*) AS c FROM nodes WHERE type IN ('Episode', 'Fact') GROUP BY ns, type"):
                c = counts.setdefault(str(r["ns"]), {"episodes": 0, "facts": 0})
                c["episodes" if r["type"] == "Episode" else "facts"] += int(r["c"])
        names: dict[str, str] = {}
        for node in self.store.nodes("Project", limit=500):
            key = str(node["props"].get("key") or "")
            if nsm.PROJECT_NODE_KEY_RE.match(key):
                ns = nsm.PROJECT_PREFIX + key
                names[ns] = str(node["props"].get("name") or key)
                counts.setdefault(ns, {"episodes": 0, "facts": 0})
        return [{"namespace": ns, "key": nsm.key_of(ns), "name": names.get(ns) or nsm.key_of(ns),
                 "project": ns in names, **counts[ns]} for ns in nsm.distinct(counts)]

    # ------------------------------------------------------------- consolidate
    def extract_system(self, lang: str | None = None) -> str:
        """LLM çıkarım isteminin (extract.LLM_SYSTEM) ajan dilindeki sürümü (S16)."""
        return prompt_texts(lang or agent_lang(self.settings))["extract.system"]

    async def extract(self, text: str, title: str) -> Extraction:
        mode = self.settings.get("memory.extractor", "auto")
        if mode in ("auto", "llm"):
            url = self.settings.get("ollama_url")
            model = self.settings.get("memory.extractor_model", "qwen3:4b")
            if self._extractor_allowed(model) and await self._ollama_has(url, model):
                result = await self._llm_extract_accounted(url, model, text, title)
                if result is not None:
                    return result
        return heuristic_extract(text, title)

    async def _llm_extract_accounted(self, url: str, model: str, text: str, title: str) -> Extraction | None:
        """AUDIT P1 (B-B): LLM çıkarımı bir sistem çağrısıdır — günlük tavan kapısı, günlük defter, kullanım ve
        `SystemCall` düğümü (`workflow.system_calls.account`). Tavan doluysa LLM çağrılmaz (sezgisele düşülür)."""
        from studio.workflow import system_calls  # noqa: PLC0415
        from studio.workflow.daily import DailyBudgetReached  # noqa: PLC0415
        kwargs = self._extract_kwargs()
        deferred = await self._wait_local_idle()  # PROC2-FIX yerel adım sürerken çıkarım bekler (varsayılan)
        try:
            with system_calls.account(self.settings, "memory_extract", ref=title[:120] or None, store=self.store,
                                      connector="ollama", connection="ollama", model=model,
                                      title=f"Bellek çıkarımı: {title}"[:90]) as call:
                result: Extraction | None = None
                retries = 0
                for attempt in range(1 + max(0, int(self.extract_retries))):
                    usage: dict[str, Any] = {}
                    epoch0 = self._local_epoch()
                    if self.ollama_lock is not None:
                        async with self.ollama_lock:
                            result = await llm_extract(url, model, text, title, settings=self.settings, usage=usage,
                                                       **kwargs)
                    else:
                        result = await llm_extract(url, model, text, title, settings=self.settings, usage=usage,
                                                   **kwargs)
                    call.add_usage(usage)
                    if result is not None:
                        break
                    # yarışma: çağrı sürerken yerel bir adım başladı ya da hâlâ sürüyor → sessizce düşme, boşalınca yeniden
                    contended = self._local_running() or self._local_epoch() != epoch0
                    if not contended or attempt >= int(self.extract_retries):
                        break
                    retries += 1
                    deferred += await self._wait_local_idle()
                if retries or deferred:
                    call.usage["retries"] = retries
                    call.usage["deferred_ms"] = int(deferred * 1000)
                if result is None:
                    call.fail("çıkarım sonucu yok" + (f" ({retries} yeniden deneme, yerel adımla yarışma)"
                                                      if retries else ""))
                return result
        except DailyBudgetReached:
            return None

    def _local_running(self) -> bool:
        try:
            return bool(self.local_busy()) if callable(self.local_busy) else False
        except Exception:  # noqa: BLE001 - motor durumu okunamazsa bekleme yok (eski davranış)
            return False

    def _local_epoch(self) -> int:
        try:
            return int(self.local_epoch()) if callable(self.local_epoch) else 0
        except Exception:  # noqa: BLE001
            return 0

    async def _wait_local_idle(self) -> float:
        """PROC2-FIX yerel adım bitene kadar bekler (en çok `defer_max_s`). Dönüş: beklenen saniye."""
        if not self._local_running():
            return 0.0
        t0 = time.monotonic()
        while self._local_running() and time.monotonic() - t0 < float(self.defer_max_s):
            await asyncio.sleep(max(0.01, float(self.defer_poll_s)))
        return time.monotonic() - t0

    def _extractor_allowed(self, model: str) -> bool:
        """LLM çıkarımı da model erişim politikasına uyar (local_only'de uzak Ollama'ya bellek metni gitmez;
        uzak sunucu onaysız kullanılmaz). İzin yoksa sezgisel çıkarım kullanılır."""
        from studio.connections import policy as model_policy  # noqa: PLC0415

        try:
            d = model_policy.describe(self.settings, "ollama", model)
            return model_policy.evaluate(self.settings, d, check_consent=True).allowed
        except Exception:  # noqa: BLE001 - politika okunamazsa güvenli taraf: LLM'e gönderme
            return False

    def _extract_kwargs(self) -> dict[str, Any]:
        """EN'de çıkarım istemini `llm_extract(system=…)` ile geçirir; extract.py bu parametreyi
        desteklemiyorsa (teknik lidere istek) Türkçe istem kullanılır — davranış bozulmaz."""
        lang = agent_lang(self.settings)
        if lang == "tr":
            return {}
        try:
            params = inspect.signature(llm_extract).parameters
        except (TypeError, ValueError):
            return {}
        return {"system": self.extract_system(lang)} if "system" in params else {}

    async def consolidate(self, *, agent: str, agent_node_id: str | None, step_node_id: str | None,
                          run_id: str, step_key: str, title: str, text: str,
                          namespace: str = GLOBAL, step_kind: str | None = None) -> dict[str, Any]:
        """Adım çıktısını belleğe yazar; her düğüm `namespace` ile damgalanır (izolasyon ayarından bağımsız).

        bilgiler iddia alanlarıyla yazılır (`agent_inferred`, `untrusted`, kayıt zamanı, kök kanıt `run:<id>`,
        `created_by.extractor_version`). R-1 `on_accept`/`manual`: anı ve bilgiler ajana özel; `auto`: ortak.
        İdempotent (AW-T08): aynı adım anahtarı tamamlanmış bir anıya yeniden gelirse NOOP; yarıda kalmış yazım
        tamamlanır (kavram sayaçları yalnız yeni MENTIONS kenarında artar)."""
        ns = self.namespace(namespace)
        # Ajan çıktısındaki anahtar/jeton benzeri dizgiler belleğe yazılmaz: bilgiler başka ajanların istemine (bulut
        # API'lerine) hatırlanarak gider (AUDIT B-06). Desen tabanlı: Bearer, sk-/pk-/rk-, api_key= atamaları.
        from studio.changes import redact_text

        text = redact_text((text or "").strip())
        title = redact_text(title or "")
        if len(text) < 40:
            return {"skipped": True, "reason": "çıktı çok kısa"}
        st = self.store
        ep_id = f"ep:{step_key}"
        text_sha = hashlib.sha256(text.encode("utf-8", "replace")).hexdigest()[:32]
        prior = st.find("Episode", ep_id)
        stale: list[str] = []
        if prior is not None and prior["props"].get("complete"):
            if prior["props"].get("text_sha") in (None, text_sha):
                return {"skipped": False, "noop": True, "episode": prior["id"], "concepts": 0, "facts": 0,
                        "extractor": prior["props"].get("extractor"), "namespace": ns,
                        "visibility": prior["props"].get("visibility") or "shared"}
            # aynı adım turunun YENİ denemesi (retry): önceki denemenin notları bu anıdan düşer (aşağıda)
            stale = [nb["id"] for _e, nb, _d in st.neighbors(prior["id"], ["ASSERTED_IN"], "in") if nb["type"] == "Fact"]
        ex = await self.extract(text, title)
        private = self.shared_write != "auto"
        visibility = "private" if private else "shared"
        review = step_kind == "review"  # PROC2-FIX denetim bulgusu (denetlenen koşuya bağlı), dünya bilgisi değil
        episode = st.upsert_node("Episode", {
            "id": ep_id, "title": title[:120], "summary": ex.summary or text[:300],
            "agent": agent, "run_id": run_id, "extractor": ex.extractor, "importance": ex.importance,
            "namespace": ns, "created_at": now_iso(), "visibility": visibility, "extractor_version": ex.version,
            "text_sha": text_sha, "complete": False, **({"episode_kind": "review"} if review else {})})
        if agent_node_id:
            st.link("REMEMBERS", agent_node_id, episode["id"])
        if step_node_id:
            st.link("PRODUCED", step_node_id, episode["id"])
        artifacts = self._step_artifacts(step_node_id)
        source_ref = f"{ep_id}#{step_node_id}" if step_node_id else ep_id
        roots = [f"run:{run_id}", *(f"artifact:{a['props'].get('path')}" for a in artifacts)]

        concept_ids: dict[str, str] = {}
        for c in ex.concepts:
            cid = self._concept(c["name"], c.get("kind", "kavram"), ns, episode_id=episode["id"])
            if cid:
                concept_ids[normalize_key(c["name"])] = cid
                st.link("MENTIONS", episode["id"], cid)
        n_facts = 0
        from studio.graph.forget import ForgottenError  # noqa: PLC0415 - döngüsel içe aktarmadan kaçın

        fresh: set[str] = set()
        for f in ex.facts:
            statement = " ".join(str(f["statement"]).split())  # satır sonu yok (tek satır önerme)
            if not statement:
                continue
            digest = asn.private_hash(statement, ns, agent) if private else fact_hash(statement, ns)
            if review:  # bulgu ayrı düğüm: aynı cümleli dünya bilgisiyle birleşmez, denetlenen koşuya bağlı kalır
                digest = hashlib.sha1(f"review_finding\x1f{run_id}\x1f{digest}".encode("utf-8")).hexdigest()[:16]
            known = st.find("Fact", digest)
            if known is not None and nsm.of_node(known) != ns:
                # Savunma (pratikte olmaz: proje hash'i tuzlu): başka ad alanının düğümüne asla yazılmaz
                digest = hashlib.sha1(f"{ns}\x1f{digest}".encode("utf-8")).hexdigest()[:16]
                known = st.find("Fact", digest)
            if known is None:  # ADD
                at = now_iso()
                props: dict[str, Any] = {
                    "hash": digest, "statement": statement, "confidence": _confidence(f.get("confidence", 0.5)),
                    "importance": int(f.get("importance", 5)), "agent": agent, "namespace": ns, "created_at": at,
                    "origin": "agent_inferred",
                    # sezgisel çıkarıcı ajanın cümlesini aynen alır (iddia); LLM çıkarıcı yeniden yazar (çıkarım)
                    "epistemic_status": "inferred" if ex.extractor == "llm" else "asserted",
                    "lifecycle": "active", "trust": "untrusted", "visibility": visibility, "recorded_from": at,
                    "source_refs": [source_ref], "root_evidence_refs": roots,
                    "source_artifacts": [a["props"].get("path") for a in artifacts],
                    "created_by": {"agent": agent, "run": run_id, "extractor_version": ex.version},
                    "extractor_version": ex.version, "run_id": run_id, "version": 1}
                if review:
                    props.update(fact_kind="review_finding", review_of=run_id,
                                 review_step=step_key[len(run_id) + 1:].rsplit(":", 1)[0]
                                 if step_key.startswith(run_id + ":") else step_key)
                try:
                    fact = st.upsert_node("Fact", props)
                except ForgottenError:
                    continue  # unutulmuş bir bilginin kopyası tek başına atlanır; anının diğer bilgileri kalır
                if review:
                    run_node = st.find("Run", run_id)
                    if run_node is not None:
                        st.link("FINDING_OF", fact["id"], run_node["id"])
            else:  # NOOP: yalnız kanıt listeleri birleşir; önerme, puan ve sahiplik ilk yazımda kalır (B-07)
                try:
                    fact = st.upsert_node("Fact", {"hash": digest, "source_refs": [source_ref],
                                                   "root_evidence_refs": roots})
                except ForgottenError:
                    continue
            fresh.add(fact["id"])
            st.link("ASSERTED_IN", fact["id"], episode["id"])
            for art in artifacts:
                st.link("SUPPORTED_BY", fact["id"], art["id"])
            n_facts += 1
            about_ids = []
            for name in f.get("about", []):
                cid = concept_ids.get(normalize_key(name)) or self._concept(name, "kavram", ns)
                if cid:
                    concept_ids[normalize_key(name)] = cid
                    about_ids.append(cid)
                    st.link("ABOUT", fact["id"], cid)
            self._co_occur(about_ids, 1.0)
        self._co_occur(list(concept_ids.values())[:5], 0.5)
        dropped = self._discard_attempt(episode["id"], [fid for fid in stale if fid not in fresh])
        # koşunun sürüm kararı (revizyon / ret) bu yazımdan ÖNCE verildiyse geç gelen anı ve bilgiler de
        # beklemeye alınır (arka plan çıkarıcısı adım bittikten çok sonra yazabilir). Durum YAZIM anında okunur
        # (await yok: kararla yarışamaz); kabul edilen bir çatal bu adımı kopyaladıysa bekletilmez.
        late = self._late_hold(run_id, step_key)
        if late:
            self._hold_nodes([episode["id"], *sorted(fresh)], run_id, late)
        st.patch_node(episode["id"], {"complete": True})
        for fn in list(self.on_consolidated):
            try:
                fn(run_id)
            except Exception:  # noqa: BLE001 - kanca birleştirmeyi bozmaz
                pass
        return {"skipped": False, "episode": episode["id"], "concepts": len(concept_ids),
                "facts": n_facts, "extractor": ex.extractor, "namespace": ns, "visibility": visibility,
                **({"discarded": dropped} if dropped else {})}

    def _discard_attempt(self, episode_id: str, fact_ids: list[str]) -> int:
        """yeniden denenen adımın atılan denemesinden gelen notlar. Bu anıdan bağları kopar; başka anı
        tarafından da söylenmeyen ve henüz terfi etmemiş özel not geçersiz olur (silinmez; bitemporal: `recorded_to`).
        Kabulde terfi yalnız güncel notları taşır → atılan denemenin cümlesi ortak belleğe gitmez."""
        st = self.store
        n = 0
        at = now_iso()
        for fid in fact_ids:
            try:
                st.unlink("ASSERTED_IN", fid, episode_id)
                node = st.get_node(fid)
            except KeyError:
                continue
            others = [ep for _e, ep, _d in st.neighbors(fid, ["ASSERTED_IN"], "out")]
            p = asn.view(node)
            if others or p.get("promoted_to") or p.get("visibility") != "private" or not asn.is_current(p):
                continue
            st.patch_node(fid, {"lifecycle": "invalid", "invalid_at": at, "recorded_to": at,
                                "invalid_reason": "Adım yeniden denendi; bu not atılan denemeden"})
            n += 1
        return n

    def _step_artifacts(self, step_node_id: str | None) -> list[dict[str, Any]]:
        """Adımın ürettiği artefakt düğümleri (kaynak artefakt bağı; R11)."""
        if not step_node_id:
            return []
        try:
            return [nb for _e, nb, _d in self.store.neighbors(step_node_id, ["PRODUCED"], "out")
                    if nb["type"] == "Artifact"][:20]
        except KeyError:
            return []

    # ------------------------------------------------------------- R-1 terfi
    def promote_accepted(self, run_id: str, outcome: dict[str, Any] | None, *, reviewer_kind: str | None,
                         artifacts: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        """Kabul kancası (karar R-1). Yalnız `on_accept` kipinde, kullanıcı kararı ve türetilmiş sonuç `accepted`
        iken koşunun özel anı/bilgilerini ortak belleğe taşır. Ret, revizyon, kısmi kabul, ajan hakem kararı ya da
        diğer kipler terfi ettirmez. İdempotent."""
        mode = self.shared_write
        result = (outcome or {}).get("outcome")
        if mode != "on_accept" or reviewer_kind != "user" or result != "accepted":
            return {"promoted": False, "mode": mode, "outcome": result, "reviewer_kind": reviewer_kind}
        return {"promoted": True, "mode": mode, **asn.promote_run(self.store, run_id, artifacts=artifacts)}

    # ------------------------------------------------------------------ PROC-FIX P2: sürüm kararı ↔ bellek
    def _run_episodes(self, run_id: str, steps: set[str] | None = None) -> list[dict[str, Any]]:
        out = []
        for ep in self.store.nodes("Episode", limit=500, props={"run_id": run_id}):
            if steps is not None:
                made_by = {str(nb["props"].get("step_id") or "") for _e, nb, _d in
                           self.store.neighbors(ep["id"], ["PRODUCED"], "in") if nb["type"] == "Step"}
                if not made_by & steps:
                    continue
            out.append(ep)
        return out

    def _run_facts(self, run_id: str, steps: set[str] | None = None) -> list[dict[str, Any]]:
        """Koşunun anılarında (Episode.run_id) ileri sürülen bilgiler ve anıların kendisi; `steps` verilirse yalnız o
        adımların anıları."""
        out: dict[str, dict[str, Any]] = {}
        for ep in self._run_episodes(run_id, steps):
            out[ep["id"]] = ep
            for _e, nb, _d in self.store.neighbors(ep["id"], ["ASSERTED_IN"], "in"):
                if nb["type"] == "Fact":
                    out[nb["id"]] = nb
        return list(out.values())

    def _accepted_elsewhere(self, fact: dict[str, Any], run_id: str) -> bool:
        """Bilgi kabul edilmiş başka bir koşunun anısında da ileri sürüldü mü (o zaman beklemeye alınmaz)."""
        for _e, ep, _d in self.store.neighbors(fact["id"], ["ASSERTED_IN"], "out"):
            rid = str(ep["props"].get("run_id") or "")
            if ep["type"] == "Episode" and rid and rid != run_id:
                run = self.store.find("Run", rid)
                if run and run["props"].get("acceptance") == "accepted":
                    return True
        return False

    def _visible_elsewhere(self, fact: dict[str, Any], run_id: str) -> bool:
        """PROC2-FIX bilgi başka bir koşunun BEKLEMEDE OLMAYAN anısında da ileri sürüldü mü (ör. çatala kopyalanan
        ve serbest kalan adım). İncelenmemiş revizyon onu yeniden söyledi diye serbest bilgi gizlenmez."""
        if fact["props"].get("review_hold"):
            return False
        for _e, ep, _d in self.store.neighbors(fact["id"], ["ASSERTED_IN"], "out"):
            rid = str(ep["props"].get("run_id") or "")
            if ep["type"] == "Episode" and rid and rid != run_id and not ep["props"].get("review_hold"):
                return True
        return False

    def _spared(self, fact: dict[str, Any], run_id: str, state: str) -> bool:
        """Bekletmeden muaf bilgi: kabul edilmiş başka bir koşuda da söylendi; `pending_review` (incelenmemiş revizyon)
        için ayrıca başka bir koşuda serbest duruyor."""
        if self._accepted_elsewhere(fact, run_id):
            return True
        return state == "pending_review" and self._visible_elsewhere(fact, run_id)

    def _set_run_hold(self, run_id: str, state: str | None) -> None:
        """koşunun bekletme durumu yazım anı denetimi için saklanır (Run düğümünde kalıcı + süreç içi)."""
        if state:
            self._held_runs[run_id] = state
        else:
            self._held_runs.pop(run_id, None)
        try:
            rnode = self.store.find("Run", run_id)
            if rnode is not None and rnode["props"].get("memory_hold") != state:
                self.store.patch_node(rnode["id"], {"memory_hold": state})
        except Exception:  # noqa: BLE001 - Run düğümü yazılamazsa süreç içi kayıt yeter
            log.warning("koşunun bellek bekletme durumu kaydedilemedi")

    def _run_hold_state(self, run_id: str) -> str | None:
        try:
            rnode = self.store.find("Run", run_id) if run_id else None
        except Exception:  # noqa: BLE001
            rnode = None
        state = (rnode or {}).get("props", {}).get("memory_hold") if rnode else None
        return state or self._held_runs.get(run_id)

    def _copied_by_accepted_fork(self, run_id: str, step_id: str | None) -> bool:
        """Bu koşudan çatallanıp KABUL edilen bir sürüm bu adımı kopyaladıysa (yeniden çalıştırmadıysa) adımın bilgisi
        kabul edilmiş sayılır (release_run'ın `inherited` kuralının yazım anı karşılığı)."""
        if not step_id:
            return False
        try:
            kids = self.store.nodes("Run", limit=200, props={"forked_from": run_id})
        except Exception:  # noqa: BLE001
            return False
        for k in kids:
            kp = k["props"]
            if kp.get("acceptance") != "accepted":
                continue
            ck = kp.get("checkpoint") or {}
            steps = ck.get("steps") if isinstance(ck, dict) else None
            for it in steps or []:
                if isinstance(it, dict) and it.get("copied") and str((it.get("spec") or {}).get("id")) == step_id:
                    return True
        return False

    def _late_hold(self, run_id: str, step_key: str) -> str | None:
        """Yazım anında koşunun bekletme durumu (yoksa None). Adım kimliği `step_key`den (`<koşu>:<adım>:<deneme>`)."""
        if not run_id:
            return None
        state = self._run_hold_state(run_id)
        if not state:
            return None
        rest = step_key[len(run_id) + 1:] if step_key.startswith(run_id + ":") else step_key
        step_id = rest.rsplit(":", 1)[0] if ":" in rest else rest
        if self._copied_by_accepted_fork(run_id, step_id or None):
            return None
        return state

    def _hold_nodes(self, ids: list[str], run_id: str, state: str) -> int:
        n = 0
        for nid in ids:
            try:
                node = self.store.get_node(nid)
            except KeyError:
                continue
            if node["props"].get("review_hold") == state:
                continue
            if node["type"] == "Fact" and self._spared(node, run_id, state):
                continue
            self.store.patch_node(nid, {"review_hold": state, **({"review_run": run_id}
                                                                  if node["type"] == "Fact" else {})})
            n += 1
        return n

    def hold_run(self, run_id: str, state: str) -> int:
        """Kullanıcı bu sürüm için revizyon istedi ya da reddetti: koşunun bilgileri `review_hold` ile beklemeye alınır
        (hatırlanmaz, yeni görevin bellek önizlemesine girmez). Silinmez; kabul edilen bir sürüm onları geri açar.
        durum koşuya da yazılır; bu karardan SONRA birleştirilen bilgiler yazılırken beklemeye alınır."""
        self._set_run_hold(run_id, state)
        n = 0
        for node in self._run_facts(run_id):
            if node["props"].get("review_hold") == state:
                continue
            if node["type"] == "Fact" and self._spared(node, run_id, state):
                continue
            self.store.patch_node(node["id"], {"review_hold": state, **({"review_run": run_id}
                                                                         if node["type"] == "Fact" else {})})
            n += 1
        return n

    def release_run(self, run_id: str, inherited: dict[str, set[str]] | None = None) -> int:
        """Kullanıcı bu sürümü kabul etti: koşunun ve çatala kopyalanan (yeniden çalışmayan) ebeveyn adımlarının
        bilgileri yeniden etkin olur. `inherited` = {ebeveyn koşu: {kopyalanan adım kimlikleri}}."""
        self._set_run_hold(run_id, None)  # bu sürümün geç gelen bilgileri artık bekletilmez
        facts = self._run_facts(run_id)
        for parent, steps in (inherited or {}).items():
            if steps:
                facts += self._run_facts(parent, set(steps))
        n = 0
        for node in facts:
            if node["props"].get("review_hold"):
                self.store.patch_node(node["id"], {"review_hold": None, **({"review_run": None}
                                                                         if node["type"] == "Fact" else {})})
                n += 1
        return n

    def set_fact_state(self, fact_id: str, *, pinned: bool | None = None, invalid: bool | None = None,
                       reason: str | None = None, namespace: str | None = None, by: str = "user") -> dict[str, Any]:
        """Bilgiyi sabitle/çöz veya geçersiz kıl/geri al. Hiçbir bilgi silinmez (bi-temporal).
        `namespace` verilirse bilgi o ad alanında değilse işlem reddedilir. Güvenilmeyen bilgi kullanıcı
        dışında sabitlenemez (AW-R24). Geçersiz kılma `lifecycle=invalid` + `recorded_to`; geri alma ikisini de
        geri çevirir."""
        node = self.store.get_node(fact_id)
        if node["type"] != "Fact":
            raise ValueError("Yalnızca Bilgi (Fact) düğümleri sabitlenebilir veya geçersiz kılınabilir")
        if namespace is not None and nsm.of_node(node) != self.namespace(namespace):
            raise NamespaceError("Bu bilgi başka bir bellek ad alanına ait; işlem reddedildi")
        asn.check_pin(node, pinned, by)
        cur = asn.view(node)
        patch: dict[str, Any] = {}
        if pinned is not None:
            patch["pinned"] = bool(pinned)
        if invalid is True:
            at = now_iso()
            patch.update(invalid_at=at, invalid_reason=(reason or "Kullanıcı geçersiz kıldı")[:300], pinned=False,
                         lifecycle="invalid", recorded_to=at)
        elif invalid is False:
            patch.update(invalid_at=None, invalid_reason=None)
            if cur.get("lifecycle") == "invalid" and not cur.get("corrected_by"):
                patch.update(lifecycle="active", recorded_to=None)
        if invalid is not None:
            patch["version"] = int(cur.get("version") or 1) + 1
        return self.store.patch_node(fact_id, patch)

    def link_task_concepts(self, task_node_id: str, prompt: str, namespace: str = GLOBAL) -> int:
        """Görev metnindeki, grafta zaten var olan kavramları görev düğümüne bağlar. İzolasyonda yalnızca görevin ad
        alanında görülmüş kavramlar bağlanır (başka projenin kavram adı görev grafına sızmaz). önce ad alanı
        anahtarlı kavram, yoksa eski (listeli) kavram."""
        ns, only = self._read_filter(namespace)
        linked = 0
        for tok in dict.fromkeys(tokens(prompt)):
            node = self.store.find("Concept", asn.concept_key(tok, "kişi", ns)) or self.store.find("Concept", tok)
            if node and (only is None or nsm.node_in(node, only)):
                self.store.link("MENTIONS", task_node_id, node["id"])
                linked += 1
        return linked

    def _concept(self, name: str, kind: str, namespace: str = GLOBAL, *, episode_id: str | None = None) -> str | None:
        name = name.strip()
        if len(name) < 2 or tr_lower(name) in ("", "-"):
            return None
        key = asn.concept_key(name, kind, namespace)
        scoped = key != name
        from studio.graph.forget import ForgottenError  # noqa: PLC0415 - döngüsel içe aktarmadan kaçın
        # B-19: oku-artır-yaz tek yazma işlemi içinde (yazma kilidi tutulur) → eşzamanlı ajanlar sayaç kaybetmez.
        # Kilit sahibi okumayı yazıcı bağlantısından yapar, yani gördüğü değer en günceli.
        try:
            with self.store.bulk():
                existing = self.store.find("Concept", key)
                if existing and episode_id and self.store.has_edge("MENTIONS", episode_id, existing["id"]):
                    return existing["id"]  # AW-T08: aynı anının yeniden işlenmesi sayacı artırmaz
                mentions = int(existing["props"].get("mentions", 0)) + 1 if existing else 1
                namespaces = [namespace] if scoped else nsm.merged_concept_namespaces(existing, namespace)
                node = self.store.upsert_node("Concept", {"name": key, "display": name, "kind": kind,
                                                          "mentions": mentions, "namespaces": namespaces})
        except ForgottenError:
            return None  # unutulmuş bir jetonu ad olarak taşıyan kavram yazılmaz
        return node["id"]

    def _co_occur(self, ids: list[str], weight: float) -> None:
        uniq = sorted(set(ids))
        for i, a in enumerate(uniq):
            for b in uniq[i + 1:]:
                self.store.link("RELATED_TO", a, b, weight_inc=weight)

    @staticmethod
    async def _ollama_has(url: str, model: str) -> bool:
        try:
            async with httpx.AsyncClient(timeout=3) as client:
                tags = (await client.get(f"{url.rstrip('/')}/api/tags")).json().get("models", [])
        except (httpx.HTTPError, ValueError):
            return False
        return any(m.get("name") == model or m.get("model") == model for m in tags)
