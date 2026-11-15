/**
 * HERO-PACKS — karakter ve kostüm setlerinin ortak voxel yardımcıları (saf veri; three/React yok).
 *
 * Yalnız var olan kutu dili: `BoxFn` ile kemiğe bağlı kutu, sahne kutusu (`SceneBox`). Saydamlık yalnız Crowd toplu
 * gruplarındaki değerler (0,32 · 0,45 · 0,82 · 0,95) ya da `glow`. Ölçü karakterle aynı ("piksel", 16 px = 1 blok):
 * gövde y 6–14 / ön yüz z = 2,5; kafa y 0–10 / yüz z = 5; kol omuzdan aşağı y 0…−7; bacak y 0…−6.
 *
 * Bu dosya `sets/` dışında durur: arka uç sözleşme testi (`tests/test_cosmetics_catalog.py`) `sets/*.ts` dosyalarının her
 * birinde bir set tanımı bekler.
 */
import type { BoxFn } from "../parts";
import type { SceneBox } from "./registry";

export interface SuitPalette {
  body: string;
  /** kol kılıfı (yoksa gövde rengi) */
  sleeve?: string;
  /** eldiven (yoksa çizilmez) */
  glove?: string;
  /** pantolon/tayt (yoksa çizilmez) */
  leg?: string;
  /** bot (yoksa çizilmez) */
  boot?: string;
  /** bot ağzı / kemer şeridi */
  trim?: string;
}

/** Gövde kabuğu + kollar + bacaklar + bot/eldiven: her kostümün tabanı (≥ 9 kutu). */
export function suit(box: BoxFn, c: SuitPalette, long = false) {
  box("body", [0, 9.9, 0], [8.9, 8.6, 5.9], c.body, { lod: 0 });
  if (long) box("body", [0, 5.0, 0], [9.1, 3.6, 6.1], c.body, { lod: 0 });
  if (c.trim) box("body", [0, 6.4, 0], [9.1, 0.8, 6.1], c.trim);
  for (const bone of ["armL", "armR"] as const) {
    box(bone, [0, -2.75, 0], [3, 5.6, 3], c.sleeve ?? c.body, { lod: 0 });
    if (c.glove) box(bone, [0, -6.2, 0], [2.8, 2.3, 2.8], c.glove, { lod: 0 });
  }
  for (const bone of ["legL", "legR"] as const) {
    if (c.leg) box(bone, [0, -2.4, 0], [3.3, 4.6, 3.3], c.leg, { lod: 0 });
    if (c.boot) {
      box(bone, [0, -4.6, 0.2], [3.7, 3, 3.9], c.boot, { lod: 0 });
      if (c.trim) box(bone, [0, -3.0, 0.2], [3.8, 0.6, 4], c.trim);
    }
  }
}

/** 5×5 özgün göğüs glifi ("X" = dolu). Bilinen kahraman sembolleri yok (harfli kalkan, yarasa, örümcek, yıldızlı kalkan,
 *  daire içinde şimşek); her paket kendi glifini burada tanımlar. */
export function glyph(box: BoxFn, rows: string[], c: string, glow = false, y = 11.2) {
  rows.forEach((row, r) => [...row].forEach((ch, col) => {
    if (ch === "X") box("body", [(col - 2) * 0.85, y + (2 - r) * 0.85, 3.02], [0.8, 0.8, 0.3], c, glow ? { glow: true } : {});
  }));
}

/** Arkada pelerin (gövde kemiği; yürürken gövdeyle döner). */
export function backCape(box: BoxFn, c: string, inner: string, long = true) {
  box("body", long ? [0, 7.6, -3.25] : [0, 10.6, -3.2], long ? [8.6, 12.4, 0.5] : [8.6, 6.6, 0.5], c, { r: [long ? 0.1 : 0.08, 0, 0], lod: 0 });
  box("body", long ? [0, 7.6, -2.92] : [0, 10.6, -2.9], long ? [8, 11.6, 0.2] : [8, 6, 0.2], inner, { r: [long ? 0.1 : 0.08, 0, 0] });
  box("body", [0, 14.1, -2.1], [9, 0.8, 1.8], c);
}

/** Yüze göz bandı (domino); burun köprüsü ile iki göz çevresi. */
export function eyeBand(box: BoxFn, c: string) {
  box("head", [0, 6.6, 5.12], [10.2, 1.2, 0.22], c, { lod: 0 });
  for (const x of [-2.2, 2.2]) box("head", [x, 5.7, 5.12], [2.8, 0.8, 0.22], c);
}

/** Masa üstünde küçük kaide (figürlerin ortak tabanı; y = 0 masa yüzeyi). */
export function plinth(b: SceneBox[], c: string, x = 0, w = 10, d = 6) {
  b.push({ p: [x, 0.5, 0], s: [w, 1, d], c });
}

/** Yuvarlak çizgide eşit aralıklı noktalar (kutlama halkaları). */
export function ring(n: number, r: number, phase = 0): [number, number][] {
  return Array.from({ length: n }, (_, i) => {
    const a = phase + (i / n) * Math.PI * 2;
    return [Math.cos(a) * r, Math.sin(a) * r];
  });
}
