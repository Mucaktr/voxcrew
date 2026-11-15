/**
 * PHYS — yol izleme ve yerel kaçınma (istenen hız). Saf; çözücü her sabit adımda yürüyen her beden için çağırır.
 *
 *  1. Yol izleme: ara noktaya `PASS_R` yaklaşınca (ya da geçince) sıradakine geçer; son noktada yumuşak yavaşlama.
 *  2. Kuyruk: hedefe yakınken hedefte (ya da hedefe giden kuyrukta) önünde duran varsa durur ve bekler; boşalınca devam eder.
 *  3. Hız engeli (RVO/ORCA'nın basit hâli): göreli hızla `HORIZON` sn içinde çarpışma öngörülürse en yakın yaklaşma
 *     noktasından uzağa (baş başa gelişte herkes kendi sağına) yan adım atar ve aciliyete göre yavaşlar.
 *  4. Takip: aynı yöne giden daha yavaş birinin arkasında hızını ona uydurur (üstüne binmez).
 *  5. Ayrışma: temas mesafesine çok yakın komşudan yumuşak itiş (sert düzeltme çözücüde).
 * Uzak bedenler (`lite`) yalnız 1 ve 2'yi yapar.
 */
import { centerX, centerZ, type StaticWorld } from "./world";
import { WALK, type Body } from "./bodies";

export const PASS_R = 0.3;
export const ARRIVE_R = 0.035;
export const DECEL = 7;
export const HORIZON = 1.1;
export const QUEUE_R = 2.4;
const SEP_GAP = 0.1;

const settled = (o: Body) => o.mode !== WALK || o.queued;

/** Son yol noktasının karo dizini (izinli hedef) */
export function goalIndex(sw: Pick<StaticWorld, "width">, b: Body): number {
  const p = b.path;
  if (!p || !p.length) return -1;
  const g = p[p.length - 1];
  return g[1] * sw.width + g[0];
}

/**
 * `b.dvx/dvz` istenen hızı yazar; varılan yol noktalarını düşürür; kuyruk durumunu günceller. `near[0..n)`: komşu bedenler
 * (kendisi hariç olabilir de olmayabilir de). Dönüş: son noktaya varış eşiğinde mi (çözücü oturtur).
 */
export function desiredVelocity(b: Body, near: readonly Body[], n: number, t: number): boolean {
  b.dvx = 0; b.dvz = 0;
  const path = b.path;
  if (!path || !path.length) { b.queued = false; b.waitT = 0; return false; }
  // 1) ara noktalar
  while (path.length > 1) {
    const cx = centerX(path[0][0]), cz = centerZ(path[0][1]);
    const dx = cx - b.x, dz = cz - b.z;
    const d = Math.hypot(dx, dz);
    if (d < PASS_R) { path.shift(); continue; }
    // geçilmiş nokta: sonrakine giden yön ile bu noktaya olan yön ters ve yakın
    const nx = centerX(path[1][0]) - cx, nz = centerZ(path[1][1]) - cz;
    if (d < 0.7 && dx * nx + dz * nz < 0) { path.shift(); continue; }
    break;
  }
  const final = path.length === 1;
  const tx = centerX(path[0][0]), tz = centerZ(path[0][1]);
  let dx = tx - b.x, dz = tz - b.z;
  const d = Math.hypot(dx, dz);
  if (final && d < ARRIVE_R) return true;
  dx /= d || 1; dz /= d || 1;
  let speed = b.speed;
  if (final) speed = Math.min(speed, Math.sqrt(2 * DECEL * d));
  let vx = dx * speed, vz = dz * speed;

  // 2) kuyruk: hedefe yakınken hedefte ya da hedef kuyruğunda önümde duran var mı
  const g = path[path.length - 1];
  const gx = centerX(g[0]), gz = centerZ(g[1]);
  const dG = Math.hypot(gx - b.x, gz - b.z);
  let queued = false;
  if (dG < QUEUE_R) {
    for (let k = 0; k < n; k++) {
      const o = near[k];
      if (o === b || !settled(o)) continue;
      if (t < b.contactUntil && t < o.contactUntil) continue;
      const rs = b.r + o.r;
      const ox = o.x - b.x, oz = o.z - b.z;
      const dd = Math.hypot(ox, oz);
      if (dd > rs + 0.25) continue;
      const oG = Math.hypot(gx - o.x, gz - o.z);
      if (oG > dG - 0.05) continue; // hedefe benden yakın değil
      if (oG < rs + 0.25 || (o.queued && o.goal === b.goal)) { queued = true; break; }
    }
  }
  if (queued) {
    b.queued = true; // bekleme süresi (waitT) çözücüde artar
    return false;
  }
  b.queued = false; b.waitT = 0;

  // 3–5) komşular
  for (let k = 0; k < n; k++) {
    const o = near[k];
    if (o === b) continue;
    if (t < b.contactUntil && t < o.contactUntil) continue; // beyaz listedeki temas
    const px = o.x - b.x, pz = o.z - b.z;
    const dd = Math.hypot(px, pz);
    const rs = b.r + o.r;
    if (dd > 1.6) continue;
    // 5) ayrışma
    if (dd < rs + SEP_GAP && dd > 1e-6) {
      const k2 = (rs + SEP_GAP - dd) * 6;
      vx -= (px / dd) * k2; vz -= (pz / dd) * k2;
    }
    if (b.lite) continue;
    const ovx = o.mode === WALK && !o.queued ? o.vx : 0, ovz = o.mode === WALK && !o.queued ? o.vz : 0;
    // 4) takip: önümde aynı yöne giden daha yavaş
    const ahead = px * dx + pz * dz;
    const lateral = Math.abs(px * dz - pz * dx);
    const oAlong = ovx * dx + ovz * dz;
    if (ahead > 0 && lateral < rs && dd < rs + 0.4 && oAlong > 0.05) {
      const cur = vx * dx + vz * dz;
      if (cur > oAlong) { const cut = cur - oAlong; vx -= dx * cut; vz -= dz * cut; }
      continue;
    }
    // 3) hız engeli: göreli hız w = v_b - v_o; en yakın yaklaşma zamanı ve mesafesi
    const wx = vx - ovx, wz = vz - ovz;
    const w2 = wx * wx + wz * wz;
    if (w2 < 1e-6) continue;
    const tca = (px * wx + pz * wz) / w2;
    if (tca <= 0 || tca > HORIZON) continue;
    let qx = wx * tca - px, qz = wz * tca - pz; // en yakın anda o'ya göre konumum
    const q = Math.hypot(qx, qz);
    const need = rs + 0.08;
    if (q >= need) continue;
    const urg = 1 - tca / HORIZON;
    if (q < 0.03) { const wl = Math.sqrt(w2); qx = wz / wl; qz = -wx / wl; } // baş başa: kendi sağıma
    else { qx /= q; qz /= q; }
    const s = speed * (0.6 + 0.9 * urg) * (need - Math.min(q, need)) / need;
    vx += qx * s * 1.6; vz += qz * s * 1.6;
    // duran engele dosdoğru gidiyorsam biraz yavaşla (yan adımın zamanı olsun)
    if (o.mode !== WALK) { const slow = 1 - 0.45 * urg; vx *= slow; vz *= slow; }
  }
  const v = Math.hypot(vx, vz);
  if (v > b.speed) { vx *= b.speed / v; vz *= b.speed / v; }
  b.dvx = vx; b.dvz = vz;
  return false;
}
