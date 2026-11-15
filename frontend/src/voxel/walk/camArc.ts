// gecikmeli kamera konumu hedefe düz çizgiyle yaklaşırken hedef avatarın ÖBÜR yanına geçerse (yaylı kol tezgâh/tenteye çarpınca
// yan değiştirir: İstanbul balık ekmek ritüel yürüyüşü ~450. ms) çizgi avatarın içinden geçer → ~30 ms göz yedeği/gizli kare. Yay üzerinde
// döndürmek de işe yaramadı (öbür yan tezgâha bakar, kol çöker, kamera ~1 sn avatarın dibinde kalır): büyük yan değişiminde kamera tek
// karede hedefe oturur (kesme; ara kare yok). Küçük açıda düz lerp (davranış aynı).
export const FLIP_MIN = 1.2; // rad (~69°): pivot çevresinde bundan büyük yan değişimi
interface P3 { x: number; y: number; z: number }
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** Hedefin pivot çevresindeki yönü kameradan FLIP_MIN'den fazla farklı mı (düz lerp avatarın yakınından/içinden geçer). */
export function sideFlip(cam: P3, tgt: P3, pivot: P3): boolean {
  const ax = cam.x - pivot.x, az = cam.z - pivot.z, bx = tgt.x - pivot.x, bz = tgt.z - pivot.z;
  return Math.hypot(ax, az) > 0.3 && Math.hypot(bx, bz) > 0.3 && Math.abs(wrap(Math.atan2(bx, bz) - Math.atan2(ax, az))) > FLIP_MIN;
}
/** cam'i tgt'ye f oranında yaklaştırır (yerinde); yan değişiminde kesme. */
export function camLerp(cam: P3, tgt: P3, pivot: P3, f: number): void {
  const k = sideFlip(cam, tgt, pivot) ? 1 : f;
  cam.x += (tgt.x - cam.x) * k; cam.y += (tgt.y - cam.y) * k; cam.z += (tgt.z - cam.z) * k;
}
