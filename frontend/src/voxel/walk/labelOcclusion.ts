/**
 * UXF-D — yürüme modunda ajan ad etiketi (2B etiket tuvali, Crowd.tsx `drawLabels`) duvarın ardındaysa çizilmez.
 * Eskiden etiketler derinlik testi olmadan tuvale çiziliyordu: İstanbul'da binanın içindeki "Yazılımcı" adı duvarın üstünde
 * okunuyordu. Ucuz ışın: örtü ızgarası (`coverGrid`) üstünde kameradan ajanın başına 0,25 birimlik adımlar (`occlusion`,
 * tile başına iki dizi okuması); ek mesh, malzeme ya da çizim çağrısı yok.
 *
 * Kesit payı: takip kamerasıyla avatar arasındaki duvarlar sokak/oda kesitiyle zaten açılır (cover.ts `walkCutPlan`), görünmezler.
 * Bu yüzden ışın kameradan değil, avatar düzleminin hemen önünden (`START_K` × kamera–avatar uzaklığı) başlar; ajanın kendi
 * çevresi (`LABEL_PAD`; masa, tezgâh) engel sayılmaz. Avatar çatı altındayken (çatı kesiti açık) çatılar engel sayılmaz
 * (`roofs: false`). Açıkta (arada duvar yok) etiket hep okunur kalır.
*/
import { occlusion, type CoverGrid } from "./controller";

/** Işın, kamera–avatar uzaklığının bu oranından başlar (öncesi kesitle açılan bölge). */
export const START_K = 0.9;
/** Ajanın başına bu kadar (birim) yakın engel sayılmaz (kendi masası ve ekranı komşu karoda, tezgâh, kapı pervazı). */
export const LABEL_PAD = 1.3;

type P3 = { x: number; y: number; z: number };

const roofless = new WeakMap<CoverGrid, CoverGrid>();
function noRoof(c: CoverGrid): CoverGrid {
  let r = roofless.get(c);
  if (!r) { r = { ...c, roofY: new Float32Array(c.roofY.length).fill(Infinity), covered: 0 }; roofless.set(c, r); }
  return r;
}

/** Ajan (x, z; etiket çapası `headY`) kameradan bakınca bütünüyle duvarın / çatının ardında mı (üç ışın). `avatarDist`: kamera–avatar göğüs uzaklığı. */
export function labelOccluded(cover: CoverGrid, cam: P3, avatarDist: number, x: number, headY: number, z: number, roofs = true): boolean {
  const c = roofs ? cover : noRoof(cover);
  // baş genişliği: merkez ve iki yan (kameraya dik ± `SIDE`) — ince direğin ardında yarısı görünen ajan gizlenmez; üçü de kapalıysa gizli
  const hx = x - cam.x, hz = z - cam.z, hl = Math.hypot(hx, hz) || 1, lx = -hz / hl * SIDE, lz = hx / hl * SIDE;
  return rayBlocked(c, cam, avatarDist, x, headY, z) && rayBlocked(c, cam, avatarDist, x + lx, headY, z + lz) && rayBlocked(c, cam, avatarDist, x - lx, headY, z - lz);
}

/** Yan ışınların kaydırması: baş genişliği + bir karo payı — örtü ızgarası karo çözünürlüğünde; tek karoluk direk/sütun (gerçekte
 *  ince) ajanı bütünüyle örtmez, en az bir yan ışın açık kalır. Bina duvarı (≥ 2 karo) üçünü de keser. */
export const SIDE = 0.6;

function rayBlocked(cover: CoverGrid, cam: P3, avatarDist: number, x: number, headY: number, z: number): boolean {
  const dx = x - cam.x, dy = headY - cam.y, dz = z - cam.z, len = Math.hypot(dx, dy, dz);
  const start = Math.min(len, Math.max(0, avatarDist * START_K));
  const seg = len - start;
  if (seg <= LABEL_PAD) return false;
  const k = start / (len || 1);
  const free = occlusion(cover, [cam.x + dx * k, cam.y + dy * k, cam.z + dz * k], [x, headY, z]);
  return free * seg < seg - LABEL_PAD;
}
