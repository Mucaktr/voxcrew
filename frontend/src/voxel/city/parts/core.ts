/**
 * ortak simge parçalarının çekirdeği: kutu yazıcısı, döndürme, ölçek sabitleri.
 *
 * Bütün parçalar SAF fonksiyondur: bir `Sink`'e (citymap/design.ts; `Builder.box` ile aynı imza) kutu yazar, karo engellemez,
 * bölge/istasyon/ontoloji kaydı yapmaz (bunlar çağıranın planıdır: sahnede `blockRect`, kutsal yapıda kit `sacredZone`).
 * Böylece aynı parça hem sahnede (`builderSink(b)`; ızgara ya da ufuk katmanı) hem şehir haritası landmark modelinde
 * (`sink(out)`) çalışır. Yalnız durağan gruplar (`solid`, `glass`, `glow`, `water`): +0 çizim çağrısı.
 *
 * Ölçek TEK KAYNAKTAN gelir (`walk/scaleStandard.ts`): insan 1,0; kat 1,6–2,0; kapı 1,2–1,4 (en 0,5–0,7); pencere
 * 0,5–0,9 (denizlik 0,45–0,6); şehir mobilyası `furniture` ile bağlama göre (sahnede chibi 1,55, haritada gerçek ölçek);
 * kayık `boat` aralığı; simge yüksekliği `landmarkTop` → `landmarkTarget(realM, ctx)` (r = gerçek m / 1,75; tavan 24;
 * sahnede × 0,6). Parçalar bu sabitleri kendi uydurmaz; `city_parts.test.mjs` ölçer.
 *
 * Yön: parçalar cephesi +z'ye bakacak biçimde yazılır (kamera +z'den bakar); başka yön için `turn`.
 * Kimlik ve IP: hiçbir parçada yazı, logo, bayrak, arma ya da dinî simge yoktur; renkler çağırandan (`city/tokens.ts`).
*/
import type { Block, Builder } from "../../scenes";
import type { Sink } from "../../citymap/design";
import { landmarkTarget, LANDMARK_CURVE, PERSON_H, scaleClass, scaleRange, type Range, type ScaleContext, type ScaleDim } from "../../walk/scaleStandard";

export type { Sink } from "../../citymap/design";
export type { ScaleContext } from "../../walk/scaleStandard";

/** Durağan gruplar (parçalar yalnız bunları yazar). */
export type PartGroup = Extract<Block["g"], "solid" | "glass" | "glow" | "water">;

// ------------------------------------------------------------------------------------------ yazıcılar
/** Sahne `Builder`'ına yazan kutu fonksiyonu: `grid` sahne blokları, `backdrop` ufuk silüeti (Built.backdrop). */
export function builderSink(b: Builder, layer: "grid" | "backdrop" = "grid"): Sink {
  if (layer === "grid") return (x, y, z, w, h, d, c, g = "solid", j = 0.03) => b.box(x, y, z, w, h, d, c, g, j);
  return (x, y, z, w, h, d, c, g = "solid", j = 0.03) => { b.backdrop.push({ p: [x, y, z], s: [w, h, d], c, g, j }); };
}

/** Sahne: (i0, j0) sol-arka karodan w × d karoyu engeller (parçalar engellemez; çağıran yürünmezliği burada seçer). */
export function blockRect(b: Builder, i0: number, j0: number, w: number, d: number): void {
  for (let i = i0; i < i0 + w; i++) for (let j = j0; j < j0 + d; j++) b.block(i, j);
}

/** Çeyrek dönüş: (cx, cz) çevresinde `q` × 90° (saat yönünün tersi, yukarıdan). Parça +z cepheli yazılır; q = 1 → +x'e bakar. */
export function turn(b: Sink, cx: number, cz: number, q: 0 | 1 | 2 | 3): Sink {
  if (q === 0) return b;
  return (x, y, z, w, h, d, c, g, j) => {
    const dx = x - cx, dz = z - cz;
    if (q === 2) return b(cx - dx, y, cz - dz, w, h, d, c, g, j);
    const s = q === 1 ? 1 : -1;
    return b(cx + s * dz, y, cz - s * dx, d, h, w, c, g, j);
  };
}

/** y ötelemeli yazıcı (sahanlık, iskele, köprü güvertesi üstüne parça). */
export const lift = (b: Sink, dy: number): Sink => (x, y, z, w, h, d, c, g, j) => b(x, y + dy, z, w, h, d, c, g, j);

// ------------------------------------------------------------------------------------------ ölçek (scaleStandard)
const dimOf = (id: string, dim: ScaleDim): Range => {
  const r = scaleClass(id)?.dims[dim];
  if (!r) throw new Error(`scaleStandard: ${id}.${dim} yok`);
  return r;
};
const mid = (r: Range) => (r[0] + r[1]) / 2;
/** Aralığa sıkıştır (aralık × insan). */
export const clampTo = (v: number, r: Range) => Math.min(r[1], Math.max(r[0], v));

/** Yapı ölçüleri (iki bağlamda da gerçek ölçek; × yürüme insanı 1,0). */
export const STD = {
  person: PERSON_H,
  storeyRange: dimOf("storey", "height"),
  /** varsayılan kat ("Gerçekte 1,7") */
  storey: 1.7,
  /** zemin kat üst sınırı (scaleStandard notu: "Zemin kat ≤ 2,2") */
  groundMax: 2.2,
  doorRange: dimOf("door", "height"),
  door: mid(dimOf("door", "height")),
  doorWidth: mid(dimOf("door", "width")),
  windowRange: dimOf("window", "height"),
  window: mid(dimOf("window", "height")),
  sill: mid(dimOf("window", "sill")),
  lampTop: mid(dimOf("street_lamp", "top")),
  boatTop: dimOf("boat", "top"),
  boatLength: dimOf("boat", "length"),
  /** korkuluk / parapet üstü: bel hizası (bank sırtı bandıyla aynı, × insan) */
  rail: mid(dimOf("bench", "back")),
} as const;

/** Kat yüksekliği: verilen değer kat aralığına sıkıştırılır (yoksa 1,7). */
export const storeyH = (v?: number) => clampTo(v ?? STD.storey, STD.storeyRange);

/** Mobilya ölçüsü (dünya birimi): sınıf/boyut aralığının ortası × bağlamın insanı (sahnede chibi 1,55, haritada 1,0). */
export function furniture(id: string, dim: ScaleDim, ctx: ScaleContext): number {
  const r = scaleRange(id, dim, ctx);
  if (!r) throw new Error(`scaleStandard: ${id}.${dim} yok`);
  return ((r.min + r.max) / 2) * r.person;
}

/** Simge yüksekliği: gerçek yükseklik (m) ya da hazır tepe. Parça, tepesini (en yüksek kutunun üstü) TAM bu değere oturtur. */
export type Height = { realM: number; ctx?: ScaleContext } | { top: number };
/** `Height` → dünya birimi tepe (realM: `landmarkTarget(realM, ctx)`, tavan 24). */
export function landmarkTop(h: Height): number {
  const t = "top" in h ? h.top : landmarkTarget(h.realM, h.ctx ?? "city");
  if (!(t > 0)) throw new Error("simge yüksekliği > 0 olmalı");
  return Math.min(t, LANDMARK_CURVE.cap);
}

/** Dizi rengini döngüyle seç. */
export const cyc = <T>(list: readonly T[], k: number): T => list[((k % list.length) + list.length) % list.length];
/** Tam sayı parametreyi [lo, hi] aralığına sıkıştır (kutu bütçesi). */
export const nClamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));

/** Parça başına kutu bütçesi (plan §4.3). */
export const PART_BOX_BUDGET = 120;
