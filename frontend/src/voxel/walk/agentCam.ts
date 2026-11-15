/**
 * (Londra taban sahne, oturan ajan): takip kamerası başka bir KİŞİNİN (ajan, figüran) bedeninin içine girmez. Statik blok kaynağı
 * (`camera/world.ts`) kişileri bilmez: avatarın yanındaki ajanın öbür tarafına kurulan kamera ajanın kafasına/saçına yapışıyor, kadrajın
 * yarısı ajan yüzü oluyordu. Çözüm: kamera, pivot → kamera kolunun kişi silindirine (yarıçap `AGENT_CAM_R`, ayaktan `AGENT_CAM_H` yüksekliğe)
 * girdiği noktanın `AGENT_CAM_PAD` önüne çekilir (kol kısalır; avatar kişinin silindirinde değilse). Saf (three yok); WalkRig çağırır.
*/
export interface Pt { x: number; y: number; z: number }
/** Kişi silindiri: yarıçap (baş/omuz + kamera payı), boy (ayaktan; yürüme insanı ~1,0–1,4) ve kameranın önünde bırakılan pay. */
export const AGENT_CAM_R = 0.34;
export const AGENT_CAM_H = 1.5;
export const AGENT_CAM_PAD = 0.1;

/**
 * Kamerayı (`cam`, yerinde) kişilerden uzak tutar: `people`: her kişinin ayak konumu (x, y, z). Dönüş: kamera kısaltıldı mı.
 * Pivot kişinin silindirinin içindeyse (avatar ajanın tam yanında/içinde) o kişi atlanır — kolu 0'a indirmek avatarı gizler.
 */
/** şehir figüranı için kamera yarıçapı (beden 0,34 + yakın düzlem/baş payı): yandan geçen kamera kişinin başına/yüzüne girmez. `skipR` (varsayılan r): pivot bu kadar yakın kişi atlanır.*/
export const CROWD_CAM_R = 0.5, CROWD_BODY_R = 0.34;
export function clearOfPeople(cam: Pt, pivot: Pt, people: Iterable<Pt>, r = AGENT_CAM_R, h = AGENT_CAM_H, pad = AGENT_CAM_PAD, skipR = r): boolean {
  const dx = cam.x - pivot.x, dy = cam.y - pivot.y, dz = cam.z - pivot.z, len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return false;
  let best = len, moved = false;
  for (const p of people) {
    // pivot bu kişiye içte: atla
    // pivot silindirin içindeyse (skipR..r bandı dahil) kol 0'a inip göz yedeğine sıçrıyordu → atla
    if (Math.hypot(pivot.x - p.x, pivot.z - p.z) < Math.max(skipR, r)) continue;
    // ışının yatay düzlemde daireyle kesişimi (parametre 0..len)
    const ux = dx / len, uz = dz / len, fx = pivot.x - p.x, fz = pivot.z - p.z;
    const a = ux * ux + uz * uz, b = 2 * (fx * ux + fz * uz), c = fx * fx + fz * fz - r * r;
    if (a < 1e-9) continue;
    const disc = b * b - 4 * a * c;
    if (disc < 0) continue;
    const sq = Math.sqrt(disc), t0 = (-b - sq) / (2 * a), t1 = (-b + sq) / (2 * a);
    if (t1 < 0 || t0 > len) continue; // daire kolun dışında
    const enter = Math.max(0, t0);
    // kolun silindire girdiği noktadaki yükseklik ayaktan `h` altında mı (üstünden geçen kol kişiyi kesmez)
    const yEnter = pivot.y + (dy / len) * enter, yExit = pivot.y + (dy / len) * Math.min(len, t1);
    if (Math.min(yEnter, yExit) > p.y + h) continue;
    if (Math.max(yEnter, yExit) < p.y - 0.1) continue;
    const t = Math.max(0, enter - pad);
    if (t < best) { best = t; moved = true; }
  }
  if (!moved) return false;
  const k = best / len;
  cam.x = pivot.x + dx * k; cam.y = pivot.y + dy * k; cam.z = pivot.z + dz * k;
  return true;
}

/**
 * figüran kolu yalnız yakın plana düşürmeyecek kadar kısaltır. Kısaltılmış kol `CROWD_MIN_ARM`'dan (ya da statik
 * kol zaten kısaysa ondan) kısaysa kamera statik kolda kalır, kol koridorundaki figüranlar o kare çizilmez (`cityLifeRuntime.veil`). Eskiden
 * duraktaki figüran kolu göz yedeğine çökertiyordu: avatar gizli, kamera yerde/duvar dibinde (<city> Nil kordonu), figüran başı lenste (<city>),
 * göz yedeğinde simge eğimi gökyüzüne (<city>). `from`: figürandan önceki kamera, `to`: kısaltılmış kamera.
*/
export const CROWD_MIN_ARM = 1.6;
/** Histerezis: perde açıkken ancak kol `CROWD_VEIL_OFF`'u aşınca kapanır (eşikte yürüyen figüran kare kare titreyip kamera hedefi sıçramasın). */
export const CROWD_VEIL_OFF = 1.8;
export function crowdVeil(from: Pt, to: Pt, pivot: Pt, was = false): boolean {
  const l0 = Math.hypot(from.x - pivot.x, from.y - pivot.y, from.z - pivot.z), l1 = Math.hypot(to.x - pivot.x, to.y - pivot.y, to.z - pivot.z);
  return l1 < Math.min(was ? CROWD_VEIL_OFF : CROWD_MIN_ARM, l0) - 1e-6;
}
/** Figüranın (x, z) kamera → avatar koridoruna yatay uzaklığı (perde: `CROWD_VEIL_R` içindekiler çizilmez). */
export const CROWD_VEIL_R = CROWD_CAM_R + 0.25;
export function laneDist(px: number, pz: number, cx: number, cz: number, ax: number, az: number): number {
  const vx = ax - cx, vz = az - cz, l2 = vx * vx + vz * vz;
  const t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((px - cx) * vx + (pz - cz) * vz) / l2)) : 0;
  return Math.hypot(px - cx - vx * t, pz - cz - vz * t);
}
/** Figüran gövdesi (ayak `fy` … `fy + h`) kamera (`camY`) ile avatar (ayak `footY` … baş) koridorunun yüksekliğinde mi — başka kattaki
 *  (köprü altı/üstü) figüran perdeyle gizlenmez. */
export function laneSpansY(fy: number, camY: number, footY: number, h = AGENT_CAM_H): boolean {
  return fy < Math.max(camY, footY + h) && fy + h > Math.min(camY, footY);
}
