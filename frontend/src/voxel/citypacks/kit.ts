/**
 * CITY-PACKS — şehir paketi öğelerinin kutu dili (saf modül: React/three yok; node betikleri de okur).
 *
 * Öğeler **ayak izi uzayında** yazılır: ayak izi `w × d` karo, x ∈ [0, w], z ∈ [0, d], y zeminden yukarı. Çıktı kutuları
 * çapa karosunun (ayak izinin sol-arka karosu) MERKEZİNE göredir ve dünya yapıcının `decor` prefab parçası biçimindedir
 * (`prefabs.ts Part`: [dx, y, dz, w, h, d, renk, grup]; y kutunun merkezi). Şehir haritası katmanı aynı kutuları dünya
 * koordinatına taşır (cityOverlay.ts). Yeni çizim yolu, doku ya da dış model yok; yalnız var olan grup malzemeleri.
 */
import type { Group } from "../scenes";

/** [dx, y, dz, w, h, d, renk, grup] — çapa karosu merkezine göre, y merkez. */
export type Box = [number, number, number, number, number, number, string, Group];

const r3 = (n: number) => Math.round(n * 1000) / 1000 || 0;

export class Kit {
  readonly out: Box[] = [];
  constructor(readonly w: number, readonly d: number) {}

  /** Alt-köşe biçimi: (x0, y0, z0) ayak izi uzayında kutunun en küçük köşesi. */
  b(x0: number, y0: number, z0: number, w: number, h: number, d: number, c: string, g: Group = "solid"): this {
    this.out.push([r3(x0 + w / 2 - 0.5), r3(y0 + h / 2), r3(z0 + d / 2 - 0.5), r3(w), r3(h), r3(d), c, g]);
    return this;
  }

  /** Merkez biçimi: (cx, cz) ayak izi uzayında kutunun yatay merkezi, y0 tabanı. */
  c(cx: number, y0: number, cz: number, w: number, h: number, d: number, c: string, g: Group = "solid"): this {
    return this.b(cx - w / 2, y0, cz - d / 2, w, h, d, c, g);
  }

  /** Sekizgen prizma (3 kutu): yuvarlak gövde, sütun, kule. */
  oct(cx: number, y0: number, cz: number, dia: number, h: number, c: string, g: Group = "solid"): this {
    this.c(cx, y0, cz, dia, h, dia * 0.42, c, g);
    this.c(cx, y0, cz, dia * 0.42, h, dia, c, g);
    return this.c(cx, y0, cz, dia * 0.8, h, dia * 0.8, c, g);
  }

  /** Kademeli kubbe (kademe başına sekizgen): r yarıçap, h yükseklik. */
  dome(cx: number, y0: number, cz: number, r: number, h: number, c: string, steps = 3, g: Group = "solid"): this {
    const hh = h / steps;
    for (let k = 0; k < steps; k++) {
      const t = (k + 0.35) / steps;
      this.oct(cx, y0 + k * hh, cz, 2 * r * Math.sqrt(1 - t * t), hh + 0.02, c, g);
    }
    return this;
  }

  /** x ekseni boyunca kemer sırası: `n` açıklık, ayak `pier` kalınlığında, kemer üstü kuşak. z0..z0+dd derinlik. */
  arcade(x0: number, x1: number, y0: number, z0: number, dd: number, n: number, pierW: number, h: number, c: string, top: string): this {
    const span = (x1 - x0 - pierW) / n;
    for (let k = 0; k <= n; k++) this.b(x0 + k * span, y0, z0, pierW, h, dd, c);
    for (let k = 0; k < n; k++) {
      const a = x0 + k * span + pierW, open = span - pierW;
      // kemer omzu: iki basamak (yuvarlak kemer izlenimi)
      this.b(a, y0 + h * 0.72, z0, open * 0.22, h * 0.28, dd, c);
      this.b(a + open * 0.78, y0 + h * 0.72, z0, open * 0.22, h * 0.28, dd, c);
      this.b(a + open * 0.22, y0 + h * 0.86, z0, open * 0.56, h * 0.14, dd, c);
    }
    return this.b(x0, y0 + h, z0, x1 - x0, h * 0.16, dd, top);
  }

  /** Mazgallı duvar tepesi (x ekseni). */
  crenel(x0: number, x1: number, y: number, z0: number, dd: number, c: string, step = 0.7): this {
    for (let x = x0; x + step * 0.5 <= x1 + 1e-6; x += step) this.b(x, y, z0, step * 0.5, 0.32, dd, c);
    return this;
  }

  done(): Box[] {
    return this.out;
  }
}

/** Kutu listesini ayak izinin merkezi etrafında çeyrek tur döndürür (`rot` 0…3, saat yönü, üstten). Dönen: kutular ve yeni ayak izi. */
export function rotateBoxes(boxes: readonly Box[], w: number, d: number, rot: number): { boxes: Box[]; w: number; d: number } {
  const q = ((rot % 4) + 4) % 4;
  if (!q) return { boxes: boxes.map((b) => [...b] as Box), w, d };
  // ayak izi uzayı merkezine taşı: (dx + 0.5, dz + 0.5) ∈ [0, w] × [0, d]
  const out: Box[] = [];
  for (const [dx, y, dz, bw, bh, bd, c, g] of boxes) {
    let x = dx + 0.5, z = dz + 0.5, sw = bw, sd = bd, W = w, D = d;
    for (let k = 0; k < q; k++) {
      // saat yönü 90°: (x, z) → (D − z, x); ayak izi W × D → D × W
      const nx = D - z, nz = x;
      x = nx; z = nz;
      [sw, sd] = [sd, sw];
      [W, D] = [D, W];
    }
    out.push([r3(x - 0.5), y, r3(z - 0.5), sw, bh, sd, c, g]);
  }
  return { boxes: out, w: q % 2 ? d : w, d: q % 2 ? w : d };
}

/** Ayak izi karoları (çapaya göre [di, dj]). */
export function footprintCells(w: number, d: number): [number, number][] {
  const out: [number, number][] = [];
  for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) out.push([i, j]);
  return out;
}
