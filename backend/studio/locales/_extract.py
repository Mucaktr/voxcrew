"""Hata iletisi tarayıcısı (Ekip S16 — geliştirme yardımcısı, çalışma anında kullanılmaz).

`backend/studio` altındaki Python dosyalarını AST ile tarar ve kullanıcıya dönen iletileri toplar:
- `HTTPException(<kod>, "<ileti>")` / `HTTPException(status_code=…, detail="<ileti>")`
- `raise <X>Error("<ileti>")` (ValueError, KeyError, OfficeError, WorkflowError, RouteError, TemplateError …)
- `_reject(send, <kod>, "<ileti>")` (security.py)
- sözlük sabitlerinde `"detail" | "error" | "message": "<ileti>"`

f-string'ler şablona çevrilir: `f"Ajan yok: {agent}"` → `Ajan yok: {}`. Çıktı, `en.py` kataloğunu yazarken ve
eksik çevirileri bulurken kullanılır:

    cd backend
    uv run --no-sync python -m studio.locales._extract            # tüm adaylar (dosya:satır, şablon)
    uv run --no-sync python -m studio.locales._extract --missing  # en.py'de karşılığı olmayanlar
    uv run --no-sync python -m studio.locales._extract --json     # JSON liste
"""

from __future__ import annotations

import ast
import json
import sys
from pathlib import Path

STUDIO_DIR = Path(__file__).resolve().parents[1]
DICT_KEYS = {"detail", "error", "message"}
SKIP_DIRS = {"locales", "__pycache__"}
# Kullanıcıya gösterilmeyen ya da zaten iki dilli veri olan dizgiler (iç belirteçler, protokol metinleri,
# akademi kataloğunun TR/EN alanları). `--missing` bunları eksik saymaz; kapı (scripts/gate.py) gürültüsüz kalsın.
NOT_MESSAGES = {
    "HTTP {}", "/health → HTTP {}", "Cannot operate on a closed database.", "invalid_url",
    "binop", "call", "compare", "attr-call", "comp-target",
    "Ajan planı hazırladı. Onaylarsan akış biter; reddedersen de güvenle durur. Devam edilsin mi?",
    "The agent drafted the plan. Approve to finish the workflow; rejecting stops it safely too. Continue?",
}


def _template(node: ast.AST) -> str | None:
    """Dizgi ya da f-string düğümünü `{}` yer tutuculu şablona çevirir; başka türler için None."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.JoinedStr):
        parts: list[str] = []
        for v in node.values:
            if isinstance(v, ast.Constant) and isinstance(v.value, str):
                parts.append(v.value)
            elif isinstance(v, ast.FormattedValue):
                parts.append("{}")
        return "".join(parts)
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):  # "a" + "b" ya da "a" + x
        left, right = _template(node.left), _template(node.right)
        return (left if left is not None else "{}") + (right if right is not None else "{}")
    if isinstance(node, (ast.Tuple, ast.List)) and node.elts:  # ("a" "b") biçimi değil; ilk öğeyi dene
        return None
    return None


def _call_name(node: ast.Call) -> str:
    fn = node.func
    if isinstance(fn, ast.Name):
        return fn.id
    if isinstance(fn, ast.Attribute):
        return fn.attr
    return ""


def scan_file(path: Path) -> list[dict[str, object]]:
    try:
        tree = ast.parse(path.read_text("utf-8"), filename=str(path))
    except (SyntaxError, UnicodeDecodeError, OSError):
        return []
    rel = str(path.relative_to(STUDIO_DIR)).replace("\\", "/")
    out: list[dict[str, object]] = []

    def add(kind: str, node: ast.AST, msg: str | None, status: int | None = None) -> None:
        if not msg or not msg.strip() or not any(ch.isalpha() for ch in msg):
            return
        out.append({"where": f"{rel}:{getattr(node, 'lineno', 0)}", "kind": kind, "status": status, "tr": msg})

    for node in ast.walk(tree):
        if isinstance(node, ast.Raise) and isinstance(node.exc, ast.Call) and node.exc.args:
            if _call_name(node.exc) != "HTTPException":  # HTTPException aşağıda durum koduyla toplanır
                add("raise", node, _template(node.exc.args[0]))
        elif isinstance(node, ast.Call):
            name = _call_name(node)
            if name == "HTTPException":
                status = None
                detail = None
                if node.args:
                    a0 = node.args[0]
                    if isinstance(a0, ast.Constant) and isinstance(a0.value, int):
                        status = a0.value
                    if len(node.args) > 1:
                        detail = _template(node.args[1])
                for kw in node.keywords:
                    if kw.arg == "status_code" and isinstance(kw.value, ast.Constant):
                        status = kw.value.value
                    elif kw.arg == "detail":
                        detail = _template(kw.value)
                add("http", node, detail, status)
            elif name == "_reject" and len(node.args) >= 3:
                st = node.args[1].value if isinstance(node.args[1], ast.Constant) else None
                add("reject", node, _template(node.args[2]), st)
        elif isinstance(node, ast.Dict):
            for k, v in zip(node.keys, node.values):
                if isinstance(k, ast.Constant) and k.value in DICT_KEYS:
                    add(f"dict:{k.value}", node, _template(v))
    return out


def scan(root: Path = STUDIO_DIR) -> list[dict[str, object]]:
    found: list[dict[str, object]] = []
    for path in sorted(root.rglob("*.py")):
        if any(part in SKIP_DIRS for part in path.relative_to(root).parts):
            continue
        found.extend(scan_file(path))
    return found


def main(argv: list[str]) -> int:
    rows = scan()
    if "--missing" in argv:
        from studio.locales import en  # noqa: WPS433 — yalnızca geliştirme aracı
        known = set(en.MESSAGES)
        rows = [r for r in rows if r["tr"] not in known and r["tr"] not in NOT_MESSAGES]
    if "--json" in argv:
        print(json.dumps(rows, ensure_ascii=False, indent=1))
        return 0
    seen: dict[str, list[str]] = {}
    for r in rows:
        seen.setdefault(str(r["tr"]), []).append(str(r["where"]))
    for tr, wheres in seen.items():
        print(f"{tr!r}\n    # {', '.join(wheres[:4])}{' …' if len(wheres) > 4 else ''}")
    print(f"\n{len(seen)} benzersiz ileti, {len(rows)} konum", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
