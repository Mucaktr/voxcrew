/**
 * EXP-GEN (E1a) — çevre parsel ızgarası.
 *
 * - Parsel = bölge (bay) = 12 × 16 karo. Koordinat `(cx, cz)` **taban sahne** çerçevesinde bölge birimidir: parsel taban
 * karolarını I ∈ [12·cx, 12·cx + 12), J ∈ [16·cz, 16·cz + 16) kapsar. Taban (çekirdek) (0, 0)'dadır; halka düzeninde taban
 * dünyada ötelense de (`shiftBase`) çevre tabana bağlı kalır.
 * - Konum: taban çerçevesinde karo merkezi x = I − 11,5, z = J − 7,5 (`scenes.ts tx/tz` ile aynı). Büyümüş dünyada taban
 * (di, dj) karo ötelenmiştir: dünya konumu = taban konumu + (di, dj) (`ExpanseContext.origin`).
 * - Yerel karo (li, lj), dizin `lj · 12 + li`.
*/
import { D, W } from "../scenes";

export const PW = 12;
export const PD = 16;
export const PN = PW * PD;

/** taban karo merkezi → taban çerçevesinde dünya birimi (`tx`/`tz`) */
export const bx = (I: number) => I - W / 2 + 0.5;
export const bz = (J: number) => J - D / 2 + 0.5;

/** parsel anahtarı önbellekli (kare başına varlık başına çağrılır: canlı katman, fauna, taksi yükleme denetimi); dize aynı.*/
const PKEYS = new Map<number, string>();
export const pkey = (cx: number, cz: number): string => {
  if ((cx | 0) !== cx || (cz | 0) !== cz || cz > 32767 || cz < -32768) return `${cx},${cz}`;
  const n = cx * 65536 + cz;
  let k = PKEYS.get(n);
  if (k === undefined) { if (PKEYS.size > 65536) PKEYS.clear(); k = `${cx},${cz}`; PKEYS.set(n, k); }
  return k;
};
export const lidx = (li: number, lj: number) => lj * PW + li;

/** Yapılı dünya kutusu, taban karosu cinsinden (i1/j1 hariç). */
export interface TileBox { i0: number; j0: number; i1: number; j1: number }

export type Side = "back" | "front" | "left" | "right";
export const SIDES: readonly Side[] = ["back", "front", "left", "right"];
/** Kenarın dışa bakan parsel komşusu (dcx, dcz). */
export const SIDE_VEC: Record<Side, [number, number]> = { back: [0, -1], front: [0, 1], left: [-1, 0], right: [1, 0] };

/** Kutuyu tümüyle örten parsel aralığı (taşan kısmı da kapsar; c1/r1 hariç). */
export function boxParcels(b: TileBox) {
  return { c0: Math.floor(b.i0 / PW), r0: Math.floor(b.j0 / PD), c1: Math.ceil(b.i1 / PW), r1: Math.ceil(b.j1 / PD) };
}

/** Kutudan Chebyshev parsel uzaklığı: 0 = kutuyla kesişir, 1 = ilk halka. */
export function ringOf(b: TileBox, cx: number, cz: number): number {
  const p = boxParcels(b);
  const dx = Math.max(p.c0 - cx, 0, cx - (p.c1 - 1));
  const dz = Math.max(p.r0 - cz, 0, cz - (p.r1 - 1));
  return Math.max(dx, dz);
}

/** Parselin kutuya bitişik kenarı (kutunun kenarıyla ortak kenar; köşe parselinde yok). */
export function seamSide(b: TileBox, cx: number, cz: number): Side | null {
  const I0 = cx * PW, I1 = I0 + PW, J0 = cz * PD, J1 = J0 + PD;
  const overlapX = I0 < b.i1 && I1 > b.i0, overlapZ = J0 < b.j1 && J1 > b.j0;
  if (overlapX && J1 === b.j0) return "front"; // parsel kutunun arkasında → parselin ön kenarı kutuya bakar
  if (overlapX && J0 === b.j1) return "back";
  if (overlapZ && I1 === b.i0) return "right";
  if (overlapZ && I0 === b.i1) return "left";
  return null;
}

/** Parsel kutuyla kesişiyor mu (yapılı dünya kazanır: bastırılır). */
export function intersectsBox(b: TileBox, cx: number, cz: number): boolean {
  const I0 = cx * PW, J0 = cz * PD;
  return I0 < b.i1 && I0 + PW > b.i0 && J0 < b.j1 && J0 + PD > b.j0;
}

/** Kutu merkezi (taban çerçevesi, dünya birimi). */
export const boxCenter = (b: TileBox): [number, number] => [(bx(b.i0) + bx(b.i1 - 1)) / 2, (bz(b.j0) + bz(b.j1 - 1)) / 2];
/** Parsel merkezi (taban çerçevesi, dünya birimi). */
export const parcelCenter = (cx: number, cz: number): [number, number] => [bx(cx * PW) + (PW - 1) / 2, bz(cz * PD) + (PD - 1) / 2];
