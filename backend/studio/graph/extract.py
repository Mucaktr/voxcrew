"""Ajan çıktısından graf belleği için yapı çıkarımı: özet, kavramlar, önermeler.

İki yol: LLM (Ollama yapılandırılmış JSON çıktısı) ve sezgisel (bağımlılıksız, anlık).
Her iki yol da aynı Extraction sözleşmesini döndürür.
"""

from __future__ import annotations

import json
import math
import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

import httpx

STOPWORDS = set("""
acaba ama ancak artık aslında az bana bazı belki ben beni benim beri bile bir birçok biri birkaç
birşey biz bize bizi bizim bu buna bunda bundan bunlar bunları bunların bunu bunun burada çok
çünkü da daha dahi de defa değil diğer diye dolayı dolayısıyla eğer en fakat gibi göre hala hangi
hem hep hepsi her herhangi herkes hiç için ile ilgili ise işte itibaren kadar karşın kendi
kendine kez ki kim kimse mı mi mu mü nasıl ne neden nerede nereye niçin niye o olan olarak
oldu olduğu olduğunu olmak olması olmayan olup olur olursa oluşan ona onlar onları onların onu
onun orada öyle pek rağmen sadece sanki şey şeyler şimdi şöyle şu şuna şunda şundan şunu tarafından
tüm üzere var vardır ve veya ya yani yapılan yaptı yapmak yer yerine yine yoksa zaten zira
ayrıca böyle böylece bunlardan bütün çeşitli genel gereken göre hakkında halinde içinde kapsamında
özellikle sonra önce yeni yalnızca yaklaşık tarafından üzerinde arasında aynı başka bazen
the a an and or of to in on for with by from at as is are was were be been being this that these
those it its into about over under than then so such not no but if else when while which who whom
what where why how all any each few more most other some own same very can will just should now
also may might must per via using use used based
""".split())

_WORD = r"[0-9A-Za-zÇĞİÖŞÜçğıöşüÂâÎîÛû]"
WORD_RE = re.compile(rf"{_WORD}[{_WORD[1:-1]}\-]*")
CAP_RE = re.compile(
    r"(?<![\w])([A-ZÇĞİÖŞÜ][\wçğıöşüÇĞİÖŞÜ\-]*(?:['’][a-zçğıöşü]+)?"
    r"(?:\s+(?:[A-ZÇĞİÖŞÜ0-9][\wçğıöşüÇĞİÖŞÜ\-]*(?:['’][a-zçğıöşü]+)?|ve|of|and|&|de|da)){0,4})")
CONNECTORS = {"ve", "of", "and", "&", "de", "da"}
BULLET_RE = re.compile(r"^\s*(?:[-*•]|\d+[.)])\s+")


# (AW-R11): çıkarıcı sürümü — her bilgi hangi çıkarıcı mantığıyla üretildiğini taşır (`created_by.extractor_version`).
# Çıkarım kuralı ya da LLM istemi/şeması değişince ilgili sürüm artırılır; eski bilgiler eski sürümle kalır.
EXTRACTOR_VERSIONS: dict[str, str] = {"heuristic": "heuristic-v1", "llm": "llm-v2"}  # v2: şirket türü


def extractor_version(extractor: str) -> str:
    return EXTRACTOR_VERSIONS.get(extractor, f"{extractor or 'unknown'}-v0")


@dataclass
class Extraction:
    summary: str
    concepts: list[dict[str, str]] = field(default_factory=list)   # {name, kind}
    facts: list[dict[str, Any]] = field(default_factory=list)      # {statement, about[], confidence, importance}
    extractor: str = "heuristic"
    importance: int = 5                                            # 1-10, anının genel önemi

    @property
    def version(self) -> str:
        """`extractor_version` (ör. `heuristic-v1`, `llm-v1`)."""
        return extractor_version(self.extractor)


def tr_lower(s: str) -> str:
    return s.replace("İ", "i").lower()


def clean_markdown(text: str) -> str:
    text = re.sub(r"```.*?```", " ", text, flags=re.S)
    text = re.sub(r"\[([^\]]+)\]\((?:[^)]+)\)", r"\1", text)
    text = re.sub(r"https?://\S+", " ", text)
    # PROC-FIX P2: karşılaştırma işaretleri (> < ≥ ≤) anlamdır ("> 20.000 m²" ile "≥ 20.000 m²" farklı eşiklerdir);
    # yalnız satır başındaki markdown alıntı işareti (`> `) atılır. `<` hiçbir zaman atılmadı; istem enjeksiyonu savunması
    # bellek bölümü isteme konurken çalışır (guard/injection.py tarayıcısı; bilgiler `untrusted` etiketli).
    text = re.sub(r"(?m)^[ \t]*(?:>[ \t]*)+", " ", text)
    text = re.sub(r"[*_`#|]+", " ", text)
    return text


def tokens(text: str) -> list[str]:
    return [t for t in (tr_lower(w).strip("-.") for w in WORD_RE.findall(text))
            if len(t) >= 3 and t not in STOPWORDS and not t.isdigit()]


def fts_query(text: str, max_terms: int = 14) -> str | None:
    """Serbest metinden FTS5 sorgusu. Türkçe ekler için uzun kelimeler kök-öneki ile aranır."""
    seen: list[str] = []
    for t in tokens(clean_markdown(text)):
        stem = t[:6] if len(t) > 7 else t
        if stem not in seen:
            seen.append(stem)
        if len(seen) >= max_terms:
            break
    if not seen:
        return None
    return " OR ".join(f'"{s}"*' for s in seen)


def _strip_suffix(name: str) -> str:
    name = re.split(r"['’]", name)[0]
    words = name.split()
    while words and tr_lower(words[-1]) in CONNECTORS:
        words.pop()
    return " ".join(words).strip(" -.")


def _summary(lines: list[str], limit: int = 320) -> str:
    paras = [ln.strip() for ln in lines if ln.strip() and not ln.lstrip().startswith("#")]
    text = " ".join(BULLET_RE.sub("", p) for p in paras)
    text = re.sub(r"\s+", " ", clean_markdown(text)).strip()
    return text[:limit] + ("…" if len(text) > limit else "")


def heuristic_extract(text: str, title: str = "") -> Extraction:
    raw_lines = text.splitlines()
    plain = clean_markdown(text)

    counts: Counter[str] = Counter()
    display: dict[str, str] = {}
    non_initial: set[str] = set()
    for sentence in re.split(r"(?<=[.!?:])\s+|\n+", plain):
        sentence = sentence.strip()
        for m in CAP_RE.finditer(sentence):
            name = _strip_suffix(m.group(1))
            if len(name) < 3:
                continue
            key = tr_lower(name)
            if key in STOPWORDS or all(w in STOPWORDS for w in key.split()):
                continue
            counts[key] += 1
            display.setdefault(key, name)
            if m.start() > 0 or " " in name or name.isupper():
                non_initial.add(key)
    candidates: dict[str, float] = {}
    for key, c in counts.items():
        if key not in non_initial and c < 2:
            continue  # yalnızca cümle başında bir kez geçen tek kelime: büyük olasılıkla sıradan kelime
        candidates[key] = c * (1 + 0.5 * (len(key.split()) - 1))
    for tok, c in Counter(t for t in tokens(plain) if len(t) >= 6).items():
        if c >= 3 and tok not in candidates and not any(tok in k for k in candidates):
            candidates[tok] = c * 0.6
            display.setdefault(tok, tok)
    top = sorted(candidates.items(), key=lambda kv: -kv[1])[:8]
    concepts = [{"name": display[k], "kind": "kısaltma" if display[k].isupper() else "kavram"} for k, _ in top]

    units: list[str] = []
    for ln in raw_lines:
        if BULLET_RE.match(ln):
            units.append(BULLET_RE.sub("", ln))
        else:
            units.extend(re.split(r"(?<=[.!?])\s+", ln))
    facts: list[dict[str, Any]] = []
    for u in units:
        s = re.sub(r"\s+", " ", clean_markdown(u)).strip()
        if not 30 <= len(s) <= 260:
            continue
        low = tr_lower(s)
        about = [c["name"] for c in concepts if tr_lower(c["name"]) in low][:3]
        if about:
            facts.append({"statement": s, "about": about, "confidence": 0.5,
                          "importance": 6 if re.search(r"\d", s) else 5})
    facts.sort(key=lambda f: -len(f["about"]))
    return Extraction(_summary(raw_lines), concepts, facts[:6], "heuristic")


LLM_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "importance": {"type": "integer"},
        "concepts": {"type": "array", "items": {
            "type": "object",
            "properties": {"name": {"type": "string"}, "kind": {"type": "string"}},
            "required": ["name", "kind"]}},
        "facts": {"type": "array", "items": {
            "type": "object",
            "properties": {"statement": {"type": "string"},
                           "about": {"type": "array", "items": {"type": "string"}},
                           "confidence": {"type": "number"},
                           "importance": {"type": "integer"}},
            "required": ["statement", "about"]}},
    },
    "required": ["summary", "concepts", "facts"],
}

LLM_SYSTEM = (
    "Bir bilgi grafı için ajan çıktısından yapı çıkarıyorsun. Yalnızca metinde açıkça geçen bilgiyi kullan, "
    "yorum ekleme. summary: en fazla 2 cümle, ajanın ne yaptığı ve vardığı sonuç. concepts: en fazla 8 önemli "
    "varlık/kavram (kind: kurum [kamu kurumu], şirket, kişi, yer, belge, teknoloji, ürün, kavram, olay). facts: en fazla 6 kısa, "
    "kendi başına anlaşılır önerme; about alanı concepts içindeki adları kullanır; confidence 0-1; importance 1-10 "
    "(gelecekteki işler için ne kadar kalıcı/önemli). Üst düzey importance: anının genel önemi 1-10. "
    "Metnin dilinde yaz."
)


async def llm_extract(ollama_url: str, model: str, text: str, title: str = "",
                      timeout: float = 150.0, system: str | None = None, *, settings: Any = None,
                      usage: dict[str, Any] | None = None) -> Extraction | None:
    """Ollama ile yapılandırılmış çıkarım. Sistem çağrısıdır: çağıran (`GraphMemory.extract`) bunu
    `workflow.system_calls.account("memory_extract", …)` içinde yapar. `usage` verilirse Ollama'nın
    `prompt_eval_count` / `eval_count` değerleri `input` / `output` / `total` olarak yazılır. `settings` verilirse
    `num_ctx` ve `keep_alive` ajan adımlarıyla AYNI (model başına sabit; C-2) olur."""
    from studio.connectors.ollama import DEFAULT_NUM_CTX, keep_alive, resolve_num_ctx  # noqa: PLC0415
    payload: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system or LLM_SYSTEM},  # i18n: EN çıkarım istemi memory.py'den gelir
            {"role": "user", "content": f"BAŞLIK: {title}\n\nMETİN:\n{text[:6000]}"},
        ],
        "stream": False,
        "think": False,
        "format": LLM_SCHEMA,
        "options": {"temperature": 0.1, "num_ctx": DEFAULT_NUM_CTX},
    }
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            if settings is not None:
                payload["options"]["num_ctx"] = await resolve_num_ctx(settings, ollama_url, model, client)
                payload["keep_alive"] = keep_alive(settings)
            resp = await client.post(f"{ollama_url.rstrip('/')}/api/chat", json=payload)
            resp.raise_for_status()
            body = resp.json()
            if usage is not None and isinstance(body, dict):
                pin, pout = int(body.get("prompt_eval_count") or 0), int(body.get("eval_count") or 0)
                usage.update(input=pin, output=pout, total=pin + pout)
            data = json.loads(body["message"]["content"])
    except (httpx.HTTPError, KeyError, ValueError, TypeError):
        return None
    concepts = [{"name": str(c.get("name", "")).strip()[:80], "kind": str(c.get("kind", "kavram"))[:24]}
                for c in data.get("concepts", []) if isinstance(c, dict) and str(c.get("name", "")).strip()][:8]
    names = {tr_lower(c["name"]) for c in concepts}
    facts = []
    for f in data.get("facts", [])[:6]:
        if not isinstance(f, dict) or not str(f.get("statement", "")).strip():
            continue
        about = [str(a).strip() for a in f.get("about", []) if str(a).strip()]
        for a in about:  # LLM concepts'te olmayan konu adı verdiyse onu da kavram yap
            if tr_lower(a) not in names and len(concepts) < 12:
                concepts.append({"name": a[:80], "kind": "kavram"})
                names.add(tr_lower(a))
        conf = f.get("confidence", 0.6)
        imp = f.get("importance", 5)
        conf = float(conf) if isinstance(conf, (int, float)) and not isinstance(conf, bool) else 0.6
        conf = max(0.0, min(1.0, conf)) if math.isfinite(conf) else 0.6  # NaN/inf saklanmaz (API 500)
        facts.append({"statement": " ".join(str(f["statement"]).split())[:300], "about": about[:4],
                      "confidence": conf,
                      "importance": _clamp_importance(imp)})
    summary = str(data.get("summary", "")).strip()[:400]
    if not summary and not concepts:
        return None
    return Extraction(summary or _summary(text.splitlines()), concepts, facts, "llm",
                      _clamp_importance(data.get("importance", 5)))


def _clamp_importance(v: Any) -> int:
    try:
        return max(1, min(10, int(v)))
    except (TypeError, ValueError):
        return 5
