"""Kalite kapısı — deterministik denetimler (CG-QUALITY). Saf fonksiyonlar: G/Ç yok, ağ yok, süreç yok.

Her denetim `(metin, bağlam) → CheckResult` döner: durum (passed | failed | skipped), ayrıntı ve konumlu bulgular.
Bulgu konumu 1 tabanlı satır + kısa kesit; kişisel veri bulgularında kesit kısmen gizlenir (bulgu listesi kişisel
veriyi yeniden yaymasın). Bu modül çıktıdaki kişisel veriyi MASKELEMEZ; yalnızca işaretler (LOGIC-AUDIT).
"""

from __future__ import annotations

import io
import json
import re
import zipfile
from dataclasses import dataclass, field
from typing import Any, Callable

SEVERITIES = ("info", "warn", "error")
EXCERPT = 140
MAX_FINDINGS_PER_CHECK = 25


@dataclass
class Finding:
    check: str
    severity: str
    code: str                       # makine kodu (arayüz metni bundan üretilir): ör. unsourced_claim
    message: str                    # TR insan metni (EN arayüzde koddan çevrilir)
    line: int | None = None
    excerpt: str | None = None
    params: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {"check": self.check, "severity": self.severity, "code": self.code, "message": self.message,
                "location": {"line": self.line, "excerpt": self.excerpt} if self.line or self.excerpt else None,
                "params": self.params}


@dataclass
class CheckResult:
    id: str
    status: str                     # passed | failed | skipped
    detail: str = ""
    findings: list[Finding] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "status": self.status, "detail": self.detail, "findings": len(self.findings)}


# ---------------------------------------------------------------- metin yardımcıları
_TR_FOLD = str.maketrans({"İ": "i", "I": "ı", "Ş": "ş", "Ğ": "ğ", "Ü": "ü", "Ö": "ö", "Ç": "ç"})
_ASCII_FOLD = str.maketrans("çğıöşüâîû", "cgiosuaiu")


def fold(text: str) -> str:
    """Başlık karşılaştırması: Türkçe büyük/küçük harf, aksan, numara ve noktalama duyarsız."""
    s = str(text or "").translate(_TR_FOLD).casefold().translate(_ASCII_FOLD)
    s = re.sub(r"^[\s#>*_`-]*(?:\d+(?:\.\d+)*[.)]?\s*)?", "", s)
    return " ".join(re.sub(r"[^\w\s]", " ", s).split())


def excerpt(line: str, limit: int = EXCERPT) -> str:
    s = " ".join(str(line or "").split())
    return s if len(s) <= limit else s[: limit - 1] + "…"


def prose_lines(text: str) -> list[tuple[int, str]]:
    """(satır no, satır) — kod blokları dışındaki satırlar."""
    out: list[tuple[int, str]] = []
    fenced = False
    for i, raw in enumerate(str(text or "").splitlines(), 1):
        if raw.strip().startswith(("```", "~~~")):
            fenced = not fenced
            continue
        if not fenced:
            out.append((i, raw))
    return out


_HEADING = re.compile(r"^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$")
_BOLD_HEADING = re.compile(r"^\s{0,3}(?:\*\*|__)(.+?)(?:\*\*|__)\s*:?\s*$")
_SETEXT = re.compile(r"^\s{0,3}(=+|-+)\s*$")


def headings(text: str) -> list[tuple[int, int, str]]:
    """(satır, düzey, başlık) — ATX (#), setext (===/---) ve tek başına kalın satır ("**Özet**") başlıkları."""
    out: list[tuple[int, int, str]] = []
    lines = prose_lines(text)
    for idx, (no, line) in enumerate(lines):
        m = _HEADING.match(line)
        if m:
            out.append((no, len(m.group(1)), m.group(2).strip()))
            continue
        m = _BOLD_HEADING.match(line)
        if m:
            out.append((no, 6, m.group(1).strip()))
            continue
        nxt = lines[idx + 1][1] if idx + 1 < len(lines) else ""
        if line.strip() and _SETEXT.match(nxt) and not line.lstrip().startswith(("-", "*", "|")):
            out.append((no, 1 if nxt.strip().startswith("=") else 2, line.strip()))
    return out


# ---------------------------------------------------------------- 1. zorunlu bölümler
def section_titles(entry: Any) -> list[str]:
    """Tarifin bölüm tanımı → eşleşebilecek adlar: {id, title: {tr, en}} | {title: "x"} | "x"."""
    if isinstance(entry, str):
        return [entry]
    if not isinstance(entry, dict):
        return []
    names: list[str] = []
    title = entry.get("title")
    if isinstance(title, dict):
        names += [str(v) for v in title.values() if v]
    elif title:
        names.append(str(title))
    for key in ("id", "aliases"):
        v = entry.get(key)
        if isinstance(v, list):
            names += [str(x) for x in v if x]
        elif v:
            names.append(str(v).replace("_", " "))
    return names


def _section_match(name: str, found: set[str]) -> bool:
    """Başlık bölüm adının kendisi, onunla başlayan ya da onu tam kelime dizisi olarak içeren başlık mı."""
    return any(h == name or h.startswith(name + " ") or f" {name} " in f" {h} " for h in found)


def check_sections(text: str, required: list[Any]) -> CheckResult:
    if not required:
        return CheckResult("sections", "skipped", "Zorunlu bölüm tanımlı değil")
    found = {fold(h) for _l, _d, h in headings(text)}
    missing: list[str] = []
    for entry in required:
        names = [n for n in section_titles(entry) if fold(n)]
        if not names:
            continue
        if not any(_section_match(fold(n), found) for n in names):
            missing.append(names[0])
    findings = [Finding("sections", "error", "missing_section", f"Zorunlu bölüm eksik: {name}",
                        params={"section": name}) for name in missing]
    if missing:
        return CheckResult("sections", "failed", f"{len(missing)} bölüm eksik", findings)
    return CheckResult("sections", "passed", f"{len(required)} bölüm var")


# ---------------------------------------------------------------- 2. biçim ve dosya türü
_TABLE_ROW = re.compile(r"^\s*\|.*\|\s*$")
_TABLE_SEP = re.compile(r"^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$")


def _md_findings(text: str) -> list[Finding]:
    out: list[Finding] = []
    fences = [i for i, line in enumerate(text.splitlines(), 1) if line.strip().startswith(("```", "~~~"))]
    if len(fences) % 2:
        out.append(Finding("format", "error", "unclosed_fence", "Kod bloğu kapatılmamış (```)", fences[-1]))
    prev = 0
    for no, level, title in headings(text):
        if level == 6 and not title:
            continue
        if not title.strip("#* "):
            out.append(Finding("format", "warn", "empty_heading", "Boş başlık", no))
        if prev and level < 6 and level > prev + 1:
            out.append(Finding("format", "info", "heading_jump", f"Başlık düzeyi atlanmış (H{prev} → H{level})", no,
                               excerpt(title), {"from": prev, "to": level}))
        if level < 6:
            prev = level
    # tablo: ayraç satırından sonra sütun sayısı tutarlı mı
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        if _TABLE_ROW.match(lines[i]) and i + 1 < len(lines) and _TABLE_SEP.match(lines[i + 1]):
            cols = lines[i].strip().strip("|").count("|") + 1
            j = i + 2
            while j < len(lines) and _TABLE_ROW.match(lines[j]):
                n = lines[j].strip().strip("|").count("|") + 1
                if n != cols:
                    out.append(Finding("format", "warn", "table_columns",
                                       f"Tablo satırında {n} sütun var, başlıkta {cols}", j + 1, excerpt(lines[j]),
                                       {"got": n, "want": cols}))
                j += 1
            i = j
            continue
        i += 1
    return out


def _docx_ok(text: str, title: str | None) -> str | None:
    """Word dışa aktarımı açılabilir bir .docx üretiyor mu → hata metni ya da None."""
    try:
        from studio.deliverables.export import markdown_to_docx
        data = markdown_to_docx(text, title)
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            if "word/document.xml" not in z.namelist():
                return "word/document.xml yok"
            z.read("word/document.xml")
    except Exception as exc:  # noqa: BLE001 - dışa aktarım hatası bulgudur, denetimi düşürmez
        return str(exc)[:200] or type(exc).__name__
    return None


def check_format(text: str, *, name: str = "", kind: str = "", file_type: str | None = None,
                 title: str | None = None) -> CheckResult:
    """Biçim: Markdown yapısı, .docx dışa aktarımı, JSON/YAML ayrıştırma, Python sözdizimi (derleme, çalıştırma yok),
    diff biçimi."""
    ext = (name.rsplit(".", 1)[-1].lower() if "." in name else "")
    want = (file_type or "").lower().lstrip(".")
    findings: list[Finding] = []
    done: list[str] = []
    if ext == "json" or want == "json":
        done.append("json")
        try:
            json.loads(text)
        except ValueError as exc:
            findings.append(Finding("format", "error", "invalid_json", f"Geçersiz JSON: {exc}",
                                    getattr(exc, "lineno", None)))
    elif ext == "jsonl":
        for no, line in enumerate(text.splitlines(), 1):
            if line.strip():
                try:
                    json.loads(line)
                except ValueError:
                    findings.append(Finding("format", "error", "invalid_json", "Geçersiz JSON satırı", no,
                                            excerpt(line)))
                    break
        done.append("jsonl")
    elif ext in ("yaml", "yml"):
        done.append("yaml")
        try:
            import yaml
            yaml.safe_load(text)
        except Exception as exc:  # noqa: BLE001
            mark = getattr(exc, "problem_mark", None)
            findings.append(Finding("format", "error", "invalid_yaml", f"Geçersiz YAML: {str(exc)[:160]}",
                                    (mark.line + 1) if mark else None))
    elif ext == "py":
        done.append("python")
        try:
            compile(text, name or "<cikti>", "exec", dont_inherit=True)  # yalnız derleme (AST); kod çalışmaz
        except SyntaxError as exc:
            findings.append(Finding("format", "error", "syntax_error", f"Sözdizimi hatası: {exc.msg}", exc.lineno,
                                    excerpt(exc.text or "")))
    if want == "diff" or ext in ("diff", "patch"):
        if not re.search(r"^(?:diff --git |--- |\+\+\+ |@@ )", text, re.M):
            findings.append(Finding("format", "error", "not_a_diff", "Çıktı bir diff/yama biçiminde değil"))
        done.append("diff")
    markdownish = ext in ("md", "markdown", "") and kind in ("report", "text", "") or want in ("md", "docx")
    if markdownish:
        findings += _md_findings(text)
        done.append("markdown")
        if kind == "report" or want == "docx":
            err = _docx_ok(text, title)
            if err:
                findings.append(Finding("format", "error", "docx_export", f"Word dışa aktarımı başarısız: {err}"))
            done.append("docx")
    if not done:
        return CheckResult("format", "skipped", "Bu dosya türü için biçim denetimi yok")
    bad = [f for f in findings if f.severity == "error"]
    return CheckResult("format", "failed" if bad else "passed", ", ".join(done), findings[:MAX_FINDINGS_PER_CHECK])


# ---------------------------------------------------------------- 3. boş / yer tutucu
_PLACEHOLDER = re.compile(
    r"\b(TODO|TBD|FIXME|XXX)\b|lorem\s+ipsum|dolor\s+sit\s+amet|\[(?:buraya|insert|placeholder|yer tutucu|ekle)[^\]]*\]"
    r"|<(?:insert|buraya|placeholder)[^>]*>|\{\{\s*[\w.]+\s*\}\}|\b(?:yer tutucu|placeholder)\b"
    r"|\(\s*(?:doldurulacak|eklenecek|to be added|to be filled)\s*\)", re.I)


def check_placeholders(text: str) -> CheckResult:
    if not str(text or "").strip():
        return CheckResult("placeholders", "failed", "Çıktı boş",
                           [Finding("placeholders", "error", "empty", "Çıktı boş")])
    findings: list[Finding] = []
    for no, line in prose_lines(text):
        m = _PLACEHOLDER.search(line)
        if m:
            findings.append(Finding("placeholders", "error", "placeholder", f"Yer tutucu metin: {m.group(0)[:40]}",
                                    no, excerpt(line), {"token": m.group(0)[:40]}))
    # yalnız başlıktan ibaret, gövdesi boş bölüm
    hs = headings(text)
    lines = str(text).splitlines()
    for idx, (no, level, title) in enumerate(hs):
        end = hs[idx + 1][0] - 1 if idx + 1 < len(hs) else len(lines)
        body = [ln for ln in lines[no:end] if ln.strip() and not _SETEXT.match(ln)]
        has_sub = idx + 1 < len(hs) and hs[idx + 1][1] > level  # alt başlıkları olan bölüm boş sayılmaz
        if not body and not has_sub and level < 6:
            findings.append(Finding("placeholders", "warn", "empty_section", f"Bölüm boş: {excerpt(title, 60)}", no,
                                    params={"section": excerpt(title, 60)}))
    findings = findings[:MAX_FINDINGS_PER_CHECK]
    bad = any(f.severity == "error" for f in findings)
    return CheckResult("placeholders", "failed" if bad else "passed", f"{len(findings)} bulgu", findings)


# ---------------------------------------------------------------- 4. uzunluk
def words(text: str) -> int:
    return len(re.findall(r"\w+", str(text or "")))


def check_length(text: str, *, min_chars: int | None = None, max_chars: int | None = None,
                 min_words: int | None = None, max_words: int | None = None) -> CheckResult:
    n_chars, n_words = len(str(text or "").strip()), words(text)
    if not any(v is not None for v in (min_chars, max_chars, min_words, max_words)):
        return CheckResult("length", "skipped", f"{n_words} kelime · sınır tanımlı değil")
    findings: list[Finding] = []
    if min_chars is not None and n_chars < min_chars:
        findings.append(Finding("length", "error", "too_short", f"Çok kısa: {n_chars} karakter (en az {min_chars})",
                                params={"got": n_chars, "min": min_chars, "unit": "chars"}))
    if max_chars is not None and n_chars > max_chars:
        findings.append(Finding("length", "warn", "too_long", f"Çok uzun: {n_chars} karakter (en çok {max_chars})",
                                params={"got": n_chars, "max": max_chars, "unit": "chars"}))
    if min_words is not None and n_words < min_words:
        findings.append(Finding("length", "error", "too_short", f"Çok kısa: {n_words} kelime (en az {min_words})",
                                params={"got": n_words, "min": min_words, "unit": "words"}))
    if max_words is not None and n_words > max_words:
        findings.append(Finding("length", "warn", "too_long", f"Çok uzun: {n_words} kelime (en çok {max_words})",
                                params={"got": n_words, "max": max_words, "unit": "words"}))
    return CheckResult("length", "failed" if findings else "passed", f"{n_words} kelime, {n_chars} karakter",
                       findings)


# ---------------------------------------------------------------- 5. kaynaksız iddia sezgisi
_MONTHS = (r"ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık|january|february|march"
           r"|april|may|june|july|august|september|october|november|december")
_CLAIM_NUMBER = re.compile(
    r"%\s?\d|\d+(?:[.,]\d+)?\s?%|\b(?:19|20)\d{2}\b|\b\d{1,3}(?:[.,]\d{3})+\b|\$\s?\d|€\s?\d|₺\s?\d"
    r"|\b\d+(?:[.,]\d+)?\s?(?:milyon|milyar|bin|trilyon|million|billion|trillion|thousand|kat|katı|TL|USD|EUR|dolar"
    r"|euro|kişi|people|users|kullanıcı|şirket|companies)\b"
    r"|\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b|\b\d{1,2}\s+(?:" + _MONTHS + r")\b|\b\d{3,}\b", re.I)
_ATTRIBUTION = re.compile(
    r"according to|studies show|research shows|reportedly|experts say|(?:verilerine|raporuna|araştırmasına|araştırmaya"
    r"|verilere|raporlara|uzmanlara|kaynaklara|istatistiklere|anketine|ankete|çalışmaya|habere)\s+göre"
    r"|\b\w+(?:'[ae]|'y[ae]|'n[ae])\s+göre\b|araştırmalar gösteriyor|uzmanlar(?:a göre| belirtiyor)|bilindiği üzere",
    re.I)
_CITATION = re.compile(
    r"https?://\S+|www\.\S+|\]\([^)]+\)|\[\^?\d+\]|\[\w[^\]]{0,40}\]\[|\(\s*(?:kaynak|source|ref|bkz|see)\b"
    r"|\b(?:kaynak|kaynakça|source|sources|ref|referans)\s*:|\bdoi:\s*10\.|\(\w[\w .&-]{1,40},\s*(?:19|20)\d{2}\)", re.I)
_SENT_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-ZÇĞİÖŞÜ0-9\"'“(])")
_LIST_MARK = re.compile(r"^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s*)")


def _strip_noise(sentence: str) -> str:
    """Sayı sayılmaması gerekenler: liste numarası, saat (12:30), sürüm (v1.2.3), kod parçası (`x`)."""
    s = _LIST_MARK.sub("", sentence)
    s = re.sub(r"`[^`]*`", " ", s)
    s = re.sub(r"\bv?\d+\.\d+\.\d+\b", " ", s)
    s = re.sub(r"\b\d{1,2}:\d{2}\b", " ", s)
    return s


# FOLLOWUP (kalibrasyon): üst bilgi satırı ("Tarih: 21 Ekim", "Hazırlayan: …", "Sürüm: 1.4") ve görev listesi maddesi
# ("- [ ] … (23 Ekim)") iddia değildir — toplantı notu ve eylem listeleri haksız yere uyarı almasın.
_META_LINE = re.compile(
    r"^\s*(?:[-*+]\s+)?(?:\*\*|__)?(?:tarih|date|hazırlayan|sorumlu|sorumlusu|sahibi|owner|author|yazar|son tarih|due"
    r"|deadline|teslim tarihi|saat|time|sürüm|version|toplantı|meeting|katılımcılar|attendees|yer|location)"
    r"(?:\*\*|__)?\s*[:：]", re.I)
_TASK_ITEM = re.compile(r"^\s*[-*+]\s+\[[ xX]\]\s")
_SOURCES_TITLE = re.compile(r"^(?:\d+[.)]\s*)?(?:kaynaklar|kaynakça|kaynak|referanslar|references|sources|bibliography"
                            r"|bibliyografya|dipnotlar|notes and sources)\s*:?$", re.I)


def sources_section(text: str) -> tuple[int, int] | None:
    """Belgedeki kaynakça bölümü (başlık satırı, bölüm sonu) — içinde en az bir bağlantı ya da liste maddesi varsa."""
    hs = headings(text)
    lines = str(text or "").splitlines()
    for idx, (no, level, title) in enumerate(hs):
        if not _SOURCES_TITLE.match(title.strip(" *_`#")):
            continue
        end = next((n - 1 for n, lv, _t in hs[idx + 1:] if lv <= level), len(lines))
        body = lines[no:end]
        if any(_CITATION.search(ln) or _LIST_MARK.match(ln) for ln in body if ln.strip()):
            return no, end
    return None


def unsourced_claims(text: str) -> list[Finding]:
    """Sayı, tarih ya da "…'e göre" içeren ve aynı paragrafta bağlantı/atıf olmayan cümleler.

    Paragraf = boş satırla ayrılan blok (tablo bloğu tek paragraf); başlıklar ve kod blokları sayılmaz. Paragrafın
    hemen altındaki "Kaynak:" satırı da paragrafı kapsar."""
    findings: list[Finding] = []
    bib = sources_section(text)
    lines = [(no, ln) for no, ln in prose_lines(text) if not (bib and bib[0] <= no <= bib[1])]  # kaynakça taranmaz
    paras: list[list[tuple[int, str]]] = [[]]
    prev_no = None
    for no, line in lines:
        if not line.strip() or (prev_no is not None and no != prev_no + 1):
            if paras[-1]:
                paras.append([])
            if not line.strip():
                prev_no = no
                continue
        if _HEADING.match(line) or _BOLD_HEADING.match(line):
            if paras[-1]:
                paras.append([])
            prev_no = no
            continue
        paras[-1].append((no, line))
        prev_no = no
    paras = [p for p in paras if p]
    for idx, para in enumerate(paras):
        block = "\n".join(line for _n, line in para)
        nxt = "\n".join(line for _n, line in paras[idx + 1][:1]) if idx + 1 < len(paras) else ""
        if _CITATION.search(block) or re.match(r"^\s*(?:\*\*)?(?:kaynak|source)", nxt, re.I):
            continue
        for no, line in para:
            if _TABLE_SEP.match(line) or _META_LINE.match(line) or _TASK_ITEM.match(line):
                continue
            for sent in _SENT_SPLIT.split(line):
                clean = _strip_noise(sent)
                if len(clean.strip()) < 12:
                    continue
                attr = _ATTRIBUTION.search(clean)
                num = _CLAIM_NUMBER.search(clean)
                if attr or num:
                    why = "attribution" if attr else "number"
                    findings.append(Finding("unsourced", "warn", "unsourced_claim",
                                            "Kaynaksız iddia: " + ("atıf var, kaynak yok" if attr
                                                                   else "sayı/tarih var, kaynak yok"),
                                            no, excerpt(sent), {"reason": why}))
                if len(findings) >= MAX_FINDINGS_PER_CHECK:
                    return findings
    return findings


def check_unsourced(text: str, *, strict: bool = False) -> CheckResult:
    findings = unsourced_claims(text)
    # FOLLOWUP (kalibrasyon): belgede kaynakça bölümü varsa (sonda "Kaynaklar" listesi — yaygın biçim) satır içi atıfsız
    # iddia katı kipte de yalnız uyarıdır: kaynak verilmiş, eşleştirmesi okuyucuya kalmış; çıktı kapıdan düşmez.
    if strict and sources_section(text) is None:
        for f in findings:
            f.severity = "error"
    return CheckResult("unsourced", "failed" if findings else "passed",
                       f"{len(findings)} kaynaksız iddia" if findings else "Kaynaksız iddia bulunmadı", findings)


# ---------------------------------------------------------------- 6. bozuk bağlantı (yalnız biçim; ağ yok)
_MD_LINK = re.compile(r"(!?)\[([^\]]*)\]\(([^)]*)\)")
_REF_USE = re.compile(r"\[([^\]]+)\]\[([^\]]*)\]")
_REF_DEF = re.compile(r"^\s{0,3}\[([^\]]+)\]:\s*(\S+)", re.M)
_BARE_URL = re.compile(r"\b(?:https?|ftp)://[^\s<>()\[\]]*", re.I)
_URL_OK = re.compile(r"^(?:https?://[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9-]+)*(?::\d{1,5})?"
                     r"(?:[/?#][^\s]*)?|mailto:[^\s@]+@[^\s@]+\.[^\s@]+|#[\w-]+|\.{0,2}/?[\w./-]+(?:#[\w-]+)?)$")
_BAD_SCHEME = re.compile(r"^(?:htp|htps|http|https)(?::/(?!/)|//|:\\)|^https?:/{3,}|^javascript:|^data:", re.I)


def check_links(text: str) -> CheckResult:
    findings: list[Finding] = []
    defs = {fold(m.group(1)) for m in _REF_DEF.finditer(text)}
    total = 0
    for no, line in prose_lines(text):
        for m in _MD_LINK.finditer(line):
            total += 1
            url = m.group(3).strip().split(" ")[0].strip("<>")
            if not url:
                findings.append(Finding("links", "warn", "empty_link", "Bağlantı adresi boş", no, excerpt(m.group(0))))
            elif re.match(r"^javascript:", url, re.I):
                findings.append(Finding("links", "error", "unsafe_link", "Güvensiz bağlantı şeması", no,
                                        excerpt(m.group(0))))
            elif _BAD_SCHEME.match(url) or not _URL_OK.match(url):
                findings.append(Finding("links", "warn", "malformed_link", f"Bozuk bağlantı: {excerpt(url, 80)}", no,
                                        excerpt(m.group(0)), {"url": excerpt(url, 80)}))
        for m in _REF_USE.finditer(line):
            ref = fold(m.group(2) or m.group(1))
            total += 1
            if ref not in defs:
                findings.append(Finding("links", "warn", "undefined_ref", f"Tanımsız bağlantı referansı: {m.group(0)[:60]}",
                                        no, excerpt(m.group(0))))
        stripped = _MD_LINK.sub(" ", line)
        for m in _BARE_URL.finditer(stripped):
            total += 1
            url = m.group(0).rstrip(".,;:!?'\"")
            if not _URL_OK.match(url):
                findings.append(Finding("links", "warn", "malformed_link", f"Bozuk bağlantı: {excerpt(url, 80)}", no,
                                        excerpt(line), {"url": excerpt(url, 80)}))
        for m in re.finditer(r"\b(?:htp|htps|http|https):/(?!/)\S+|\bhttps?//\S+", stripped, re.I):
            total += 1
            findings.append(Finding("links", "warn", "malformed_link", f"Bozuk bağlantı: {excerpt(m.group(0), 80)}",
                                    no, excerpt(line), {"url": excerpt(m.group(0), 80)}))
    findings = findings[:MAX_FINDINGS_PER_CHECK]
    if not total:
        return CheckResult("links", "passed", "Bağlantı yok")
    return CheckResult("links", "failed" if findings else "passed", f"{total} bağlantı, {len(findings)} sorunlu",
                       findings)


# ---------------------------------------------------------------- 7. kişisel veri (yalnız işaretleme; MASKELEME YOK)
_EMAIL = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_PHONE = re.compile(r"(?<![\w+])(?:\+90[\s.-]?|0090[\s.-]?|0)?\(?5\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}(?!\d)"
                    r"|(?<![\w+])(?:\+90[\s.-]?|0)\(?[2-4]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}(?!\d)"
                    r"|(?<![\w])\+(?!90)\d{1,3}[\s.-]?\(?\d{2,4}\)?(?:[\s.-]?\d{2,4}){2,4}(?!\d)")
_IBAN = re.compile(r"\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b")
_TCKN = re.compile(r"(?<![\d.,])[1-9]\d{10}(?![\d.,])")
_SAFE_EMAIL_DOMAINS = ("example.com", "example.org", "example.net", "ornek.com", "test.com", "localhost")


def tckn_valid(s: str) -> bool:
    """T.C. kimlik numarası sağlama kuralı (11 hane, ilk hane ≠ 0, 10. ve 11. hane sağlaması)."""
    if not re.fullmatch(r"[1-9]\d{10}", s):
        return False
    d = [int(c) for c in s]
    if ((sum(d[0:9:2]) * 7 - sum(d[1:8:2])) % 10) != d[9]:
        return False
    return sum(d[:10]) % 10 == d[10]


def iban_valid(raw: str) -> bool:
    s = raw.replace(" ", "").upper()
    if not 15 <= len(s) <= 34 or not re.fullmatch(r"[A-Z]{2}\d{2}[A-Z0-9]+", s):
        return False
    if s.startswith("TR") and len(s) != 26:
        return False
    moved = s[4:] + s[:4]
    digits = "".join(str(int(c, 36)) for c in moved)
    return int(digits) % 97 == 1


def mask_pii(kind: str, value: str) -> str:
    """Bulgu kesitinde kişisel verinin yalnız ucu görünür (bulgu listesi veriyi yeniden yaymaz)."""
    v = value.strip()
    if kind == "email":
        local, _sep, domain = v.partition("@")
        return (local[:1] + "***@" + domain) if domain else "***"
    keep = re.sub(r"\D", "", v) if kind in ("phone", "tckn") else v.replace(" ", "")
    return ("•" * max(0, len(keep) - 4)) + keep[-4:] if len(keep) > 4 else "••••"


def pii_hits(text: str) -> list[tuple[int, str, str]]:
    """(satır, tür, değer) — e-posta, telefon, IBAN (mod-97 geçerli), T.C. kimlik no (sağlaması geçerli)."""
    hits: list[tuple[int, str, str]] = []
    for no, line in enumerate(str(text or "").splitlines(), 1):
        taken: list[tuple[int, int]] = []

        def add(kind: str, m: re.Match[str]) -> None:
            if any(a < m.end() and m.start() < b for a, b in taken):
                return
            taken.append((m.start(), m.end()))
            hits.append((no, kind, m.group(0)))

        for m in _IBAN.finditer(line):
            if iban_valid(m.group(0)):
                add("iban", m)
        for m in _EMAIL.finditer(line):
            if not m.group(0).lower().endswith(_SAFE_EMAIL_DOMAINS):
                add("email", m)
        for m in _TCKN.finditer(line):
            if tckn_valid(m.group(0)):
                add("tckn", m)
        for m in _PHONE.finditer(line):
            if len(re.sub(r"\D", "", m.group(0))) >= 10:
                add("phone", m)
    return hits


PII_LABEL = {"email": "e-posta", "phone": "telefon", "iban": "IBAN", "tckn": "T.C. kimlik no"}


def check_pii(text: str, *, strict: bool = False) -> CheckResult:
    findings: list[Finding] = []
    for no, kind, value in pii_hits(text)[:MAX_FINDINGS_PER_CHECK]:
        masked = mask_pii(kind, value)
        findings.append(Finding("pii", "error" if strict or kind in ("tckn", "iban") else "warn", "pii",
                                f"Kişisel veri olabilir ({PII_LABEL[kind]}): {masked}", no, masked,
                                {"kind": kind}))
    detail = (f"{len(findings)} olası kişisel veri; çıktıda maskelenmedi, gözden geçir" if findings
              else "Kişisel veri kalıbı bulunmadı")
    return CheckResult("pii", "failed" if findings else "passed", detail, findings)


# ---------------------------------------------------------------- 8. sahip ve tarih (tarif kuralı)
def check_owner_date(text: str) -> CheckResult:
    owner = re.search(r"\b(?:sahibi|sorumlu|sorumlusu|hazırlayan|owner|responsible|author|yazar)\s*[:：-]", text, re.I)
    date = re.search(r"\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\s+(?:" + _MONTHS + r")\b",
                     text, re.I)
    findings = []
    if not owner:
        findings.append(Finding("owner_date", "error", "missing_owner", "Sorumlu/sahip satırı yok"))
    if not date:
        findings.append(Finding("owner_date", "error", "missing_date", "Tarih yok"))
    return CheckResult("owner_date", "failed" if findings else "passed", "", findings)


CHECKS: dict[str, Callable[..., CheckResult]] = {
    "sections": check_sections, "format": check_format, "placeholders": check_placeholders,
    "length": check_length, "unsourced": check_unsourced, "links": check_links, "pii": check_pii,
    "owner_date": check_owner_date,
}
