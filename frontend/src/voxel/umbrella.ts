/**
 * CEOGOZU — şemsiye geometrisi (ürün sahibi: "yağmurda şemsiyeler karakterlerin kafasının içinden geçiyor"). Tek kaynak: hem şehir figüranları
 * (`citylife/FiguransLayer`) hem ajan eğlencesi (`fun/brain updateUmbrella`) buradan çizer; `scripts/ceo_eye.mjs` aynı fonksiyonlarla
 * her avatar varyantında kubbe/sap ↔ baş/şapka/kulak kesişimini sayar. Birim: voxel, gövde (`body`) çerçevesi, ön = +z.
 *
 * Kural: sap başın SAĞINDA dikey (x = UMB_GRIP[0] = 11,4 > en geniş şapka kenarı 8,5 + baş dönüşü payı), el sapı tutacak şekilde kol açısı sabit
 * (`UMB_ARM`); kubbe başın EN ÜST noktasının (şapka/kulak dahil) `UMB_CLEAR` voxel üstünde, sap kubbe altında biter.
*/
import { normalizeAvatar } from "./avatar";
import { characterParts, type Pose } from "./parts";
import type { Avatar } from "../lib/types";

/** Elin sapı tuttuğu nokta (gövde çerçevesi; omuz [5,25; 13,5; 0] → mesafe 7 = kol uzunluğu). */
export const UMB_GRIP = [11.4, 10.5, 1.5] as const;
/** Bu tutuşu veren sağ kol açıları (Euler XYZ: önce z sonra x). */
export const UMB_ARM: Pick<Pose, "ra" | "raz"> = { ra: -0.468, raz: 1.064 };
/** Kubbe altı ile başın en üstü arası boşluk (voxel). */
export const UMB_CLEAR = 2.2;
/** Kubbe: kenar ve kalınlık, merkezin gövde çerçevesindeki x/z'si (sap kubbe izinde kalsın diye hafif sağa/öne). */
export const UMB_DOME = { w: 18, h: 1.6, cx: 3.5, cz: 1.5 } as const;
/** Sapın altı: elin (UMB_GRIP y 10,5) ~1,3 voxel altı — eskiden 7,5 idi, sap diz hizasına (yere doğru) uzuyordu.*/
export const UMB_HANDLE_Y0 = 9.2;

interface HB { bone: string; p: readonly number[]; s: readonly number[]; r?: readonly number[]; kind: string; carry?: boolean; device?: unknown; o?: number }
/** Baş kemiğindeki kutuların (şapka, kulak, saç, taç…) en üst noktası (voxel, gövde çerçevesi; baş pivotu y = 14). Dönük kutu: yarı köşegen. */
export function headTopOfParts(parts: Iterable<unknown>): number {
  let top = 24;
  for (const q of parts) {
    const p = q as HB;
    if (p.kind !== "box" || p.bone !== "head" || p.carry || p.device || (p.o !== undefined && p.o < 0.5)) continue;
    const half = p.r ? Math.hypot(p.s[0], p.s[1], p.s[2]) / 2 : p.s[1] / 2;
    top = Math.max(top, 14 + p.p[1] + half);
  }
  return top;
}
const topCache = new Map<string, number>();
/** Bir avatarın baş üstü (önbellekli). */
/** avatar nesnesi başına sonuç (şemsiyeli ajan başına her kare normalizeAvatar + JSON.stringify çalışıyordu). Avatar
 * nesneleri değişmez (depo yeni nesne yazar); aynı nesne → aynı normalleştirme → aynı sonuç.*/
const byObj = new WeakMap<object, number>();
export function headTopOf(avatar: Partial<Avatar> | null | undefined): number {
  if (avatar && typeof avatar === "object") {
    const hit = byObj.get(avatar);
    if (hit !== undefined) return hit;
    const t = headTopOfKey(avatar);
    byObj.set(avatar, t);
    return t;
  }
  return headTopOfKey(avatar);
}
function headTopOfKey(avatar: Partial<Avatar> | null | undefined): number {
  const a = normalizeAvatar(avatar);
  const key = JSON.stringify(a);
  let t = topCache.get(key);
  if (t === undefined) {
    t = headTopOfParts(characterParts(a));
    if (topCache.size > 300) topCache.clear();
    topCache.set(key, t);
  }
  return t;
}
/** Kubbe merkez yüksekliği (voxel). */
export const domeY = (top: number) => top + UMB_CLEAR + UMB_DOME.h / 2;

export interface UBox { p: [number, number, number]; s: [number, number, number]; k: "handle" | "dome" | "crown" }
/** Şemsiye kutuları (gövde çerçevesi): sap, kubbe, tepe düğmesi. */
export function umbrellaBoxes(top: number): UBox[] {
  const dy = domeY(top), y1 = dy + 1.6;
  const [gx, , gz] = UMB_GRIP;
  return [
    { k: "handle", p: [gx, (UMB_HANDLE_Y0 + y1) / 2, gz], s: [0.6, y1 - UMB_HANDLE_Y0, 0.6] },
    { k: "dome", p: [UMB_DOME.cx, dy, UMB_DOME.cz], s: [UMB_DOME.w, UMB_DOME.h, UMB_DOME.w] },
    { k: "crown", p: [UMB_DOME.cx, dy + UMB_DOME.h / 2 + 0.6, UMB_DOME.cz], s: [9, 1.2, 9] },
  ];
}
