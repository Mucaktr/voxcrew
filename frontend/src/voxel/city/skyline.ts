/**
 * SP-W0 — ufuk silüeti ( `skyline`): oynanabilir ızgaranın ARKASINDA (−z) yürünmez arka
 * plan. Simge yapılar burada durur (yol bulma ve blok bütçesi korunur, kamera ~38° açıyla onları arkada görür).
 * Bloklar `Built.backdrop`'a gider: kural olgularına (zemin/su/engel) girmez, ayrı tavanı vardır (≤ 1200,
 * SCENE-BACKDROP-001) ve çizimde mevcut solid grubuna katılır (+0 çizim çağrısı, örneklenmiş).
 *
 * Bütün silüetler özgün ve geneldir (3–5 ayırt edici özellik, şirin oran; simgeye gece ışığı yok).
 * Büyüyen dünya +x ve +z yönünde genişler; ufuk −z'de kaldığı için bölgelerle çakışmaz.
*/
import { rng, tx, tz, type Builder } from "../scenes";
import { dome, minaret, roof, type Layer } from "./kit";
import type { CityStyle } from "./style";

const L: Layer = "backdrop";
/** Dünya koordinatından karo dizini (taban ızgara; ızgara dışı için negatif/büyük olabilir). */
const tileI = (x: number) => Math.floor(x - tx(0) + 0.5);
const tileJ = (z: number) => Math.floor(z - tz(0) + 0.5);
const bx = (b: Builder, x: number, y: number, z: number, w: number, h: number, d: number, c: string) =>
  b.backdrop.push({ p: [x, y, z], s: [w, h, d], c, g: "solid", j: 0.03 });

/** Silüet türleri. `x` dünya x merkezi; `scale` 1 ≈ 6–10 birim yükseklik. */
export type Silhouette =
  | { kind: "towers"; x: number; w: number; n?: number }          // genel şehir blokları (düz/eğik çatılı)
  | { kind: "hill"; x: number; w: number; h?: number; color?: string } // yeşil tepe
  | { kind: "domes"; x: number; scale?: number; minarets?: 0 | 2 | 4 } // genel kubbeli silüet (dinî; yalnız uzakta)
  | { kind: "lattice"; x: number; scale?: number }               // genel demir kafes kule (gece ışıksız —)
  | { kind: "clock"; x: number; scale?: number }                 // genel saat kulesi (gotik, isimsiz)
  | { kind: "round"; x: number; scale?: number; color?: string } // yuvarlak taş kule + konik külah (genel ortaçağ)
  | { kind: "bridge"; x: number; w: number }                     // genel asma köprü silüeti
  | { kind: "pagoda"; x: number; scale?: number };               // kademeli çatılı kule (genel)

export interface SkylineOpts {
  /** silüet şeridinin z merkezi (varsayılan −20: tabanın 12 birim arkası) */
  z?: number;
  /** genel blokların x aralığı (varsayılan −34…34) */
  from?: number;
  to?: number;
  seed?: number;
  /** genel blok şeridi (yoksa yalnız verilen silüetler) */
  filler?: boolean;
  items?: Silhouette[];
}

/** Ufuk bandı: önce seyrek genel blok şeridi (iki sıra, yükseklik dalgalı), sonra simge silüetleri önde. Döner: eklenen
 *  backdrop blok sayısı. */
export function skylineBand(b: Builder, s: CityStyle, o: SkylineOpts = {}): number {
  const n0 = b.backdrop.length;
  const z = o.z ?? -20, r = rng(o.seed ?? 7);
  if (o.filler !== false) {
    const from = o.from ?? -34, to = o.to ?? 34;
    for (const row of [0, 1]) for (let x = from; x < to;) {
      const w = 1.6 + r() * 2.4, h = 2.2 + r() * 3.6 + row * 1.6 + Math.sin(x / 9) * 1.2;
      const c = s.far[Math.floor(r() * s.far.length)];
      bx(b, x + w / 2, h / 2, z - row * 3.2 - r() * 1.2, w, h, 2.2, c);
      if (r() < 0.35) bx(b, x + w / 2, h + 0.3, z - row * 3.2, w * 0.6, 0.6, 1.6, c);
      x += w + 0.25 + r() * 0.6;
    }
  }
  for (const it of o.items ?? []) silhouette(b, s, it, z + 2.2);
  return b.backdrop.length - n0;
}

/** Tek simge silüeti (ufukta, `z` önü). */
export function silhouette(b: Builder, s: CityStyle, it: Silhouette, z: number): void {
  switch (it.kind) {
    case "towers": {
      const n = it.n ?? Math.max(2, Math.round(it.w / 2.2));
      for (let k = 0; k < n; k++) {
        const w = it.w / n - 0.3, h = 3 + ((k * 7) % 5) * 0.9, x = it.x - it.w / 2 + (k + 0.5) * (it.w / n);
        bx(b, x, h / 2, z, w, h, 2, s.far[k % s.far.length]);
        if (k % 2) roof(b, "tile", x, h, z, w, 2, s.roofColor, L, 0.1);
      }
      return;
    }
    case "hill": {
      const h = it.h ?? 5, c = it.color ?? "#6E9F5B";
      for (let k = 0; k < 4; k++) bx(b, it.x, (k + 0.5) * (h / 4), z - 2, it.w * (1 - k * 0.22), h / 4, 6 - k, c);
      return;
    }
    case "domes": {
      const sc = it.scale ?? 1, w = 7 * sc, H = 2.8 * sc, c = "#C9C3B8";
      bx(b, it.x, H / 2, z, w, H, 4 * sc, c);
      dome(b, it.x, H, z, 2.4 * sc, "#8E9AA6", L);
      for (const sx of [-1, 1]) dome(b, it.x + sx * 2.6 * sc, H, z + 0.6, 1.1 * sc, "#8E9AA6", L);
      const n = it.minarets ?? 2;
      const xs = n === 4 ? [-1.25, -1, 1, 1.25] : n === 2 ? [-1, 1] : [];
      xs.forEach((f, k) => minaret(b, it.x + f * (w / 2 + 0.4), z + (k % 2 ? -1 : 1) * 0.6, 7.5 * sc, c, "#8E9AA6", L));
      return;
    }
    case "lattice": {
      // genel kafes kule: dört ayak → üç kademe daralan gövde + uçta ince anten (ışık yok; tepe ikazı scene'de lamp değil)
      const sc = it.scale ?? 1, c = "#7A6E62";
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) bx(b, it.x + sx * 1.6 * sc, 1.2 * sc, z + sz * 1.6 * sc, 0.7 * sc, 2.4 * sc, 0.7 * sc, c);
      bx(b, it.x, 2.6 * sc, z, 3.4 * sc, 0.35 * sc, 3.4 * sc, c);
      [[2.2, 4.2], [1.4, 7.0], [0.8, 9.8]].forEach(([w, y], k) => {
        bx(b, it.x, y * sc, z, w * sc, 2.4 * sc, w * sc, c);
        bx(b, it.x, (y + 1.3) * sc, z, (w + 0.4) * sc, 0.22 * sc, (w + 0.4) * sc, k === 2 ? "#6A5F55" : c);
      });
      bx(b, it.x, 12.2 * sc, z, 0.2 * sc, 2.2 * sc, 0.2 * sc, c);
      // SP-W1: simge ayak izi (karo; ızgara dışında) — <city>-NIGHT-001 bu alanın 3 karo çevresinde ışık gösterisi arar
      const r = 1.95 * sc, i0 = tileI(it.x - r), j0 = tileJ(z - r);
      b.zones.push({ kind: "landmark", tag: "lattice", i0, j0, w: tileI(it.x + r) - i0 + 1, d: tileJ(z + r) - j0 + 1 });
      return;
    }
    case "clock": {
      const sc = it.scale ?? 1, c = "#B9A37E";
      bx(b, it.x, 4 * sc, z, 2 * sc, 8 * sc, 2 * sc, c);
      bx(b, it.x, 8.6 * sc, z, 2.4 * sc, 1.4 * sc, 2.4 * sc, c);
      bx(b, it.x, 8.6 * sc, z + 1.21 * sc, 1.2 * sc, 1.2 * sc, 0.05, "#F4EFE6");
      [[2, 0], [1.4, 1], [0.8, 2], [0.3, 3]].forEach(([w, k]) => bx(b, it.x, (9.6 + k * 0.7) * sc, z, w * sc, 0.75 * sc, w * sc, "#55606B"));
      return;
    }
    case "round": {
      const sc = it.scale ?? 1, c = it.color ?? "#C8B89A";
      bx(b, it.x, 4 * sc, z, 2.4 * sc, 8 * sc, 2.4 * sc, c);
      bx(b, it.x, 4 * sc, z, 2.8 * sc, 8 * sc, 1.6 * sc, c);
      bx(b, it.x, 4 * sc, z, 1.6 * sc, 8 * sc, 2.8 * sc, c);
      bx(b, it.x, 8.3 * sc, z, 3.2 * sc, 0.5 * sc, 3.2 * sc, c);
      [[2.8, 0], [2.0, 1], [1.2, 2], [0.5, 3]].forEach(([w, k]) => bx(b, it.x, (8.9 + k * 0.75) * sc, z, w * sc, 0.8 * sc, w * sc, "#6C7A88"));
      return;
    }
    case "bridge": {
      const c = "#8A8F98", y = 2.4;
      bx(b, it.x, y, z + 1, it.w, 0.4, 1.2, c);
      for (const f of [-0.3, 0.3]) {
        bx(b, it.x + f * it.w, 3.6, z + 1, 0.6, 7.2, 0.8, c);
        for (let k = 1; k <= 4; k++) bx(b, it.x + f * it.w * (1 - k * 0.2), y + 3.6 * (1 - k * 0.22), z + 1, 0.2, 0.2, 0.2, c);
      }
      return;
    }
    case "pagoda": {
      const sc = it.scale ?? 1;
      for (let k = 0; k < 5; k++) {
        const w = (3 - k * 0.45) * sc, y = (1 + k * 1.5) * sc;
        bx(b, it.x, y, z, w * 0.7, 1.2 * sc, w * 0.7, "#B8644A");
        bx(b, it.x, y + 0.7 * sc, z, w, 0.25 * sc, w, "#3F4A55");
      }
      bx(b, it.x, 8.6 * sc, z, 0.15 * sc, 1.4 * sc, 0.15 * sc, "#C9A44C");
      return;
    }
  }
}

/** Izgaranın arka kenarına (j = 0 karosunun arkası) dünya koordinatı. */
export const backEdgeZ = () => tz(0) - 0.5;
/** Sol kenar. */
export const leftEdgeX = () => tx(0) - 0.5;
