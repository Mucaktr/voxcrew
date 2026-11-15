/**
 * HQA-FIX — iç mekâna giriş karesi. Kök neden: kapıdan girince avatar kapının hemen içindeki varış karosuna (portalın bir
 * önü) konuyordu ve kamera şehirdeki yaw'ında kalıyordu. Kamera avatarın arkasındaki kapı duvarına düşüyor, yaylı kol başa çöküyordu
 * (Yerebatan: kare kiriş + su, avatarın yüzü 20 cm'de). W kameraya göre yürüdüğünden kapıya bakan kamera W ile avatarı yeniden dışarı
 * çıkarıyordu.
 *
 * Kural: avatar varış karosundan bakış yönünde odanın içine en çok `MAX_IN` karo ilerletilir. İlk karo seçilir ki arkasında kamera
 * için en az `BACK_MIN` açık karo, önünde `FRONT_MIN` açık karo olsun ve karo bir portal ya da merdiven karosu olmasın. Kamera bakış
 * yönüne oturur (WalkRig `walkCamera.aim`). Uygun karo yoksa en çok açık olan seçilir. Saf modül; test.
*/
import type { Tile } from "../scenes";
import { rayOpen, type SightFn } from "../walk/spawnView";

export const MAX_IN = 4;
export const RING_R = 6; // ferah karo araması yarıçapı
export const BACK_MIN = 3;
export const FRONT_MIN = 2;
/**
 * kapıdan girişte `interiorArrival` arkası en az `BACK_MIN` karo açık bir kare seçtiyse kamera o yöne TAM oturur
 * (WalkRig `clearAimYaw` döndürmez: sokak boyundaki 4,6 birimlik kolu küçük odada ölçüp kamerayı yana/öne çeviriyordu — Yerebatan'da
 * su üstünden yana bakıp W avatarı korkuluğa sürüyordu, Topkapı/Kapalıçarşı'da avatarın yüzü/göz yedeği). Yazar ipucunda (`hinted`) eski kural.
*/
/**
 * ferah karo (`roomy`) araması kapıdan girişte de — katta asansör durağı yoksa. Kapalıçarşı girişinde avatar iki
 * karoluk tezgâhlı koridorda kalıyor, "corridor" profilinin kolu (1,2) iç mekân göz eşiğinin (1,3) altında, uzatılmış kol tezgâh
 * tentesine çarpıyor: ilk kare göz yedeği. Asansörlü katta (kule girişi) avatar asansörün F menzilinde kalır (INTERIOR-ENTRY-LIFT-001).
*/
export const entryRoomy = (lift: boolean, liftStops: number): boolean => lift || liftStops === 0;
export const keepsArrivalAim = (pick: { back?: number } | null | undefined, hinted: boolean): boolean => !hinted && (pick?.back ?? 0) >= BACK_MIN;

/**
 * `roomy` — karo kamera için ferah mı (profil "corridor" değil: x ve z açıklığı > CORRIDOR_RUN). Sergi katı asansör
 * varışı iki vitrin arasındaki 1 karolukta bitiyor, kamera "koridor" profiliyle (1,2 birim) başın dibine iniyordu; ferah karo yoksa eski kural.
 * Bakış ekseni dışında MAX_IN karelik halkadaki en yakın ferah karo da aday sayılır.
*/
export function interiorArrival(sight: SightFn, walk: (t: Tile) => boolean, avoid: ReadonlySet<string>, t0: Tile, heading: number, roomy?: (t: Tile) => boolean): { tile: Tile; heading: number; back: number; front: number } {
  const fi = Math.round(Math.sin(heading)), fj = Math.round(Math.cos(heading));
  let best: { tile: Tile; heading: number; back: number; front: number } | null = null;
  const ring: Tile[] = [];
  const backClear = (t: Tile) => { for (let k = 1; k <= BACK_MIN; k++) for (let l = -1; l <= 1; l++) if (!walk([t[0] - fi * k - fj * l, t[1] - fj * k + fi * l])) return false; return true; };
  if (roomy) {
    for (let dj = -RING_R; dj <= RING_R; dj++) for (let di = -RING_R; di <= RING_R; di++) ring.push([t0[0] + di, t0[1] + dj]);
    ring.sort((a, b) => Math.hypot(a[0] - t0[0], a[1] - t0[1]) - Math.hypot(b[0] - t0[0], b[1] - t0[1]));
    for (const t of ring) {
      if (!walk(t) || avoid.has(`${t[0]},${t[1]}`) || !roomy(t) || !backClear(t)) continue; // kamera kolunun arka şeridi (± 1 yan karo; omuz kayması) açık: kol kapı çerçevesine/duvara çökmez
      const back = rayOpen(sight, t, -fi, -fj), front = rayOpen(sight, t, fi, fj);
      if (back >= BACK_MIN + 1 && front >= FRONT_MIN) return { tile: t, heading, back, front }; // ferah halkada arka pay 1 fazla (kapı çerçevesi/kamera kolu)
    }
  }
  // ferah karolardan arkası en uzun (≥ 2) ve önü ≥ FRONT_MIN olan en yakın (eksen yedeği dar karoda kalırsa)
  let soft: { tile: Tile; heading: number; back: number; front: number } | null = null;
  if (roomy) for (const t of ring) {
    if (!walk(t) || avoid.has(`${t[0]},${t[1]}`) || !roomy(t)) continue;
    const back = rayOpen(sight, t, -fi, -fj), front = rayOpen(sight, t, fi, fj);
    if (back >= 2 && front >= FRONT_MIN && (!soft || back > soft.back)) soft = { tile: t, heading, back, front };
  }
  for (let k = 0; k <= MAX_IN; k++) {
    const t: Tile = [t0[0] + fi * k, t0[1] + fj * k];
    if (k > 0 && !walk(t)) break;
    if (avoid.has(`${t[0]},${t[1]}`)) continue;
    const back = rayOpen(sight, t, -fi, -fj), front = rayOpen(sight, t, fi, fj);
    const c = { tile: t, heading, back, front };
    if (back >= BACK_MIN && front >= FRONT_MIN) return roomy && soft && !roomy(t) ? soft : c; // dar karoda ferah yedek
    // yedek: kamera payı (arka) öndeki açıklıktan önemli — ağırlık 2
    const sc = (q: { back: number; front: number }) => (q.front >= 1 ? 10 : 0) + 2 * Math.min(q.back, BACK_MIN) + Math.min(q.front, FRONT_MIN); // önü duvar olmasın
    if (!best || sc(c) > sc(best)) best = c;
  }
  return soft && (!best || !roomy!(best.tile)) ? soft : best ?? { tile: t0, heading, back: 0, front: 0 };
}
