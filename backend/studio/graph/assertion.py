"""Bellek iddiası v1 (AW-R09–R13, R16, R24, R29; Rehber 1 §6.4–§7.1).

Bir `Fact` düğümü artık yalnız "önerme + LLM puanı" değil, kaynağı ve zamanı belli bir **iddia**dır:

- `origin`: `user_stated | agent_inferred | tool_observed | imported` — iddia nereden geldi.
- `epistemic_status`: `asserted | inferred | verified | disputed`. **`verified` yalnız kullanıcıdan** (`verify(by="user")`);
  üretici ajan, çıkarıcı ya da terfi bunu atayamaz.
- `lifecycle`: `active | superseded | invalid` — yalnız `active` olan "güncel" hatırlanır.
- `trust`: `trusted | untrusted`. Ajan çıktısı (araç, web, gelen kutusu ve hatırlanan bellek içerebilir; stüdyo CLI
  ajanlarının iç araç kullanımını göremez) `untrusted` yazılır; `trusted` yalnız kullanıcı beyanı ya da kullanıcı
  doğrulamasıyla olur. Güvenilmeyen bilgi kullanıcı dışında sabitlenemez ve isteme "(doğrulanmamış)" etiketiyle girer.
- Zaman iki eksenlidir: `valid_from/valid_to` (dünyada ne zaman geçerli; bilinmiyorsa yok = null — kayıt zamanıyla
  DOLDURULMAZ) ve `recorded_from/recorded_to` (sistem bu sürümü ne zaman öğrendi / ne zamana kadar böyle bildi).
- Köken: `source_refs` (Episode#Step), `root_evidence_refs` (`run:<id>` — aynı koşudaki zincir tek kök sayılır;
  `artifact:<yol>@sha256:<x>`; `user:<zaman>`), `source_artifacts`, `created_by {agent, run, extractor_version}`.
  Bu alanlar ve `DERIVED_FROM` kenarı unutma planının türetilmiş veriyi (terfi kopyası, düzeltme) bulmasını sağlar.
- `confidence` / `importance` LLM tahminidir: yalnız sıralama ipucu (arayüzde "model tahmini"); yetki ya da kesinlik
  üretmez.

Yazma işlemleri (`ADD`, `NOOP`, `SUPERSEDE`, `CORRECT`, `DISPUTE`) beklenen sürüme (`version`) karşı tek yazma kilidinde
yapılır; uyuşmazlık `AssertionConflict` (409) — sessiz "son yazan kazanır" yok (AW-T07). Hiçbir işlem düğüm silmez:
eski sürüm grafta kalır ve `SUPERSEDES` / `CORRECTS` / `CONTRADICTS` kenarıyla bağlanır (geri alınabilir geçmiş).

Ortak yazma (karar R-1, `memory.shared_write`):
- `on_accept` (varsayılan): koşunun anı ve bilgileri ajana özel (`visibility: private`) yazılır; koşu kullanıcıca kabul
  edilip türetilmiş sonuç (`evals.outcome.derive_outcome`) `accepted` olunca ortak belleğe terfi eder (`promote_run`).
  Terfi idempotenttir (deterministik anahtar + benzersiz kenar); ret, revizyon, kısmi kabul ya da ajan hakem kabulü
  terfi ettirmez.
- `auto`: eski davranış (her çıktı ortak). `manual`: kullanıcı bilgi bilgi terfi ettirir (`promote_fact`).

Göç (`migrate_facts`): alanı olmayan eski bilgi `origin=agent_inferred` (kaynaklı hazır hafıza `imported`),
`epistemic_status=asserted`, `trust=untrusted` (kullanıcı girdisi değil), `recorded_from = eski valid_at`
(yoksa created_at), `valid_from` yok, `visibility=shared` (eskiden zaten ortaktı), `version=1` olur. `updated_at`
değişmez; yeniden çalıştırmak etkisizdir. Okuma tarafı (`view`) aynı varsayılanları göçten bağımsız uygular — sonradan
alan yazmadan oluşturulan bilgi (eval tohumu, hazır hafıza) de doğru okunur.
"""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Any, Iterable

from studio.graph import namespace as nsm
from studio.graph.namespace import GLOBAL, NamespaceError
from studio.graph.store import GraphStore, now_iso
from studio.ontology import normalize_key

log = logging.getLogger(__name__)

ORIGINS = ("user_stated", "agent_inferred", "tool_observed", "imported")
STATUSES = ("asserted", "inferred", "verified", "disputed")
LIFECYCLES = ("active", "superseded", "invalid")
TRUST = ("trusted", "untrusted")
VISIBILITY = ("private", "shared")
SHARED_WRITE_MODES = ("on_accept", "auto", "manual")
DEFAULT_SHARED_WRITE = "on_accept"
LEGACY_EXTRACTOR = "legacy"
HISTORY_RELS = ("SUPERSEDES", "CORRECTS", "CONTRADICTS", "DERIVED_FROM")
MAX_STATEMENT = 300

ERR_USER_ONLY_VERIFY = "Bilgiyi yalnız kullanıcı doğrulayabilir"
ERR_USER_ONLY = "Bu bellek işlemini yalnız kullanıcı yapabilir"
ERR_UNTRUSTED_PIN = "Doğrulanmamış (güvenilmeyen kaynaklı) bilgi kendiliğinden sabitlenemez"
ERR_NOT_FACT = "Yalnızca Bilgi (Fact) düğümlerinde iddia işlemi yapılır"
ERR_NOT_ACTIVE = "Bu bilgi artık güncel değil (yerine yenisi geçmiş ya da geçersiz); işlem güncel sürümde yapılır"
ERR_EMPTY = "Bilgi metni boş olamaz"
ERR_REASON = "İtiraz için kısa bir neden yaz"
ERR_PRIVATE_ONLY = "Yalnız ajana özel bilgi terfi ettirilebilir"
ERR_DATE = "Tarih ISO biçiminde olmalı (ör. 2026-11-15 ya da 2026-11-15T09:00:00+00:00): {}"
ERR_WINDOW = "Geçerlilik başlangıcı bitişinden sonra olamaz"
ERR_VERSION = "expected_version pozitif bir tam sayı olmalı"
ERR_REVIVE = ("Bu ifadenin yerine daha yeni bir bilgi geçti; eski ifadeyi geri getirmek için güncel bilgiyi "
              "değiştir (supersede/correct)")


class AssertionConflict(ValueError):
    """Beklenen sürüm uyuşmadı (eşzamanlı değişiklik): 409. Sessiz kayıp güncelleme yerine görünür çatışma."""

    def __init__(self, fact_id: str, expected: int, actual: int):
        super().__init__(f"Sürüm çatışması: bilgi değişti (beklenen {expected}, güncel {actual}); yenileyip tekrar dene")
        self.fact_id, self.expected, self.actual = fact_id, expected, actual


class AssertionDenied(PermissionError):
    """Yetkisiz iddia işlemi (ör. kullanıcı dışından doğrulama): 403."""


# ------------------------------------------------------------------ ayar
def shared_write_mode(settings: Any) -> str:
    try:
        mode = str(settings.get("memory.shared_write", DEFAULT_SHARED_WRITE) or DEFAULT_SHARED_WRITE)
    except Exception:  # noqa: BLE001 - ayar okunamazsa güvenli varsayılan
        mode = DEFAULT_SHARED_WRITE
    return mode if mode in SHARED_WRITE_MODES else DEFAULT_SHARED_WRITE


# ------------------------------------------------------------------ anahtarlar
def shared_hash(statement: str, namespace: str = GLOBAL) -> str:
    """Ortak bilgi anahtarı (= `memory.fact_hash`; global eski hash, proje ad alanı tuzlu)."""
    norm = normalize_key(statement)
    if nsm.is_global(namespace):
        return hashlib.sha1(norm.encode("utf-8")).hexdigest()[:16]
    return hashlib.sha1(f"{namespace}\x1f{norm}".encode("utf-8")).hexdigest()[:16]


def private_hash(statement: str, namespace: str, agent: str) -> str:
    """Ajan özel notu anahtarı: aynı önermeyi iki ajan söylerse iki ayrı özel not olur (biri ötekinin özel notuna
    yazmaz); terfide ikisi de aynı ortak bilgiye (`shared_hash`) bağlanır."""
    norm = normalize_key(statement)
    return "p" + hashlib.sha1(f"{namespace}\x1fprivate:{agent}\x1f{norm}".encode("utf-8")).hexdigest()[:15]


# Varlık türleri (kişi, şirket, ürün): ad alanına göre ayrılır. Konu kavramları ve kamu kurumları (`kavram`,
# `teknoloji`, `kurum` — ör. EPDK, TEİAŞ: projeler arası ortak kamu bilgisi) ad anahtarlı kalır (plan madde 5);
# onların ad alanı listesi okuma süzgecini besler. LLM çıkarıcı `llm-v2`den beri şirketi kurumdan ayırır.
ENTITY_KINDS = frozenset({"kişi", "kisi", "şirket", "sirket", "firma", "ürün", "urun", "person", "people",
                          "company", "product"})


def is_entity_kind(kind: str | None) -> bool:
    return str(kind or "").strip().replace("İ", "i").lower() in ENTITY_KINDS


def concept_key(name: str, kind: str | None = None, namespace: str = GLOBAL) -> str:
    """ (AW-R09/R13, AW-T03): kavram anahtarı. Kişi/şirket/ürün türü bir proje ad alanında `<ad alanı>::<ad>`
    anahtarlanır: aynı adlı iki varlık iki projede KENDİLİĞİNDEN birleşmez. Global ad alanı ve konu kavramları eski
    ad anahtarını korur (geriye uyum). Eski birleşmiş düğümler yerinde kalır."""
    name = name.strip()
    if nsm.is_global(namespace) or not is_entity_kind(kind):
        return name
    return f"{namespace}::{name}"


# ------------------------------------------------------------------ okuma görünümü
def defaults(props: dict[str, Any], created_at: str | None = None) -> dict[str, Any]:
    """Alanı olmayan (eski) bilginin güvenli varsayılanları. Yalnız eksik alanlar döner."""
    p = props or {}
    out: dict[str, Any] = {}
    if p.get("origin") not in ORIGINS:
        out["origin"] = "imported" if p.get("source") else "agent_inferred"
    if p.get("epistemic_status") not in STATUSES:
        out["epistemic_status"] = "asserted"
    if p.get("lifecycle") not in LIFECYCLES:
        out["lifecycle"] = "invalid" if p.get("invalid_at") else "active"
    if p.get("trust") not in TRUST:
        origin = p.get("origin") if p.get("origin") in ORIGINS else out.get("origin")
        out["trust"] = "trusted" if origin == "user_stated" else "untrusted"
    if p.get("visibility") not in VISIBILITY:
        out["visibility"] = "shared"
    if not p.get("recorded_from"):
        rf = p.get("valid_at") or p.get("created_at") or created_at
        if rf:
            out["recorded_from"] = str(rf)
    if not isinstance(p.get("version"), int) or isinstance(p.get("version"), bool):
        out["version"] = 1
    if not p.get("extractor_version"):
        out["extractor_version"] = LEGACY_EXTRACTOR
    if not isinstance(p.get("created_by"), dict):
        out["created_by"] = {"agent": p.get("agent"), "run": p.get("run_id"),
                             "extractor_version": p.get("extractor_version") or LEGACY_EXTRACTOR}
    return out


def view(node: dict[str, Any]) -> dict[str, Any]:
    """Bilgi özelliklerinin varsayılanlarla tamamlanmış hâli (yazmaz)."""
    p = dict(node.get("props") or {})
    return {**p, **defaults(p, node.get("created_at"))}


def is_current(p: dict[str, Any]) -> bool:
    return not p.get("invalid_at") and p.get("lifecycle", "active") == "active"


def prompt_marker(p: dict[str, Any]) -> str | None:
    """İstem etiketi anahtarı: tartışmalı > doğrulanmamış (güvenilmeyen ya da doğrulanmamış) > yok."""
    if p.get("epistemic_status") == "disputed":
        return "disputed"
    if p.get("epistemic_status") != "verified" and p.get("trust", "untrusted") != "trusted":
        return "unverified"
    return None


def public_fields(p: dict[str, Any]) -> dict[str, Any]:
    """Recall öğesi / arayüz için iddia özeti."""
    return {k: p.get(k) for k in ("origin", "epistemic_status", "lifecycle", "trust", "visibility", "valid_from",
                                  "valid_to", "recorded_from", "recorded_to", "version", "confidence")}


# ------------------------------------------------------------------ göç
def migrate_facts(store: GraphStore, batch: int = 500) -> int:
    """Eski bilgilere güvenli varsayılanları yazar (idempotent; `updated_at` ve FTS değişmez). Değişen sayıyı döner.
    `root_evidence_refs` eski ASSERTED_IN anılarından `episode:<id>` olarak kurulur."""
    changed = 0
    while True:
        # CDC C5: tek toplu işlem; yazım GraphStore.replace_node_content ile (zaman damgası/FTS korunur, günlüğe node.update)
        with store.bulk(), store._read() as conn:  # noqa: SLF001 - graf paketi içi okuma (yazıcı bağlantısı)
            rows = conn.execute("SELECT id, props, created_at FROM nodes WHERE type='Fact' AND "
                                "json_extract(props, '$.origin') IS NULL LIMIT ?", (int(batch),)).fetchall()
            if not rows:
                return changed
            ids = [r["id"] for r in rows]
            marks = ",".join("?" * len(ids))
            eps: dict[str, list[str]] = {}
            for e in conn.execute(f"SELECT src, dst FROM edges WHERE type='ASSERTED_IN' AND src IN ({marks})", ids):
                eps.setdefault(e["src"], []).append(f"episode:{e['dst']}")
            for r in rows:
                props = json.loads(r["props"])
                props.update(defaults(props, r["created_at"]))
                if not props.get("root_evidence_refs"):
                    props["root_evidence_refs"] = eps.get(r["id"], [])
                if props.get("invalid_at") and not props.get("recorded_to"):
                    props["recorded_to"] = props["invalid_at"]
                store.replace_node_content(r["id"], props, reindex=False)
                changed += 1


# ------------------------------------------------------------------ yardımcılar
def _iso(value: Any) -> str | None:
    """Kullanıcı tarih girdisi → ISO metni (yalnız tarih ya da tarih-saat). Boş → None (bilinmiyor)."""
    if value in (None, ""):
        return None
    from datetime import date, datetime  # noqa: PLC0415

    from datetime import timezone  # noqa: PLC0415

    raw = str(value).strip()
    try:
        if len(raw) == 10:
            return date.fromisoformat(raw).isoformat()
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        # saat dilimli değer UTC'ye çevrilir (metin karşılaştırması `+03:00` / `Z` karışınca yanılıyordu)
        dt = dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)
        return dt.isoformat()
    except ValueError:
        raise ValueError(ERR_DATE.format(raw)) from None


def _ts(value: Any) -> Any:
    """Karşılaştırma için zaman: ISO tarih/tarih-saat → UTC datetime (tarih = gün başı UTC). Çözülemezse None."""
    from datetime import date, datetime, timezone  # noqa: PLC0415

    if value in (None, ""):
        return None
    raw = str(value).strip()
    try:
        if len(raw) == 10:
            d = date.fromisoformat(raw)
            return datetime(d.year, d.month, d.day, tzinfo=timezone.utc)
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)
    except ValueError:
        return None


def check_window(vf: Any, vt: Any) -> None:
    """ters pencere (başlangıç > bitiş) reddedilir."""
    a, b = _ts(vf), _ts(vt)
    if a is not None and b is not None and a > b:
        raise ValueError(ERR_WINDOW)


def expired(p: dict[str, Any], now: Any = None) -> bool:
    """geçerliliği bitmiş mi (`valid_to` geçmiş). Gelecekte başlayacak bilgi (ör. "lansman Mart'ta") bugün de
    bilinen bir bilgidir; hatırlanır."""
    from datetime import datetime, timezone  # noqa: PLC0415

    t = now or datetime.now(timezone.utc)
    vt = _ts(p.get("valid_to"))
    return vt is not None and vt <= t


def _fact(store: GraphStore, fact_id: str, namespace: str | None = None) -> dict[str, Any]:
    node = store.get_node(fact_id)
    if node["type"] != "Fact":
        raise ValueError(ERR_NOT_FACT)
    if namespace is not None and nsm.of_node(node) != namespace:
        raise NamespaceError("Bu bilgi başka bir bellek ad alanına ait; işlem reddedildi")
    return node


def _check_version(node: dict[str, Any], expected: Any) -> int:
    cur = int(view(node).get("version") or 1)
    if expected is not None and expected != "":
        # yalnız katı tam sayı (bool, ondalık, "01", " 1 " reddedilir)
        if isinstance(expected, bool):
            raise ValueError(ERR_VERSION)
        if isinstance(expected, int):
            exp = expected
        elif isinstance(expected, str) and expected.isascii() and expected.isdigit() and not expected.startswith("0"):
            exp = int(expected)
        else:
            raise ValueError(ERR_VERSION)
        if exp != cur:
            raise AssertionConflict(node["id"], exp, cur)
    return cur


def _require_user(by: str, msg: str = ERR_USER_ONLY) -> None:
    if by != "user":
        raise AssertionDenied(msg)


def _successor_current(store: GraphStore, p: dict[str, Any], depth: int = 20) -> bool:
    """Eski sürümün (superseded/invalid) zincirinde hâlâ güncel bir halef var mı."""
    seen: set[str] = set()
    nxt = p.get("superseded_by") or p.get("corrected_by")
    while nxt and depth > 0 and nxt not in seen:
        seen.add(str(nxt))
        try:
            q = view(store.get_node(str(nxt)))
        except KeyError:
            return False
        if is_current(q):
            return True
        nxt = q.get("superseded_by") or q.get("corrected_by")
        depth -= 1
    return False


def user_marked(created_by: Any) -> dict[str, Any]:
    """`created_by` + kullanıcı kökeni işareti (`origin: "user"`). Yalnız kullanıcıya ait bilgi uçları çağırır;
    unutma (`forget._user_origin`) bilgiyi yalnız bu işaretle "kullanıcının yazdığı" sayar."""
    return {**(created_by if isinstance(created_by, dict) else {}), "origin": "user"}


def _new_user_fact(store: GraphStore, statement: str, ns: str, *, valid_from: str | None, valid_to: str | None,
                   at: str, extra: dict[str, Any] | None = None, replacing: bool = False) -> dict[str, Any]:
    """Kullanıcı beyanı düğümü. var olan düğümün `recorded_*` alanları ASLA yeniden yazılmaz.
    - aynı önerme güncelse: o düğüm döner (doğrulanmışsa olduğu gibi; değilse yalnız güven/köken yükselir, sürüm +1);
    - eski (yerini başkası almış / geçersiz) bir sürümse: yeni bir sürüm DÜĞÜMÜ açılır (yerinde diriltme yok → döngü
      ve geçmiş değişmesi yok). Açık değiştirme (`replacing`, supersede/correct) dışında güncel bir halefi varsa red."""
    statement = " ".join((statement or "").split())[:MAX_STATEMENT]  # satır sonu/denetim karakteri yok
    if not statement:
        raise ValueError(ERR_EMPTY)
    check_window(valid_from, valid_to)
    digest = shared_hash(statement, ns)
    existing = store.find("Fact", digest)
    if existing is not None and nsm.of_node(existing) != ns:  # savunma: başka ad alanının düğümüne yazılmaz
        digest = hashlib.sha1(f"{ns}\x1f{digest}".encode("utf-8")).hexdigest()[:16]
        existing = store.find("Fact", digest)
    props: dict[str, Any] = {
        "hash": digest, "statement": statement, "agent": "user", "namespace": ns, "origin": "user_stated",
        "epistemic_status": "asserted", "lifecycle": "active", "trust": "trusted", "visibility": "shared",
        "valid_from": valid_from, "valid_to": valid_to, "recorded_from": at,
        "source_refs": [f"user:{at}"], "root_evidence_refs": [f"user:{at}"],
        # kullanıcı kökeni işareti yalnız bu (kullanıcıya ait) uçlarda, sunucu tarafında yazılır
        "created_by": {"agent": "user", "run": None, "extractor_version": "user", "origin": "user"},
        "extractor_version": "user",
        "importance": 7, "created_at": at, **(extra or {})}
    if existing is not None:
        cur = view(existing)
        if is_current(cur):
            if cur.get("epistemic_status") == "verified" or (cur.get("origin") == "user_stated"
                                                             and cur.get("trust") == "trusted"):
                return existing  # zaten kullanıcı beyanı / doğrulanmış: hiçbir alan düşürülmez
            patch = {"origin": "user_stated", "trust": "trusted", "version": int(cur.get("version") or 1) + 1,
                     "created_by": user_marked(cur.get("created_by")),
                     "root_evidence_refs": [*(cur.get("root_evidence_refs") or []), f"user:{at}"]}
            return store.patch_node(existing["id"], patch)
        if not replacing and _successor_current(store, cur):
            raise ValueError(ERR_REVIVE)
        # eski sürüm: yeni düğüm (aynı önerme, yeni anahtar); eski düğüm ve kayıt zamanı olduğu gibi kalır
        n = 2
        while True:
            alt = hashlib.sha1(f"{digest}\x1frevive\x1f{n}".encode("utf-8")).hexdigest()[:16]
            prior = store.find("Fact", alt)
            if prior is None:
                break
            if is_current(view(prior)):
                return prior
            n += 1
        props["hash"] = alt
    props["version"] = 1
    return store.upsert_node("Fact", {k: v for k, v in props.items() if v is not None})


# ------------------------------------------------------------------ kullanıcı işlemleri
def add_user_fact(store: GraphStore, statement: str, namespace: str = GLOBAL, *, valid_from: Any = None,
                  valid_to: Any = None, by: str = "user") -> dict[str, Any]:
    """Kullanıcının açık beyanı: `user_stated`, `trusted`, ortak; aktif görevde hemen hatırlanır (ADD)."""
    _require_user(by)
    with store.bulk():
        return _new_user_fact(store, statement, namespace, valid_from=_iso(valid_from), valid_to=_iso(valid_to),
                              at=now_iso())


def verify(store: GraphStore, fact_id: str, *, by: str, expected_version: Any = None,
           namespace: str | None = None) -> dict[str, Any]:
    """`verified` yalnız kullanıcıdan. Doğrulanan bilgi `trusted` olur (kullanıcı kanıtı kök kanıta eklenir)."""
    _require_user(by, ERR_USER_ONLY_VERIFY)
    with store.bulk():
        node = _fact(store, fact_id, namespace)
        cur = _check_version(node, expected_version)
        if not is_current(view(node)):
            raise ValueError(ERR_NOT_ACTIVE)
        at = now_iso()
        refs = list(view(node).get("root_evidence_refs") or [])
        return store.patch_node(fact_id, {"epistemic_status": "verified", "trust": "trusted", "verified_by": "user",
                                          "verified_at": at, "disputed_reason": None, "version": cur + 1,
                                          "root_evidence_refs": [*refs, f"user:{at}"]})


def dispute(store: GraphStore, fact_id: str, *, by: str, reason: str = "", statement: str | None = None,
            expected_version: Any = None, namespace: str | None = None) -> dict[str, Any]:
    """DISPUTE: çözülemeyen çatışma. Bilgi `disputed` olur ama silinmez; isteğe "(tartışmalı)" etiketiyle girer.
    `statement` verilirse karşı iddia kullanıcı beyanı olarak eklenir ve `CONTRADICTS` ile bağlanır."""
    _require_user(by)
    reason = (reason or "").strip()[:300]
    if not reason and not (statement or "").strip():
        raise ValueError(ERR_REASON)
    with store.bulk():
        node = _fact(store, fact_id, namespace)
        cur = _check_version(node, expected_version)
        if not is_current(view(node)):
            raise ValueError(ERR_NOT_ACTIVE)
        at = now_iso()
        counter = None
        same = normalize_key(statement or "") == normalize_key(view(node).get("statement") or "")
        if (statement or "").strip() and not same:
            # açık karşı iddia: eski (düzeltilmiş) bir önermeyle aynıysa yeni sürüm düğümü açılır (diriltme yok)
            counter = _new_user_fact(store, statement or "", nsm.of_node(node), valid_from=None, valid_to=None, at=at,
                                     replacing=True)
            if counter["id"] != fact_id:
                store.link("CONTRADICTS", counter["id"], fact_id, {"at": at, "by": "user"})
        old = store.patch_node(fact_id, {"epistemic_status": "disputed", "disputed_reason": reason or None,
                                         "version": cur + 1, "pinned": False})
        return {"fact": old, "counter": counter}


def _replace(store: GraphStore, fact_id: str, *, rel: str, by: str, statement: str, valid_from: Any, valid_to: Any,
             expected_version: Any, namespace: str | None) -> dict[str, Any]:
    _require_user(by)
    vf, vt = _iso(valid_from), _iso(valid_to)
    check_window(vf, vt)
    with store.bulk():
        node = _fact(store, fact_id, namespace)
        cur = _check_version(node, expected_version)
        old_view = view(node)
        if not is_current(old_view):
            raise ValueError(ERR_NOT_ACTIVE)
        at = now_iso()
        ns = nsm.of_node(node)
        if normalize_key(statement or "") == normalize_key(old_view.get("statement") or ""):
            # aynı metin: yalnız geçerlilik aralığı değişiyor → yeni düğüm açılamaz (aynı anahtar); yerinde, sürümlü.
            # önermeyi kullanıcı YAZMADI (yalnız tarihini düzeltti) → köken (`origin`, `created_by.origin`)
            # olduğu gibi kalır; koşunun ürettiği bilgi "kullanıcının yazdığı" olmaz (unutmanın varsayılan koruması
            # düşmez). Güven eskisi gibi yükselir (kullanıcı kaydı gözden geçirdi); kanıt ve köken alanları değişmez.
            patch: dict[str, Any] = {"version": cur + 1, "trust": "trusted", "valid_from": vf, "valid_to": vt}
            return {"old": store.patch_node(fact_id, patch), "new": None}
        new = _new_user_fact(store, statement, ns, valid_from=vf, valid_to=vt, at=at, replacing=True,
                             extra={"pinned": True} if old_view.get("pinned") else None)
        if new["id"] == fact_id:  # savunma: kendine bağlanmaz (döngü yok)
            raise ValueError(ERR_NOT_ACTIVE)
        store.link(rel, new["id"], fact_id, {"at": at, "by": "user"})
        patch = {"lifecycle": "superseded" if rel == "SUPERSEDES" else "invalid", "recorded_to": at,
                 "version": cur + 1, "pinned": False}
        if rel == "SUPERSEDES":
            patch.update(superseded_by=new["id"])
            if vf and not old_view.get("valid_to"):
                patch["valid_to"] = vf  # dünyada değişti: eski bilgi yenisinin başladığı ana kadar geçerliydi
        else:
            patch.update(corrected_by=new["id"], invalid_at=at, invalid_reason="Kullanıcı düzeltti")
        old = store.patch_node(fact_id, patch)
        return {"old": old, "new": new}


def supersede(store: GraphStore, fact_id: str, *, by: str, statement: str, valid_from: Any = None,
              valid_to: Any = None, expected_version: Any = None, namespace: str | None = None) -> dict[str, Any]:
    """SUPERSEDE: dünyada değişti (ör. teslim tarihi ertelendi). Eski bilgi `superseded`, `recorded_to` dolar,
    `valid_to` yeni bilginin `valid_from`u olur; yeni bilgi `SUPERSEDES` ile eskisine bağlanır."""
    return _replace(store, fact_id, rel="SUPERSEDES", by=by, statement=statement, valid_from=valid_from,
                    valid_to=valid_to, expected_version=expected_version, namespace=namespace)


def correct(store: GraphStore, fact_id: str, *, by: str, statement: str, valid_from: Any = None,
            valid_to: Any = None, expected_version: Any = None, namespace: str | None = None) -> dict[str, Any]:
    """CORRECT: eski kayıt yanlıştı. Eski bilgi `invalid` (silinmez, `recorded_to` dolar); düzeltme kullanıcı beyanı
    olarak eklenir ve `CORRECTS` ile bağlanır. Eski kaydın işlem zamanı yeniden yazılmaz."""
    return _replace(store, fact_id, rel="CORRECTS", by=by, statement=statement, valid_from=valid_from,
                    valid_to=valid_to, expected_version=expected_version, namespace=namespace)


def check_pin(node: dict[str, Any], pinned: bool | None, by: str) -> None:
    """AW-R24: güvenilmeyen bilgi kullanıcı dışında (otomatik) sabitlenemez."""
    if pinned and by != "user" and view(node).get("trust") != "trusted":
        raise AssertionDenied(ERR_UNTRUSTED_PIN)


# ------------------------------------------------------------------ terfi (R-1)
def _copy_about(store: GraphStore, src_id: str, dst_id: str) -> None:
    for _e, nb, _d in store.neighbors(src_id, ["ABOUT"], "out"):
        store.link("ABOUT", dst_id, nb["id"])


def _artifact_refs(artifacts: Iterable[dict[str, Any]] | None) -> list[str]:
    out = []
    for a in artifacts or []:
        path = str(a.get("path") or a.get("rel") or "").strip()
        sha = str(a.get("sha256") or a.get("sha") or "").strip()
        if path:
            out.append(f"artifact:{path}@sha256:{sha}" if sha else f"artifact:{path}")
    return out


def _promote_one(store: GraphStore, private: dict[str, Any], *, at: str, extra_refs: list[str],
                 run_id: str | None, episode_id: str | None = None) -> tuple[str | None, bool]:
    """Özel notu ortak kopyaya bağlar → (ortak id, yeni mi terfi etti). Kanıt yalnız terfi ettiren koşudan gelir:
    aynı özel not reddedilen bir koşuda da söylenmişse o koşunun kökü ortak kopyaya taşınmaz."""
    p = view(private)
    if p.get("visibility") != "private" or not is_current(p):
        return p.get("promoted_to"), False
    ns = nsm.of_node(private)
    own_roots = [r for r in (p.get("root_evidence_refs") or []) if not str(r).startswith("run:")]
    roots = list(dict.fromkeys([*([f"run:{run_id}"] if run_id else []), *own_roots, *extra_refs]))
    sources = [s for s in (p.get("source_refs") or []) if not run_id or str(s).startswith(f"ep:{run_id}:")]
    if p.get("promoted_to"):  # daha önce terfi etmiş: yeni kabul edilen koşunun kanıtı birleşir (yeni düğüm yok)
        try:
            shared = store.get_node(str(p["promoted_to"]))
        except KeyError:
            return None, False
        store.upsert_node("Fact", {"hash": shared["props"]["hash"], "root_evidence_refs": roots,
                                   "source_refs": sources})
        if episode_id:
            store.link("ASSERTED_IN", shared["id"], episode_id)
        return shared["id"], False
    statement = str(p.get("statement") or "")
    digest = shared_hash(statement, ns)
    shared = store.find("Fact", digest)
    if shared is not None and nsm.of_node(shared) != ns:
        digest = hashlib.sha1(f"{ns}\x1f{digest}".encode("utf-8")).hexdigest()[:16]
        shared = store.find("Fact", digest)
    if shared is None:
        copy = {k: p.get(k) for k in ("statement", "confidence", "importance", "agent", "namespace", "origin",
                                      "epistemic_status", "trust", "valid_from", "valid_to", "created_by",
                                      "extractor_version", "source_artifacts", "verified_by", "verified_at")}
        copy.update(hash=digest, visibility="shared", lifecycle="active", recorded_from=at, created_at=at,
                    version=1, promoted_from=private["id"], promoted_at=at, source_refs=sources,
                    root_evidence_refs=roots, run_id=run_id or p.get("run_id"))
        shared = store.upsert_node("Fact", {k: v for k, v in copy.items() if v is not None})
    else:  # NOOP: ortak bilgi zaten var — yalnız kanıt listeleri birleşir (son yazan kazanmaz)
        shared = store.upsert_node("Fact", {"hash": digest, "root_evidence_refs": roots, "source_refs": sources})
    store.link("DERIVED_FROM", shared["id"], private["id"], {"at": at, "run": run_id, "reason": "accepted"})
    eps = [episode_id] if episode_id else [ep["id"] for _e, ep, _d in store.neighbors(private["id"], ["ASSERTED_IN"],
                                                                                        "out")]
    for eid in eps:
        store.link("ASSERTED_IN", shared["id"], eid)
    for _e, art, _d in store.neighbors(private["id"], ["SUPPORTED_BY"], "out"):
        store.link("SUPPORTED_BY", shared["id"], art["id"])
    _copy_about(store, private["id"], shared["id"])
    store.patch_node(private["id"], {"promoted_to": shared["id"], "promoted_at": at})
    return shared["id"], True


def promote_run(store: GraphStore, run_id: str, *, artifacts: Iterable[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Kabul edilen koşunun özel anı ve bilgilerini ortak belleğe taşır. İdempotent: ikinci çağrı yeni düğüm ya da
    kenar üretmez (deterministik ortak anahtar, benzersiz kenar, liste birleşimi). `facts`: bu çağrıda yeni terfi
    eden bilgi sayısı."""
    at = now_iso()
    extra = _artifact_refs(artifacts)
    episodes = store.nodes("Episode", limit=1000, props={"run_id": run_id})
    promoted: list[str] = []
    touched: list[str] = []
    promoted_eps = 0
    with store.bulk():
        for ep in episodes:
            if ep["props"].get("visibility") == "private":
                store.patch_node(ep["id"], {"visibility": "shared", "promoted_at": at})
                promoted_eps += 1
            for _e, fact, _d in store.neighbors(ep["id"], ["ASSERTED_IN"], "in"):
                if fact["type"] != "Fact" or fact["props"].get("visibility") != "private":
                    continue
                sid, new = _promote_one(store, fact, at=at, extra_refs=extra, run_id=run_id, episode_id=ep["id"])
                if sid:
                    (promoted if new else touched).append(sid)
    return {"run_id": run_id, "episodes": promoted_eps, "facts": len(promoted),
            "shared_ids": list(dict.fromkeys(promoted + touched))}


def promote_fact(store: GraphStore, fact_id: str, *, by: str, namespace: str | None = None) -> dict[str, Any]:
    """`manual` (ya da kullanıcı isteği): tek özel notu ortak belleğe taşır. Yalnız kullanıcı."""
    _require_user(by)
    with store.bulk():
        node = _fact(store, fact_id, namespace)
        if view(node).get("visibility") != "private":
            raise ValueError(ERR_PRIVATE_ONLY)
        if not is_current(view(node)):
            raise ValueError(ERR_NOT_ACTIVE)
        sid, _new = _promote_one(store, node, at=now_iso(), extra_refs=[f"user:{now_iso()}"],
                                 run_id=node["props"].get("run_id"))
    return store.get_node(sid or fact_id)


# ------------------------------------------------------------------ geçmiş ve zaman sorguları
def history(store: GraphStore, fact_id: str, limit: int = 30) -> list[dict[str, Any]]:
    """Bilginin sürüm/çelişki/terfi zinciri (her iki yön). Öğe: {id, statement, rel, dir, …iddia alanları}."""
    start = _fact(store, fact_id)
    seen = {start["id"]}
    out: list[dict[str, Any]] = [{"id": start["id"], "statement": start["props"].get("statement"), "rel": None,
                                  "dir": None, **public_fields(view(start))}]
    frontier = [start["id"]]
    while frontier and len(out) < limit:
        nxt = []
        for nid in frontier:
            for edge, nb, d in store.neighbors(nid, list(HISTORY_RELS), "both"):
                if nb["id"] in seen or nb["type"] != "Fact":
                    continue
                seen.add(nb["id"])
                out.append({"id": nb["id"], "statement": nb["props"].get("statement"), "rel": edge["type"],
                            "dir": d, "via": nid, **public_fields(view(nb))})
                nxt.append(nb["id"])
        frontier = nxt
    return out[:limit]


def facts_as_of(store: GraphStore, namespace: str = GLOBAL, *, recorded_at: str | None = None,
                valid_at: str | None = None, include_private: bool = False, limit: int = 2000) -> list[dict[str, Any]]:
    """İki eksenli sorgu (AW-T02).
    - `recorded_at` yok: güncel bilgi (`lifecycle=active`, geçersiz değil). Var: o anda sistemin bildiği sürümler
      (`recorded_from ≤ t < recorded_to`), sonradan değişmiş olsalar bile.
    - `valid_at`: dünyada o anda geçerli olanlar. Bilinmeyen sınır (null) dışlamaz ama sonuçta `valid_unknown` işaretlenir
      (bilinmeyen sınırdan kesin sonuç çıkarılmaz)."""
    props: dict[str, Any] = {"namespace": namespace}
    nodes = store.nodes("Fact", limit=limit, props=props)
    if nsm.is_global(namespace):
        nodes += store.nodes("Fact", limit=limit, props={"namespace": None})
    out = []
    for n in nodes:
        p = view(n)
        if p.get("visibility") == "private" and not include_private:
            continue
        if p.get("promoted_to"):
            continue
        if recorded_at is None:
            if not is_current(p):
                continue
        else:
            rf, rt, ra = _ts(p.get("recorded_from")), _ts(p.get("recorded_to")), _ts(recorded_at)
            if not rf or (ra is not None and rf > ra) or (rt and ra is not None and rt <= ra):
                continue
        unknown = False
        if valid_at is not None:
            vf, vt, va = _ts(p.get("valid_from")), _ts(p.get("valid_to")), _ts(valid_at)
            if va is not None and ((vf and vf > va) or (vt and vt <= va)):
                continue
            unknown = not vf or not vt
        out.append({"id": n["id"], "statement": p.get("statement"), "valid_unknown": unknown, **public_fields(p)})
    out.sort(key=lambda x: x.get("recorded_from") or "")
    return out
