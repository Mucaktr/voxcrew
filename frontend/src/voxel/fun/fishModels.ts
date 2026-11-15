/**
 * WORLD-FIX — tür başına voxel balık modelleri (saf veri; three yok → node testinde de yüklenir).
 *
 * Yerel eksen: +z ileri (baş), +y yukarı, +x sağ; boy ≈ 1 (burun → kuyruk ucu), merkez gövde ortası. Her model 6–15 kutu:
 * baş/gövde/kuyruk sapı (siluet: ince hamsi, derin çupra, torpido orkinos, uzun turna ve yılan balığı, yassı kalkan), açık renk
 * karın, sırt yüzgeci, kuyruk (çatal / yelpaze / yuvarlak / orak), iki göğüs yüzgeci, iki göz, türün deseni (şerit, benek,
 * bant, bıyık) ve EN ÇOK bir pul parıltısı (`glint`, parıltı yuvası; ortam balıklarında kullanılmaz — çizim çağrısı eklemez).
 *
 * Kullananlar: ortam balıkları (`ambient/kinds.ts` → rol: ön gövde "head", kuyruk sapı + kuyruk "tail", göğüs yüzgeçleri
 * "wingL/wingR" → yüzme kıvrımı) ve olta (`fun/walkFun.ts drawMinigame`: çekiş, sudan fırlama, çırpınma, kutlama).
 */

export type FishPart = "front" | "body" | "rear" | "belly" | "tail" | "finD" | "finL" | "finR" | "finA" | "eye" | "mark" | "glint";
export interface FishBox {
  p: [number, number, number];
  s: [number, number, number];
  c: string;
  part: FishPart;
  /** yerel dönüş (x, y, z; rad, "YXZ") */
  r?: [number, number, number];
  glint?: boolean;
}

type Tail = "fork" | "deep" | "fan" | "round" | "square" | "point";
interface Plan {
  /** yükseklik ve en (boya oranı) */
  h: number; w: number;
  back: string; side: string; belly: string; fin: string; eye?: string;
  tail: Tail;
  /** baş bölümü yüksekliği (gövdeye oranı) ve burun uzaması */
  head?: number; snout?: number;
  /** sırt yüzgeci yüksekliği (gövdeye oranı), boyu ve yeri (z) */
  dorsal?: [number, number, number];
  marks?: FishBox[];
  /** pul parıltısı yok (mat türler) */
  matte?: boolean;
}

function build(pl: Plan): FishBox[] {
  const H = pl.h, W = pl.w;
  const head = pl.head ?? 0.82, snout = pl.snout ?? 0;
  const out: FishBox[] = [
    { part: "front", p: [0, 0.03 * H, 0.27 + snout / 2], s: [W * 0.86, H * head, 0.28 + snout], c: pl.side },
    { part: "body", p: [0, 0, -0.02], s: [W, H, 0.32], c: pl.side },
    { part: "rear", p: [0, 0.02 * H, -0.27], s: [W * 0.58, H * 0.52, 0.2], c: pl.side },
    // sırt rengi gövdenin üst yarısında (biraz geniş: yan yüzde z çakışması yok)
    { part: "body", p: [0, H * 0.3, 0.04], s: [W * 1.03, H * 0.42, 0.58], c: pl.back },
    { part: "belly", p: [0, -H * 0.3, 0.02], s: [W * 1.02, H * 0.38, 0.5], c: pl.belly },
  ];
  const [dh, dl, dz] = pl.dorsal ?? [0.32, 0.28, -0.02];
  out.push({ part: "finD", p: [0, H * 0.5 + H * dh * 0.45, dz], s: [0.035, H * dh, dl], c: pl.fin, r: [-0.18, 0, 0] });
  const tz = -0.5 + 0.09;
  switch (pl.tail) {
    case "fork": case "deep": {
      const a = pl.tail === "deep" ? 0.75 : 0.55, len = pl.tail === "deep" ? 0.24 : 0.19;
      out.push({ part: "tail", p: [0, H * 0.2, tz], s: [0.035, H * 0.16, len], c: pl.fin, r: [a, 0, 0] });
      out.push({ part: "tail", p: [0, -H * 0.2, tz], s: [0.035, H * 0.16, len], c: pl.fin, r: [-a, 0, 0] });
      break;
    }
    case "fan": out.push({ part: "tail", p: [0, 0, tz - 0.02], s: [0.03, H * 1.25, 0.24], c: pl.fin }); break;
    case "round": out.push({ part: "tail", p: [0, 0, tz], s: [0.035, H * 0.85, 0.17], c: pl.fin }); break;
    case "square": out.push({ part: "tail", p: [0, 0, tz], s: [0.035, H * 1.0, 0.14], c: pl.fin }); break;
    case "point": out.push({ part: "tail", p: [0, 0, tz + 0.02], s: [0.03, H * 0.6, 0.16], c: pl.fin }); break;
  }
  const fx = W * 0.5 + 0.05;
  out.push({ part: "finL", p: [fx, -H * 0.18, 0.14], s: [0.12, 0.018, 0.1], c: pl.fin, r: [0, 0.35, -0.35] });
  out.push({ part: "finR", p: [-fx, -H * 0.18, 0.14], s: [0.12, 0.018, 0.1], c: pl.fin, r: [0, -0.35, 0.35] });
  const ex = W * 0.43 + 0.008, ey = H * 0.14 * head, ez = 0.31 + snout * 0.4, es = Math.max(0.05, Math.min(0.1, H * 0.26));
  out.push({ part: "eye", p: [ex, ey, ez], s: [0.02, es, es], c: pl.eye ?? "#12161C" });
  out.push({ part: "eye", p: [-ex, ey, ez], s: [0.02, es, es], c: pl.eye ?? "#12161C" });
  for (const m of pl.marks ?? []) out.push(m);
  if (!pl.matte) out.push({ part: "glint", p: [W * 0.52 + 0.004, H * 0.12, -0.04], s: [0.01, Math.max(0.03, H * 0.12), 0.14], c: "#F8FAFC", glint: true });
  return out;
}

const side = (c: string, p: [number, number, number], s: [number, number, number]): FishBox => ({ part: "mark", p, s, c });

function boot(): FishBox[] {
  // eski çizme: konç, ayak, taban, topuk, bağcıklar, yosun
  return [
    { part: "body", p: [0, 0.18, -0.18], s: [0.34, 0.6, 0.34], c: "#6B4A2B" },
    { part: "front", p: [0, -0.04, 0.12], s: [0.32, 0.22, 0.56], c: "#6B4A2B" },
    { part: "belly", p: [0, -0.17, 0.08], s: [0.36, 0.06, 0.7], c: "#2E2620" },
    { part: "rear", p: [0, -0.12, -0.26], s: [0.3, 0.14, 0.2], c: "#2E2620" },
    { part: "mark", p: [0, 0.5, -0.18], s: [0.37, 0.05, 0.37], c: "#4A3320" },
    { part: "mark", p: [0.172, 0.14, -0.05], s: [0.01, 0.3, 0.08], c: "#D9C7A0" },
    { part: "tail", p: [0.12, 0.52, -0.3], s: [0.05, 0.18, 0.05], c: "#3F7D3A", r: [0.4, 0, 0.3] },
  ];
}

const PLANS: Record<string, () => FishBox[]> = {
  hamsi: () => build({ h: 0.17, w: 0.12, back: "#2E5E7E", side: "#C9D3DA", belly: "#EEF2F5", fin: "#9FB3C0", tail: "fork",
    marks: [side("#E9F1F6", [0.066, 0.0, 0.0], [0.006, 0.03, 0.62])] }),
  istavrit: () => build({ h: 0.2, w: 0.13, back: "#4B7A8C", side: "#B9C7CF", belly: "#EAF0F2", fin: "#D8C46A", tail: "fork",
    marks: [side("#3A4A55", [0.072, 0.02, -0.12], [0.006, 0.035, 0.42])] }),
  cupra: () => build({ h: 0.44, w: 0.14, back: "#6E7F8C", side: "#AEB9C1", belly: "#E5E9EC", fin: "#8C98A3", tail: "fork", head: 0.86,
    marks: [side("#E3B341", [0, 0.17, 0.36], [0.13, 0.04, 0.05]), side("#3C3F46", [0.075, 0.08, 0.2], [0.006, 0.07, 0.04])] }),
  sazan: () => build({ h: 0.34, w: 0.18, back: "#6B4E26", side: "#A8783A", belly: "#E4C88E", fin: "#8A5A2B", tail: "fork", dorsal: [0.36, 0.4, -0.04],
    marks: [side("#5A3E1C", [0, -0.06, 0.43], [0.02, 0.02, 0.08]), side("#C9974F", [0.093, 0.04, -0.02], [0.006, 0.12, 0.2])] }),
  levrek: () => build({ h: 0.26, w: 0.15, back: "#5B6B78", side: "#C5CDD3", belly: "#F1F4F6", fin: "#7D8A95", tail: "square", dorsal: [0.5, 0.18, 0.08],
    marks: [{ part: "finD", p: [0, 0.2, -0.12], s: [0.03, 0.08, 0.16], c: "#7D8A95" }, side("#3E4750", [0.068, 0.07, 0.2], [0.006, 0.06, 0.04])] }),
  alabalik: () => build({ h: 0.25, w: 0.15, back: "#5E7A4A", side: "#C9B48E", belly: "#F0E6D2", fin: "#9C8A62", tail: "round",
    marks: [side("#E58A9A", [0.078, 0.0, -0.02], [0.006, 0.05, 0.6]), side("#2F3A26", [0.078, 0.08, -0.12], [0.006, 0.03, 0.03])] }),
  palamut: () => build({ h: 0.25, w: 0.18, back: "#24466E", side: "#C8D2DC", belly: "#F2F5F8", fin: "#2C4A6E", tail: "deep",
    marks: [side("#1A3352", [0.094, 0.06, 0.05], [0.006, 0.025, 0.4]), side("#1A3352", [0.094, 0.02, -0.12], [0.006, 0.025, 0.3])] }),
  lufer: () => build({ h: 0.27, w: 0.16, back: "#3F6D8A", side: "#B8C8D2", belly: "#EEF3F6", fin: "#6E8C9F", tail: "fork", snout: 0.04,
    marks: [side("#1D262E", [0.09, -0.04, 0.17], [0.012, 0.035, 0.03]), { part: "mark", p: [0, -0.1, 0.43], s: [0.12, 0.04, 0.08], c: "#9DB1BE" }] }),
  japon: () => build({ h: 0.38, w: 0.2, back: "#E2711D", side: "#F28C28", belly: "#F7B267", fin: "#F6A04D", tail: "fan", head: 0.9 }),
  cizme: boot,
  palyaco: () => build({ h: 0.34, w: 0.15, back: "#E8601A", side: "#F26B1D", belly: "#F58A3A", fin: "#F26B1D", tail: "round", matte: true,
    marks: [side("#F8F8F8", [0, 0.0, 0.24], [0.16, 0.36, 0.06]), side("#F8F8F8", [0, 0.0, -0.06], [0.16, 0.38, 0.06]),
      side("#1E1E1E", [0, 0, -0.42], [0.04, 0.3, 0.03])] }),
  morina: () => build({ h: 0.28, w: 0.17, back: "#6F6240", side: "#8A7A52", belly: "#E6DDC2", fin: "#6F6240", tail: "square", dorsal: [0.22, 0.5, 0.0], matte: true,
    marks: [side("#D8D0B0", [0.088, 0.04, -0.04], [0.006, 0.02, 0.62]), { part: "mark", p: [0, -0.14, 0.42], s: [0.015, 0.07, 0.015], c: "#C9B98A" }] }),
  cerrah: () => build({ h: 0.44, w: 0.12, back: "#1F5FC8", side: "#2E6FD8", belly: "#3D7FE6", fin: "#1D3F8A", tail: "square", head: 0.9,
    marks: [side("#14161C", [0.066, 0.1, 0.0], [0.008, 0.08, 0.36]), { part: "tail", p: [0, 0, -0.39], s: [0.04, 0.2, 0.06], c: "#F2C230" }] }),
  somon: () => build({ h: 0.27, w: 0.16, back: "#4A5E6E", side: "#D9B8B0", belly: "#F3E9E6", fin: "#7E8E99", tail: "fork", snout: 0.03,
    marks: [side("#22282E", [0.083, 0.11, 0.08], [0.006, 0.025, 0.025]), side("#22282E", [0.083, 0.1, -0.1], [0.006, 0.025, 0.025])] }),
  turna: () => build({ h: 0.18, w: 0.14, back: "#3F5A28", side: "#4E6B33", belly: "#E4E0B8", fin: "#5E7A3A", tail: "fork", head: 0.7, snout: 0.16, dorsal: [0.45, 0.14, -0.2],
    marks: [side("#C8C27A", [0.073, 0.03, 0.02], [0.006, 0.03, 0.05]), side("#C8C27A", [0.073, -0.02, -0.16], [0.006, 0.03, 0.05])] }),
  papagan: () => build({ h: 0.36, w: 0.17, back: "#1C9C8A", side: "#22B5A0", belly: "#7FD9C8", fin: "#F07AA0", tail: "round", head: 0.86,
    marks: [{ part: "mark", p: [0, -0.02, 0.43], s: [0.12, 0.1, 0.05], c: "#E8E2D0" }, side("#F07AA0", [0.088, -0.04, 0.24], [0.006, 0.05, 0.12])] }),
  yilan_baligi: () => build({ h: 0.1, w: 0.1, back: "#3A3524", side: "#4A4430", belly: "#B3A36A", fin: "#5A5238", tail: "point", head: 0.95, snout: 0.22,
    dorsal: [0.4, 0.62, -0.12], matte: true }),
  koi: () => build({ h: 0.3, w: 0.17, back: "#F4F1EA", side: "#F4F1EA", belly: "#FBF8F2", fin: "#F6EEE0", tail: "fan",
    marks: [side("#E5482B", [0, 0.12, 0.2], [0.18, 0.13, 0.18]), side("#E5482B", [0, 0.1, -0.16], [0.18, 0.12, 0.14]),
      { part: "mark", p: [0, -0.06, 0.43], s: [0.12, 0.015, 0.06], c: "#D8C8A8" }] }),
  kalkan: () => {
    // yassı balık: yatay disk, iki göz üstte, kenar yüzgeci, yelpaze kuyruk
    return [
      { part: "body", p: [0, 0, 0.0], s: [0.62, 0.08, 0.6], c: "#7A6A52" },
      { part: "front", p: [0, 0, 0.3], s: [0.4, 0.075, 0.16], c: "#7A6A52" },
      { part: "rear", p: [0, 0, -0.31], s: [0.3, 0.07, 0.12], c: "#7A6A52" },
      { part: "belly", p: [0, -0.042, 0], s: [0.6, 0.01, 0.58], c: "#EDE6D6" },
      { part: "finD", p: [0.34, 0, 0.0], s: [0.07, 0.02, 0.62], c: "#5E503C" },
      { part: "finA", p: [-0.34, 0, 0.0], s: [0.07, 0.02, 0.62], c: "#5E503C" },
      { part: "tail", p: [0, 0, -0.43], s: [0.32, 0.025, 0.14], c: "#5E503C" },
      { part: "finL", p: [0.24, 0.01, 0.2], s: [0.1, 0.015, 0.08], c: "#5E503C", r: [0, 0.4, 0] },
      { part: "finR", p: [-0.24, 0.01, 0.2], s: [0.1, 0.015, 0.08], c: "#5E503C", r: [0, -0.4, 0] },
      { part: "eye", p: [0.06, 0.05, 0.32], s: [0.05, 0.04, 0.05], c: "#12161C" },
      { part: "eye", p: [-0.03, 0.05, 0.36], s: [0.05, 0.04, 0.05], c: "#12161C" },
      { part: "mark", p: [0.12, 0.043, -0.08], s: [0.06, 0.012, 0.06], c: "#4E4232" },
      { part: "mark", p: [-0.14, 0.043, 0.06], s: [0.06, 0.012, 0.06], c: "#4E4232" },
    ];
  },
  orkinos: () => build({ h: 0.32, w: 0.24, back: "#1F2F5A", side: "#B5BFCC", belly: "#EEF1F5", fin: "#2A3A66", tail: "deep", head: 0.9, dorsal: [0.42, 0.16, 0.06],
    marks: [{ part: "finD", p: [0, 0.2, -0.16], s: [0.03, 0.08, 0.12], c: "#E0C050" }, side("#F2C230", [0, -0.12, -0.3], [0.05, 0.03, 0.14])] }),
  yayin: () => build({ h: 0.24, w: 0.24, back: "#2E2B25", side: "#3D3A33", belly: "#9C9483", fin: "#2E2B25", tail: "round", head: 0.8, snout: 0.06, dorsal: [0.18, 0.08, 0.1], matte: true,
    marks: [{ part: "mark", p: [0.12, -0.02, 0.56], s: [0.012, 0.012, 0.3], c: "#2A2722", r: [0, 0.35, 0] },
      { part: "mark", p: [-0.12, -0.02, 0.56], s: [0.012, 0.012, 0.3], c: "#2A2722", r: [0, -0.35, 0] }] }),
};

export const FISH_MODEL_IDS: readonly string[] = Object.keys(PLANS);
const cache = new Map<string, readonly FishBox[]>();
/** Türün kutu listesi (önbellekli; bilinmeyen tür → hamsi). */
export function fishModel(id: string): readonly FishBox[] {
  let m = cache.get(id);
  if (!m) { m = Object.freeze((PLANS[id] ?? PLANS.hamsi)()); cache.set(id, m); }
  return m;
}

/** Yakalanınca dünyadaki boy (birim; insan ≈ 1): küçük hamsiden iri orkinosa. */
export const FISH_SIZE: Readonly<Record<string, number>> = {
  hamsi: 0.24, istavrit: 0.28, cupra: 0.32, sazan: 0.44, levrek: 0.4, alabalik: 0.36, palamut: 0.48, lufer: 0.48, japon: 0.2,
  cizme: 0.34, palyaco: 0.2, morina: 0.48, cerrah: 0.26, somon: 0.52, turna: 0.6, papagan: 0.4, yilan_baligi: 0.62, koi: 0.42,
  kalkan: 0.44, orkinos: 0.85, yayin: 0.85,
};

/** Su altı gölgesi rengi: tür renginin derin suya karışmış hâli (ortam balıkları; desen yerine siluet). */
export function shadowTint(hex: string, deep = "#14324A", k = 0.62): string {
  const a = parseInt(hex.slice(1), 16), b = parseInt(deep.slice(1), 16);
  const mix = (sh: number) => Math.round(((a >> sh) & 255) * (1 - k) + ((b >> sh) & 255) * k);
  return `#${((mix(16) << 16) | (mix(8) << 8) | mix(0)).toString(16).padStart(6, "0")}`;
}
