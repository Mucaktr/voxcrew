"""kostüm içerik politikası (ürün sahibinin katı ürün kuralı, 2026-10-27).

Tek kaynak:
- `RULES`: K-1..K-10 kural listesi.
- `POLICY-TERMS` bloğu: yasaklı TR/EN sözcükler (ad, kimlik, açıklama ve lore taranır; `ip_note`/`culture_note` taranmaz).
  Ön yüz testi (`frontend/scripts/costume_policy.mjs`) bu bloğu işaretler arasından okur (`free_map_ip` deseni).
- `POLICY-REVIEW-TERMS` bloğu: insan incelemesi isteyen sözcükler (red değil, listelenir).
- `POLICY-HEURISTICS` bloğu: renk kovası, bant, imza (G-6/7/8/P kesin red; G-K/G-U/G-Y inceleme) ve amblem şablonları
  VERİ olarak (katı JSON). Ön yüz kutu verisini 4 yönden + üstten ızgaraya izdüşürüp aynı veriyle denetler; bu modül aynı
  algoritmayı renk ızgarası (desen/bant düzenleyicisinin üreteceği biçim) üzerinde çalıştırır: `check_pattern`.

Kapsam (karar O8): satılan ve dağıtılan bütün kozmetik içerik ve ileride gelecek desen düzenleyicisi.
Kullanıcının tek tek seçtiği tek renkler ve yerel dünyası taranmaz.

Kanca noktaları (bugün):
- `cosmetics.catalog.validate` → `cosmetic_errors` (set/parça adları, `local-` önekli kimlik `store:` kataloğunda yok).
- `citypacks.catalog.validate` → `citypack_errors` (paket ve öğe adları).
- `market.manifest.parse_manifest` → `term_hits` (kozmetik/sahne paket adı, açıklaması ve etiketleri; uzak katalog dahil).
- Gelecek desen/bant düzenleyicisi: kaydetmeden ve yayınlamadan önce `check_pattern(grid)`; `verdict == "fail"` → reddet,
  `"review"` → yayın kuyruğuna insan incelemesi. Bugün böyle bir düzenleyici yoktur (avatar alanları tek renktir).

Bu dosya saf veridir ve yalnız standart kitaplığı kullanır.
"""

from __future__ import annotations

import json
import math
import re
import unicodedata
from typing import Any, Iterable, Sequence

# ---------------------------------------------------------------------------------------------------------- kurallar
RULES: tuple[dict[str, str], ...] = (
    {"id": "K-1", "outcome": "fail", "tr": "Siyasi, ideolojik, aktivist ve hareket simgesi yok (parti, rejim, ayrılıkçı, "
     "savaş tarafı, protesto, kampanya).", "en": "No political, ideological, activist or movement symbols."},
    {"id": "K-2", "outcome": "fail", "tr": "LGBT/onur simgesi yok: gökkuşağı onur bayrağı (6/7/8 şerit), Progress ve "
     "türevleri, diğer kimlik bayrakları, pembe/siyah ters üçgen, iç içe cinsiyet simgeleri, lambda, onur metinleri. "
     "Sıralı gökkuşağı bandı (G-6/7/8/P) kesin reddir, istisna yoktur.",
     "en": "No LGBT/pride symbols: pride flags (6/7/8 stripes), Progress variants, other identity flags, pink/black "
     "triangle, interlocked gender symbols, lambda, pride terms. Ordered rainbow bands are a hard fail with no exception."},
    {"id": "K-3", "outcome": "fail", "tr": "Dinî giysi ve simge yok.", "en": "No religious garments or symbols."},
    {"id": "K-4", "outcome": "fail", "tr": "Karikatür ve stereotip yok.", "en": "No caricature or stereotype."},
    {"id": "K-5", "outcome": "fail", "tr": "Gerçek polis, askerî ve kurum üniforması yok.",
     "en": "No real police, military or institutional uniforms."},
    {"id": "K-6", "outcome": "fail", "tr": "Marka, logo ve gerçek yazı yok.", "en": "No brands, logos or real text."},
    {"id": "K-7", "outcome": "review", "tr": "Ulusal/bölgesel bayrak, arma, harita ve kulüp renk çifti yok (inceleme).",
     "en": "No national/regional flags, coats of arms, maps or club colour pairs (review)."},
    {"id": "K-8", "outcome": "fail", "tr": "Aşırılık simgesi yok (gamalı haç, SS runları, kurt kancası, orak-çekiç…).",
     "en": "No extremist symbols (swastika, SS runes, wolfsangel, hammer and sickle…)."},
    {"id": "K-9", "outcome": "fail", "tr": "Gerçek kişi portresi yok.", "en": "No real-person portraits."},
    {"id": "K-10", "outcome": "pass", "tr": "Aşırı engelleme yok: sıradan çok renkli tasarımlar (karışık sıralı karnaval "
     "yamaları, gökkuşağı renkli uçurtma, çok renkli flama, tek renkli kostüm ailesi, yıldız, kalp) serbesttir.",
     "en": "No over-blocking: ordinary colourful designs (mixed-order carnival patches, rainbow kite, multicolour bunting, "
     "single-colour costume families, stars, hearts) are allowed."},
)
RULE_IDS = tuple(r["id"] for r in RULES)

# ------------------------------------------------------------------------------------------------- sözcük listeleri
# Eşleme: sözcük sınırıyla, büyük/küçük harfe ve aksana duyarsız (`fold`). "trans" yalnız tek sözcüktür
# ("transit", "transfer" eşleşmez). "onur" ve "rainbow" tek başına serbesttir (onur = şeref; gökkuşağı uçurtma K-10).
# POLICY-TERMS-START
BANNED_TERMS: tuple[str, ...] = (
    "pride", "pride flag", "onur yürüyüşü", "onur haftası", "onur ayı", "onur bayrağı",
    "lgbt", "lgbti", "lgbtq", "lgbtqi", "lgbtqia", "lgbtiq", "lgbtqi+", "glbt", "lgbtt",
    "queer", "gay", "gey", "lezbiyen", "lesbian", "biseksüel", "bisexual",
    "transgender", "transseksüel", "transsexual", "trans", "non-binary", "nonbinary", "non binary",
    "interseks", "intersex", "aseksüel", "asexual", "panseksüel", "pansexual",
    "eşcinsel", "homoseksüel", "homosexual",
    "rainbow flag", "gökkuşağı bayrağı", "progress flag",
    "antifa", "nazi", "faşist", "fascist", "komünist", "communist", "swastika", "gamalı haç",
    "orak çekiç", "orak-çekiç", "hammer and sickle", "kurt kancası", "wolfsangel",
    "kkk", "ku klux", "isis", "işid", "daeş", "deaş", "pkk", "ypg", "fetö", "hamas", "hizbullah", "hezbollah",
    "taliban", "black lives matter", "blm", "maga",
    "akp", "ak parti", "chp", "mhp", "hdp", "dem parti", "iyi parti",
)
# POLICY-TERMS-END
# POLICY-REVIEW-TERMS-START
REVIEW_TERMS: tuple[str, ...] = (
    "bayrak", "flag", "üniforma", "uniform", "geleneksel", "traditional",
)
# POLICY-REVIEW-TERMS-END

# --------------------------------------------------------------------------------------------- sezgiler (katı JSON)
# Birimler: "px" karakter ölçüsü (16 px = 1 blok). `cell_px` ızgara hücresi; şehir paketi kutuları karo biriminden
# `tile_px` ile çevrilir. Kova sınırları H-2; bant H-3; imzalar H-4; amblemler (E) 'X' dolu, '.' boş.
# POLICY-HEURISTICS-START
_HEURISTICS_JSON = r"""
{
  "version": 1,
  "raster": {"cell_px": 0.25, "scene_cell_px": 0.5, "tile_px": 16, "views": ["front", "back", "left", "right", "top"],
             "celebration_t": [0, 0.25, 0.5, 0.75, 1]},
  "bucket": {
    "white_l": 0.85, "white_lowsat_s": 0.12, "white_lowsat_l": 0.75, "black_l": 0.15, "gray_s": 0.12,
    "brown_h": [15, 45], "brown_l": 0.4, "hue_s": 0.35, "hue_l": [0.18, 0.85],
    "hues": [["red", 345, 15], ["orange", 15, 40], ["yellow", 40, 70], ["green", 70, 170], ["turquoise", 170, 200],
             ["blue", 200, 255], ["purple", 255, 300], ["pink", 300, 345]],
    "light": {"blue": ["lightblue", 0.65], "turquoise": ["lightblue", 0.65], "pink": ["lightpink", 0.7],
              "red": ["lightpink", 0.7]}
  },
  "band": {"min_run_cells": 2, "ratio_max": 1.6, "boundary_tol_cells": 1, "min_lines": 4, "length_factor": 1.5,
           "max_window": 8, "max_fillers": 2},
  "rainbow": {
    "seq": ["red", "orange", "yellow", "green", "blue", "purple"],
    "fillers": ["pink", "lightpink", "turquoise", "lightblue"],
    "chevron": ["white", "lightpink", "lightblue", "brown", "black"], "chevron_min_distinct": 4,
    "curved_min_lines": 2, "seams": ["white", "black", "gray", "other"], "seam_max_frac": 0.5
  },
  "palettes": {
    "G-K": {
      "trans": {"seq": ["lightblue", "lightpink", "white", "lightpink", "lightblue"]},
      "bi": {"seq": ["pink", "other|purple|pink", "blue"], "ratio_max": 2.4},
      "lesbian": {"seq": ["red|orange", "orange", "white", "pink|lightpink"], "ratio_max": 3.2},
      "nonbinary": {"seq": ["yellow", "white", "purple", "black|gray"]},
      "pan": {"seq": ["pink", "yellow", "blue|turquoise"]},
      "asexual": {"seq": ["black", "gray", "white", "purple|pink"]},
      "intersex": {"seq": ["yellow", "purple|pink", "yellow", "purple|pink", "yellow"], "ring": true, "ratio_max": 99}
    },
    "G-U": {
      "fr_nl": {"seq": ["blue", "white", "red"]},
      "it_mx": {"seq": ["green", "white", "red"]},
      "de": {"seq": ["black", "red", "yellow|orange"]},
      "eg": {"seq": ["red", "white", "black"]},
      "ae": {"seq": ["green", "white", "black"]},
      "es": {"seq": ["red", "yellow", "red"], "ratio_max": 2.4},
      "th": {"seq": ["red", "white", "blue", "white", "red"], "ratio_max": 2.4}
    }
  },
  "flaglike": {"aspect": [1.2, 2.4], "patch_max_frac": 0.15},
  "emblem": {
    "regions": {"chest": {"view": "front", "x": [-3.2, 3.2], "y": [8.2, 14.4]},
                "back": {"view": "back", "x": [-3.2, 3.2], "y": [6.0, 14.4]}},
    "relief_px": 0.05, "min_side_cells": 8, "block_on": 0.4, "acc_min": 0.8, "iou_min": 0.72, "aspect_tol": 1.6,
    "templates": {
      "E-1": {"rule": "K-2", "outcome": "fail", "acc_min": 0.88, "iou_min": 0.8, "colors": ["pink", "lightpink", "black"], "rows": [
        "XXXXXXX", ".XXXXX.", ".XXXXX.", "..XXX..", "..XXX..", "...X..."]},
      "E-2": {"rule": "K-2", "outcome": "fail", "rows": [
        ".XXX.XXX.", "X...X...X", "X..X.X..X", "X...X...X", ".XXX.XXX."]},
      "E-3": {"rule": "K-2", "outcome": "fail", "rows": [
        "XX....", ".X....", "..X...", "..XX..", ".X..X.", ".X..X.", "X....X"]},
      "E-6": {"rule": "K-1", "outcome": "fail", "rows": [
        "..XXX..", ".X.X.X.", "X..X..X", "X..X..X", "X.XXX.X", ".XX.XX.", "..XXX.."]},
      "E-7": {"rule": "K-8", "outcome": "fail", "rows": [
        "...XX..", ".....X.", "XX....X", ".XX...X", "..XX.X.", ".X.XX..", "X..XXX."]},
      "E-8": {"rule": "K-8", "outcome": "fail", "rows": [
        "X..XXXX", "X..X...", "X..X...", "XXXXXXX", "...X..X", "...X..X", "XXXX..X"]},
      "E-9": {"rule": "K-1", "outcome": "fail", "rows": [
        ".XXX.", "X...X", "X...X", ".X.X.", "..X..", ".X.X.", "X...X"]},
      "E-10a": {"rule": "K-3", "outcome": "fail", "rows": [
        "..X..", "..X..", "XXXXX", "..X..", "..X..", "..X..", "..X.."]},
      "E-10b": {"rule": "K-3", "outcome": "fail", "rows": [
        ".XXX...", "XX.....", "X....X.", "X...XXX", "X....X.", "XX.....", ".XXX..."]},
      "E-10c": {"rule": "K-3", "outcome": "fail", "rows": [
        "...X...", "XXXXXXX", ".X...X.", "..X.X..", ".X...X.", "XXXXXXX", "...X..."]},
      "E-11": {"rule": "K-3", "outcome": "review", "colors": ["blue", "lightblue", "turquoise"], "needs": ["white"], "rows": [
        ".XXXXX.", "X.....X", "X..X..X", "X.XXX.X", "X..X..X", "X.....X", ".XXXXX."]}
    }
  }
}
"""
# POLICY-HEURISTICS-END
HEURISTICS: dict[str, Any] = json.loads(_HEURISTICS_JSON)
HARD_FAIL_SIGNATURES = ("G-6", "G-7/8", "G-P")

# ---------------------------------------------------------------------------------------------------- ad ve metin
_TR = str.maketrans("çğıöşüâîûİI", "cgiosuaiuii")


def fold(text: str) -> str:
    """Küçük harf, Türkçe harfler ve aksanlar ASCII'ye (eşlemenin iki tarafı da aynı katlanır)."""
    s = str(text).translate(_TR).lower()
    return "".join(ch for ch in unicodedata.normalize("NFKD", s) if not unicodedata.combining(ch))


def _term_re(terms: Iterable[str]) -> re.Pattern[str]:
    alts = sorted({fold(t) for t in terms}, key=len, reverse=True)
    return re.compile(r"(?<![a-z0-9])(" + "|".join(re.escape(a) for a in alts) + r")(?![a-z0-9])")


_BANNED_RE = _term_re(BANNED_TERMS)
_REVIEW_RE = _term_re(REVIEW_TERMS)


def term_hits(*texts: Any) -> list[str]:
    """Yasaklı sözcük eşleşmeleri (katlanmış biçim, sıralı, tekrarsız)."""
    return sorted({m.group(1) for t in texts if t for m in _BANNED_RE.finditer(fold(str(t)))})


def review_term_hits(*texts: Any) -> list[str]:
    return sorted({m.group(1) for t in texts if t for m in _REVIEW_RE.finditer(fold(str(t)))})


def check_names(items: Iterable[tuple[str, Sequence[Any]]]) -> list[str]:
    """`(kimlik, [taranacak metinler…])` çiftleri → hata satırları (kimlik de taranır)."""
    errs: list[str] = []
    for item_id, texts in items:
        hits = term_hits(item_id, *texts)
        if hits:
            errs.append(f"{item_id}: içerik kuralı (K-1/K-2) yasaklı sözcük: {', '.join(hits)}")
    return errs


def cosmetic_errors(sets: Iterable[Any]) -> list[str]:
    """`cosmetics.catalog.validate` kancası: ad/lore taraması ve `local-` kimliklerin satış kataloğunda olmaması."""
    rows: list[tuple[str, Sequence[Any]]] = []
    errs: list[str] = []
    for s in sets:
        rows.append((s.id, (s.name_tr, s.name_en, s.description_tr, s.description_en)))
        for p in s.pieces:
            rows.append((p.id, (p.label_tr, p.label_en)))
            if p.id.startswith("store:local-") or re.match(r"^store:[^:]*-local-", p.id):
                errs.append(f"{p.id}: yerel kostüm (local-*) satılmaz")
        if s.id.startswith("local-"):
            errs.append(f"{s.id}: yerel kostüm (local-*) satılmaz")
    return errs + check_names(rows)


def citypack_errors(packs: Iterable[Any]) -> list[str]:
    """`citypacks.catalog.validate` kancası: paket ve öğe adları (ip_note taranmaz)."""
    rows: list[tuple[str, Sequence[Any]]] = []
    for p in packs:
        rows.append((p.id, (p.name_tr, p.name_en, p.description_tr, p.description_en)))
        rows.extend((f"{p.id}-{i.id}", (i.name_tr, i.name_en)) for i in p.items)
    return check_names(rows)


# ------------------------------------------------------------------------------------------------- renk kovası
def hex_hsl(hex_color: str) -> tuple[float, float, float]:
    h = hex_color.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    mx, mn = max(r, g, b), min(r, g, b)
    lum = (mx + mn) / 2
    d = mx - mn
    if d == 0:
        return 0.0, 0.0, lum
    sat = d / (1 - abs(2 * lum - 1)) if lum not in (0, 1) else 0.0
    if mx == r:
        hue = 60 * (((g - b) / d) % 6)
    elif mx == g:
        hue = 60 * ((b - r) / d + 2)
    else:
        hue = 60 * ((r - g) / d + 4)
    return hue % 360, min(sat, 1.0), lum


def bucket(hex_color: str | None) -> str:
    """H-2 renk kovası. Boş hücre `empty`, ton kovasına girmeyen soluk renk `other`."""
    if not hex_color:
        return "empty"
    cfg = HEURISTICS["bucket"]
    hue, sat, lum = hex_hsl(hex_color)
    if lum > cfg["white_l"] or (sat < cfg["white_lowsat_s"] and lum > cfg["white_lowsat_l"]):
        return "white"
    if lum < cfg["black_l"]:
        return "black"
    if sat < cfg["gray_s"]:
        return "gray"
    if cfg["brown_h"][0] <= hue < cfg["brown_h"][1] and lum < cfg["brown_l"]:
        return "brown"
    if sat >= cfg["hue_s"] and cfg["hue_l"][0] <= lum <= cfg["hue_l"][1]:
        name = "other"
        for nm, lo, hi in cfg["hues"]:
            if (lo <= hue < hi) if lo < hi else (hue >= lo or hue < hi):
                name = nm
                break
        light = cfg["light"].get(name)
        if light and lum >= light[1]:
            return light[0]
        return name
    return "other"


# ------------------------------------------------------------------------------------------------ bant (H-3, H-4)
Run = tuple[str, int, int]          # (kova, başlangıç, uzunluk)


def runs_of(line: Sequence[str]) -> list[Run]:
    """Aynı kovalı ardışık hücre parçaları; < min_run_cells parçalar dikiş sayılıp atılır, aynı kova birleşir."""
    raw: list[list[Any]] = []
    for i, b in enumerate(line):
        if raw and raw[-1][0] == b:
            raw[-1][2] += 1
        else:
            raw.append([b, i, 1])
    min_run = HEURISTICS["band"]["min_run_cells"]
    out: list[list[Any]] = []
    for b, s, n in raw:
        if n < min_run:
            continue
        if out and out[-1][0] == b:
            out[-1][2] = s + n - out[-1][1]
        else:
            out.append([b, s, n])
    return [(b, s, n) for b, s, n in out]


def _alts(spec: str) -> set[str]:
    return set(spec.split("|"))


def _match_seq(runs: list[Run], seq: Sequence[str], fillers: Sequence[str] = (), max_fillers: int = 0,
               max_window: int = 99, seams: Sequence[str] = ()) -> list[tuple[int, int, int, list[int]]]:
    """Ardışık parçalarda dizi (ya da tersi) → (başlangıç, bitiş hariç, dolgu sayısı, bant dizinleri).

    `seams`: önceki banttan en çok `seam_max_frac` kadar ince nötr parça (ayırıcı çizgi) bant sayılmaz, diziyi bölmez."""
    frac = HEURISTICS["rainbow"]["seam_max_frac"]
    found: list[tuple[int, int, int, list[int]]] = []
    for s in (list(seq), list(reversed(seq))):
        for i in range(len(runs)):
            if runs[i][0] not in _alts(s[0]):
                continue
            k, extras, j, idx = 1, 0, i + 1, [i]
            while j < len(runs) and k < len(s) and len(idx) < max_window:
                b, n = runs[j][0], runs[j][2]
                if b in _alts(s[k]):
                    k += 1
                    idx.append(j)
                elif b in fillers and extras < max_fillers:
                    extras += 1
                    idx.append(j)
                elif not (b in seams and n <= frac * runs[idx[-1]][2] and j + 1 < len(runs)):
                    break
                j += 1
            if k == len(s):
                found.append((i, j, extras, idx))
        if list(seq) == list(reversed(seq)):
            break
    return found


def _lines(grid: Sequence[Sequence[str]]) -> dict[str, list[list[str]]]:
    rows = [list(r) for r in grid]
    cols = [list(c) for c in zip(*rows)] if rows else []
    return {"rows": rows, "cols": cols}


def _straight(lines: list[list[Run]], seq: Sequence[str], fillers: Sequence[str], max_fillers: int, ratio_max: float,
              max_window: int, seams: Sequence[str] = ()) -> list[dict[str, Any]]:
    """Düz bant: aynı dizi, sınırlar ±tol içinde, ≥ max(min_lines, length_factor × ort. kalınlık) komşu çizgide."""
    band = HEURISTICS["band"]
    tol = band["boundary_tol_cells"]
    per_line: list[list[tuple[tuple[str, ...], tuple[int, ...], float, int]]] = []
    for runs in lines:
        ms = []
        for _i, _j, extras, idx in _match_seq(runs, seq, fillers, max_fillers, max_window, seams):
            seg = [runs[k] for k in idx]
            lens = [n for _, _, n in seg]
            if max(lens) / min(lens) > ratio_max:
                continue
            bounds = tuple(x for _, s, n in seg for x in (s, s + n))
            ms.append((tuple(b for b, _, _ in seg), bounds, sum(lens) / len(lens), extras))
        per_line.append(ms)
    out: list[dict[str, Any]] = []
    for li, ms in enumerate(per_line):
        for sig, bounds, mean, extras in ms:
            n = 1
            for lj in range(li + 1, len(per_line)):
                if any(s2 == sig and all(abs(a - b) <= tol for a, b in zip(b2, bounds)) for s2, b2, _, _ in per_line[lj]):
                    n += 1
                else:
                    break
            if n >= max(band["min_lines"], math.ceil(band["length_factor"] * mean)):
                out.append({"line": li, "lines": n, "span": bounds[-1] - bounds[0], "colors": list(sig),
                            "extras": extras})
    return out


def band_findings(grid: Sequence[Sequence[str]], *, costume: bool = True, fill_cells: int | None = None,
                  label: str = "") -> list[dict[str, Any]]:
    """Kova ızgarasında (satırlar yukarıdan aşağı) H-4 imzaları. Bulgu: {sig, outcome, rule, where}."""
    band, rb, pal = HEURISTICS["band"], HEURISTICS["rainbow"], HEURISTICS["palettes"]
    lines = {d: [runs_of(line) for line in ls] for d, ls in _lines(grid).items()}
    filled = fill_cells if fill_cells is not None else sum(1 for r in grid for b in r if b != "empty")
    out: list[dict[str, Any]] = []
    rainbow = False
    for d, ls in lines.items():
        for hit in _straight(ls, rb["seq"], rb["fillers"], band["max_fillers"], band["ratio_max"], band["max_window"],
                             rb["seams"]):
            sig = "G-6" if hit["extras"] == 0 else "G-7/8"
            rainbow = True
            out.append({"sig": sig, "outcome": "fail", "rule": "K-2", "where": f"{label}{d} {hit['lines']} çizgi "
                        f"{'-'.join(hit['colors'])}"})
            break
    if rainbow:
        chev = set(rb["chevron"])
        for d, ls in lines.items():
            if any(len({b for b, _, _ in runs[i:j]}) >= rb["chevron_min_distinct"]
                   for runs in ls for i in range(len(runs)) for j in [_chev_end(runs, i, chev)]):
                out.append({"sig": "G-P", "outcome": "fail", "rule": "K-2", "where": f"{label}{d} Progress köşeli bölge"})
                break
    if costume and not rainbow:
        curved = sum(1 for ls in lines.values() for runs in ls
                     if _match_seq(runs, rb["seq"], rb["fillers"], band["max_fillers"], band["max_window"], rb["seams"]))
        if curved >= rb["curved_min_lines"]:
            out.append({"sig": "G-Y", "outcome": "review", "rule": "K-2",
                        "where": f"{label}kostümde kavisli/düzensiz sıralı gökkuşağı ({curved} çizgi)"})
    for group, rule in (("G-K", "K-2"), ("G-U", "K-7")):
        for name, spec in pal[group].items():
            ratio = spec.get("ratio_max", band["ratio_max"])
            if spec.get("ring"):
                hits = {d: sum(1 for runs in ls if _match_seq(runs, spec["seq"])) for d, ls in lines.items()}
                if hits["rows"] >= 3 and hits["cols"] >= 3:
                    out.append({"sig": group, "outcome": "review", "rule": rule, "where": f"{label}{name} halka"})
                continue
            for d, ls in lines.items():
                hits = _straight(ls, spec["seq"], (), 0, ratio, len(spec["seq"]))
                flag = [h for h in hits if _flaglike(h["lines"], h["span"], filled)]
                if flag:
                    h = flag[0]
                    out.append({"sig": group, "outcome": "review", "rule": rule,
                                "where": f"{label}{name} {d} {h['lines']}×{h['span']}"})
                    break
    return out


def _chev_end(runs: list[Run], i: int, chev: set[str]) -> int:
    j = i
    while j < len(runs) and runs[j][0] in chev:
        j += 1
    return j


def _flaglike(lines: int, span: int, filled: int) -> bool:
    fl = HEURISTICS["flaglike"]
    lo, hi = sorted((lines, span))
    aspect = hi / lo if lo else 99
    return fl["aspect"][0] <= aspect <= fl["aspect"][1] or (filled > 0 and lines * span <= fl["patch_max_frac"] * filled)


def check_pattern(grid: Sequence[Sequence[str | None]], *, costume: bool = True) -> dict[str, Any]:
    """Desen/bant düzenleyicisi kancası: hex renk ızgarası (None = boş) → {verdict, findings}.

    `verdict`: "fail" (G-6/7/8/P; istisna yok), "review" (G-K/G-U/G-Y; insan incelemesi), "pass"."""
    buckets = [[bucket(c) for c in row] for row in grid]
    findings = band_findings(buckets, costume=costume)
    verdict = "fail" if any(f["outcome"] == "fail" for f in findings) else (
        "review" if findings else "pass")
    return {"verdict": verdict, "findings": findings}


def review_entry_errors(entries: Iterable[dict[str, Any]]) -> list[str]:
    """İnceleme dosyası kaydı biçimi; G-6/7/8/P için istisna kabul edilmez."""
    errs: list[str] = []
    for e in entries:
        missing = [k for k in ("id", "sig", "decision", "reason", "by", "date") if not str(e.get(k) or "").strip()]
        if missing:
            errs.append(f"{e.get('id')}: eksik alan {', '.join(missing)}")
        if e.get("sig") in (*HARD_FAIL_SIGNATURES, "T"):
            errs.append(f"{e.get('id')}: {e.get('sig')} için istisna yok")
    return errs
