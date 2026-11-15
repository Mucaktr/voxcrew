"""Dışa aktarım (S50): Markdown → Word `.docx`, yalnızca standart kitaplıkla (zipfile + elle yazılmış WordprocessingML).

Kapsam bilinçli olarak küçük: başlıklar (#–###### → Başlık 1–3), paragraflar, madde ve numaralı listeler, alıntı, kod
blokları (eş aralıklı), tablolar (satırlar sekmeyle ayrılmış eş aralıklı satır), satır içi **kalın**, *italik*, `kod`
ve [bağlantı](adres) → "bağlantı (adres)". Yeni bağımlılık yok (AGENTS kural 5). Metin çağırandan maskeli gelir.
"""

from __future__ import annotations

import io
import re
import zipfile
from xml.sax.saxutils import escape

_INVALID_XML = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]")
_INLINE = re.compile(r"(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)|\*[^*\n]+\*|_[^_\n]+_)")
_HEADING = re.compile(r"^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$")
_BULLET = re.compile(r"^(\s*)[-*+]\s+(.*)$")
_NUMBER = re.compile(r"^(\s*)(\d+)[.)]\s+(.*)$")
_TABLE_SEP = re.compile(r"^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$")

_CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>"""

_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>"""

_DOC_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>"""


def _style(sid: str, name: str, size: int, bold: bool = False, before: int = 0, after: int = 120,
           font: str | None = None, outline: int | None = None) -> str:
    rpr = (f'<w:rFonts w:ascii="{font}" w:hAnsi="{font}" w:cs="{font}"/>' if font else "") + \
          ("<w:b/>" if bold else "") + f'<w:sz w:val="{size}"/>'
    ppr = f'<w:spacing w:before="{before}" w:after="{after}"/>' + \
          (f'<w:outlineLvl w:val="{outline}"/>' if outline is not None else "") + \
          ('<w:keepNext/>' if outline is not None else "")
    return (f'<w:style w:type="paragraph" w:styleId="{sid}"><w:name w:val="{name}"/>'
            f'<w:basedOn w:val="Normal"/><w:qFormat/><w:pPr>{ppr}</w:pPr><w:rPr>{rpr}</w:rPr></w:style>')


_STYLES = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
           '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
           '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>'
           '<w:sz w:val="22"/><w:lang w:val="tr-TR"/></w:rPr></w:rPrDefault>'
           '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>'
           '</w:docDefaults>'
           '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
           + _style("Title", "Title", 40, True, 0, 240)
           + _style("Heading1", "heading 1", 32, True, 240, 120, outline=0)
           + _style("Heading2", "heading 2", 28, True, 200, 100, outline=1)
           + _style("Heading3", "heading 3", 24, True, 160, 80, outline=2)
           + _style("Code", "Code", 19, False, 0, 0, font="Consolas")
           + _style("Quote", "Quote", 22, False, 60, 60)
           + '</w:styles>')


def _clean(text: str) -> str:
    return escape(_INVALID_XML.sub("", text))


def _run(text: str, *, bold: bool = False, italic: bool = False, code: bool = False) -> str:
    if not text:
        return ""
    rpr = ("<w:b/>" if bold else "") + ("<w:i/>" if italic else "") + \
          ('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>' if code else "")
    return f'<w:r>{"<w:rPr>" + rpr + "</w:rPr>" if rpr else ""}<w:t xml:space="preserve">{_clean(text)}</w:t></w:r>'


def _inline(text: str) -> str:
    out: list[str] = []
    for part in _INLINE.split(text):
        if not part:
            continue
        if (part.startswith("**") and part.endswith("**")) or (part.startswith("__") and part.endswith("__")):
            out.append(_run(part[2:-2], bold=True))
        elif part.startswith("`") and part.endswith("`") and len(part) > 1:
            out.append(_run(part[1:-1], code=True))
        elif part.startswith("[") and "](" in part and part.endswith(")"):
            label, url = part[1:-1].split("](", 1)
            out.append(_run(f"{label} ({url})"))
        elif len(part) > 2 and part[0] == part[-1] and part[0] in "*_":
            out.append(_run(part[1:-1], italic=True))
        else:
            out.append(_run(part))
    return "".join(out)


def _para(runs: str, style: str | None = None, indent: int = 0) -> str:
    ppr = (f'<w:pStyle w:val="{style}"/>' if style else "") + (f'<w:ind w:left="{indent}"/>' if indent else "")
    return f'<w:p>{"<w:pPr>" + ppr + "</w:pPr>" if ppr else ""}{runs}</w:p>'


def markdown_to_body(md: str) -> str:
    paras: list[str] = []
    buf: list[str] = []
    in_code = False

    def flush() -> None:
        if buf:
            paras.append(_para(_inline(" ".join(s.strip() for s in buf))))
            buf.clear()

    for raw in str(md or "").replace("\r\n", "\n").split("\n"):
        line = raw.rstrip()
        if line.strip().startswith("```"):
            flush()
            in_code = not in_code
            continue
        if in_code:
            paras.append(_para(_run(line or " ", code=True), "Code"))
            continue
        if not line.strip():
            flush()
            continue
        if m := _HEADING.match(line):
            flush()
            level = min(3, len(m.group(1)))
            paras.append(_para(_inline(m.group(2)), f"Heading{level}"))
        elif _TABLE_SEP.match(line):
            continue
        elif line.lstrip().startswith("|"):
            flush()
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            paras.append(_para(_run("\t".join(cells), code=True), "Code"))
        elif m := _BULLET.match(line):
            flush()
            depth = len(m.group(1).replace("\t", "  ")) // 2
            paras.append(_para(_run("• ") + _inline(m.group(2)), indent=360 + 360 * depth))
        elif m := _NUMBER.match(line):
            flush()
            depth = len(m.group(1).replace("\t", "  ")) // 2
            paras.append(_para(_run(f"{m.group(2)}. ") + _inline(m.group(3)), indent=360 + 360 * depth))
        elif line.lstrip().startswith(">"):
            flush()
            paras.append(_para(_inline(line.lstrip()[1:].strip()), "Quote", indent=360))
        else:
            buf.append(line)
    flush()
    return "".join(paras) or _para("")


def markdown_to_docx(md: str, title: str | None = None) -> bytes:
    """Markdown metninden geçerli bir .docx (Office Open XML) üretir."""
    body = (_para(_inline(title), "Title") if title else "") + markdown_to_body(md)
    document = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                f'<w:body>{body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
                '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="709" w:footer="709" '
                'w:gutter="0"/></w:sectPr></w:body></w:document>')
    core = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
            'xmlns:dc="http://purl.org/dc/elements/1.1/">'
            f'<dc:title>{_clean(title or "")}</dc:title></cp:coreProperties>')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", _CONTENT_TYPES)
        z.writestr("_rels/.rels", _RELS)
        z.writestr("word/_rels/document.xml.rels", _DOC_RELS)
        z.writestr("word/document.xml", document)
        z.writestr("word/styles.xml", _STYLES)
        z.writestr("docProps/core.xml", core)
    return buf.getvalue()
