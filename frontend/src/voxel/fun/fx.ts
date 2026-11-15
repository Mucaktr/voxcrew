/**
 * S48 — eğlence efektleri: kalpler, yıldızlar, toz bulutu, yaprak/taç yaprağı, su damlası, buhar, kabarcık, nota, konfeti ve
 * ajanın elindeki küçük nesneler (olta, top, raket, kâğıt uçak, frizbi, kartopu, balık). Hepsi TEK örneklenmiş kutu dizisinde
 * (+1 çizim çağrısı; boşken gizli → +0). Parçacık havuzu sabit (nesne üretilmez); elde tutulan nesneler her karede yeniden
 * yazılır (`box` / `seg`). Hareket azaltmada parçacık üretilmez. Durum `WorldLive.fx`'te (dünya başına); çizim Crowd.tsx'te.
 */
import * as THREE from "three";

/** Renk paleti (dizin) — örnek renkleri her karede nesne üretmeden yazılsın diye önceden hesaplanır. */
export const C = {
  white: 0, pink: 1, red: 2, yellow: 3, gold: 4, sky: 5, blue: 6, green: 7, leaf: 8, grey: 9, dark: 10, rod: 11, orange: 12,
  paddle: 13, purple: 14, line: 15, snow: 16, cyan: 17, paper: 18, ink: 19, steam: 20, water: 21, lime: 22, brown: 23,
  /** W3 (WALK-FUN) hediye eşyaları: saksı, krema, çay, kahve, pasta, tepsi, kurye kutusu */
  clay: 24, cream: 25, tea: 26, coffee: 27, cake: 28, tray: 29, parcel: 30,
} as const;
const HEX = ["#FFFFFF", "#F472B6", "#FB7185", "#FDE047", "#F59E0B", "#BAE6FD", "#60A5FA", "#4ADE80", "#65A30D", "#E5E7EB", "#33323D",
  "#8B5A2B", "#FB923C", "#EF4444", "#A78BFA", "#D4D4D8", "#F1F5F9", "#22D3EE", "#FFFBEB", "#312E81", "#F8FAFC", "#7DD3FC", "#A3E635", "#B45309",
  "#C2410C", "#FEF3C7", "#B91C1C", "#3B2416", "#F9A8D4", "#94A3B8", "#C08A4B"];
export const PALETTE = HEX.map((h) => new THREE.Color(h));
const PAL_INDEX = new Map<string, number>(HEX.map((h, i) => [h.toUpperCase(), i]));
/** WORLD-FIX: serbest renk (balık türleri) → palet dizini; yoksa palete eklenir (yalnız yuva rengi; malzeme/çağrı değişmez). */
export function paletteIndex(hex: string): number {
  const key = hex.toUpperCase();
  let i = PAL_INDEX.get(key);
  if (i === undefined) { i = PALETTE.length; PALETTE.push(new THREE.Color(hex)); PAL_INDEX.set(key, i); }
  return i;
}

/** Parçacık şekli: küp, kalp (3 kutu), yıldız (2 kutu, artı), nota (2 kutu), yassı (taç yaprağı/yaprak/konfeti), yer izi
 * (dönmeyen, yere yapışık ince levha; en/boy oranı `wob`ta).*/
type Glyph = 0 | 1 | 2 | 3 | 4 | 5;
interface P {
  on: boolean; x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; life: number; size: number;
  grow: number; grav: number; drag: number; rot: number; spin: number; col: number; glyph: Glyph; wob: number;
  /** yörünge (sersemlik yıldızları): merkez ve yarıçap; or > 0 ise konum buradan hesaplanır */
  ox: number; oz: number; or: number;
}

export type Burst = "hearts" | "stars" | "dizzy" | "puff" | "petals" | "leaves" | "sparkle" | "splash" | "steam" | "bubbles" | "notes"
  | "confetti" | "snow" | "ripple";

const P_CAP = 180;
const IMM_CAP = 72;
/** örnek tavanı: kalp 3, yıldız/nota 2 kutu; çoğu parçacık tek kutu */
export const FX_CAP = 420;

export interface FxState {
  ps: P[];
  next: number;
  /** anlık kutular (bu kare): [x, y, z, sx, sy, sz, yaw, pitch, roll, renk] */
  imm: Float32Array;
  ni: number;
  /** hareket azaltma (parçacık yok) */
  calm: boolean;
  /** son yazılan örnek sayısı (ölçüm) */
  drawn: number;
}

export function createFx(): FxState {
  const ps: P[] = [];
  for (let i = 0; i < P_CAP; i++) ps.push({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, size: 0.1, grow: 0, grav: 0, drag: 0,
    rot: 0, spin: 0, col: 0, glyph: 0, wob: 0, ox: 0, oz: 0, or: 0 });
  return { ps, next: 0, imm: new Float32Array(IMM_CAP * 10), ni: 0, calm: false, drawn: 0 };
}

function slot(fx: FxState): P {
  // halka: en eski parçacık yeniden kullanılır (tavan dolduysa)
  for (let k = 0; k < P_CAP; k++) {
    const p = fx.ps[(fx.next + k) % P_CAP];
    if (!p.on) { fx.next = (fx.next + k + 1) % P_CAP; return p; }
  }
  const p = fx.ps[fx.next];
  fx.next = (fx.next + 1) % P_CAP;
  return p;
}

const R = Math.random;
function spawn(fx: FxState, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, col: number,
  glyph: Glyph, grav = 0, drag = 0, grow = 0) {
  const p = slot(fx);
  p.on = true; p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.age = 0; p.life = life; p.size = size; p.col = col;
  p.glyph = glyph; p.grav = grav; p.drag = drag; p.grow = grow; p.rot = R() * 6.28; p.spin = (R() - 0.5) * 6; p.wob = R() * 6.28; p.or = 0;
  return p;
}

/** Bir efekt patlaması üretir (hareket azaltmada hiçbir şey). `s`: ölçek (karakter boyu). */
export function burst(fx: FxState, kind: Burst, x: number, y: number, z: number, s = 1) {
  if (fx.calm) return;
  switch (kind) {
    case "hearts":
      for (let i = 0; i < 3; i++) spawn(fx, x + (R() - 0.5) * 0.25 * s, y + R() * 0.1, z + (R() - 0.5) * 0.25 * s, (R() - 0.5) * 0.15, 0.45 + R() * 0.2, (R() - 0.5) * 0.15,
        1.3 + R() * 0.4, 0.05 * s, R() < 0.6 ? C.pink : C.red, 1, 0, 0.5);
      break;
    case "stars":
      for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.28; spawn(fx, x, y, z, Math.cos(a) * 1.2 * s, 0.6 + R() * 0.6, Math.sin(a) * 1.2 * s, 0.6, 0.06 * s, i % 2 ? C.yellow : C.white, 2, 1.5, 1.5); }
      break;
    case "dizzy":
      // sersemlik: başın üstünde dönen üç yıldız
      for (let i = 0; i < 3; i++) { const p = spawn(fx, x, y, z, 0, 0, 0, 1.15, 0.05 * s, i === 1 ? C.white : C.yellow, 2); p.ox = x; p.oz = z; p.or = 0.2 * s; p.rot = (i / 3) * 6.28; p.spin = 7; }
      break;
    case "puff":
      for (let i = 0; i < 7; i++) { const a = R() * 6.28; spawn(fx, x, y, z, Math.cos(a) * 0.9 * s, 0.15 + R() * 0.35, Math.sin(a) * 0.9 * s, 0.55 + R() * 0.2, 0.09 * s, C.grey, 0, -0.2, 3, 0.25); }
      break;
    case "petals":
      for (let i = 0; i < 9; i++) spawn(fx, x + (R() - 0.5) * 0.5, y + R() * 0.2, z + (R() - 0.5) * 0.5, (R() - 0.5) * 0.9, 0.8 + R() * 0.7, (R() - 0.5) * 0.9, 2 + R(),
        0.06, [C.pink, C.yellow, C.white, C.purple, C.red][i % 5], 4, 1.1, 2.2);
      break;
    case "leaves":
      // taç kenarının altından (tacın içinde kalıp gizlenmesin) süzülerek düşer
      for (let i = 0; i < 9; i++) {
        const a = R() * 6.28, r = (1 + R() * 0.9) * s;
        spawn(fx, x + Math.cos(a) * r, y - R() * 0.3, z + Math.sin(a) * r, Math.cos(a) * 0.15, -0.15 - R() * 0.2, Math.sin(a) * 0.15, 3 + R(),
          0.1, R() < 0.5 ? C.green : C.leaf, 4, 0.3, 1.2);
      }
      break;
    case "sparkle":
      for (let i = 0; i < 7; i++) spawn(fx, x + (R() - 0.5) * 0.3 * s, y + (R() - 0.5) * 0.3 * s, z + (R() - 0.5) * 0.3 * s, (R() - 0.5) * 1.1, 0.4 + R() * 0.8, (R() - 0.5) * 1.1,
        0.55 + R() * 0.3, 0.045 * s, i % 3 ? C.yellow : C.gold, 2, 0.6, 2); // beyaz artılar gözde "X" gibi okunuyordu → yalnız sıcak sarı/altın
      break;
    case "splash":
      for (let i = 0; i < 10; i++) { const a = R() * 6.28, r = 0.5 + R() * 0.9; spawn(fx, x, y, z, Math.cos(a) * r * s, 1.6 + R() * 1.4, Math.sin(a) * r * s, 0.9, 0.05 * s, i % 3 ? C.water : C.white, 0, 6.5); }
      break;
    case "ripple":
      for (let i = 0; i < 5; i++) { const a = R() * 6.28; spawn(fx, x, y, z, Math.cos(a) * 0.6, 0.6 + R() * 0.5, Math.sin(a) * 0.6, 0.5, 0.035, C.water, 0, 4); }
      break;
    case "steam":
      for (let i = 0; i < 8; i++) spawn(fx, x + (R() - 0.5) * 0.1, y + R() * 0.1, z + (R() - 0.5) * 0.1, (R() - 0.5) * 0.15, 0.5 + R() * 0.35, (R() - 0.5) * 0.15, 1 + R() * 0.5,
        0.07, C.steam, 0, -0.1, 0.8, 0.12);
      break;
    case "bubbles":
      for (let i = 0; i < 8; i++) spawn(fx, x + (R() - 0.5) * 0.5, y + R() * 0.3, z + (R() - 0.5) * 0.3, (R() - 0.5) * 0.05, 0.35 + R() * 0.3, 0, 1.3 + R() * 0.6, 0.035, C.sky, 0);
      break;
    case "notes":
      spawn(fx, x + (R() - 0.5) * 0.3 * s, y, z + (R() - 0.5) * 0.3 * s, (R() - 0.5) * 0.2, 0.55, (R() - 0.5) * 0.2, 1.4, 0.05 * s, R() < 0.5 ? C.purple : C.blue, 3);
      break;
    case "confetti":
      for (let i = 0; i < 14; i++) spawn(fx, x, y, z, (R() - 0.5) * 1.6, 1.8 + R() * 1.2, (R() - 0.5) * 1.6, 1.6 + R() * 0.5, 0.05 * s,
        [C.pink, C.yellow, C.cyan, C.lime, C.purple, C.orange][i % 6], 4, 2.6, 1.5);
      break;
    case "snow":
      for (let i = 0; i < 8; i++) { const a = R() * 6.28; spawn(fx, x, y, z, Math.cos(a) * 0.8, 0.5 + R() * 0.8, Math.sin(a) * 0.8, 0.6, 0.05, C.snow, 0, 3, 2); }
      break;
  }
}

// ------------------------------------------------------------------ "Yıldız sağanağı" (Star shower) — gök deseni
/**
 * Gece iki kez, kısa süre, bir simgenin ÇEVRESİNDEKİ GÖKTE sıcak renkli kayan yıldız çizgileri (baş + üç kuyruk kutusu; aynı
 * fx havuzu, +0 malzeme, en çok +1 çizim çağrısı ve yalnız gösteri sürerken). Işık yapıya düşmez: parçacıklar simge ayak izinin
 * `margin` karo çevresinin dışında (Chebyshev) doğar ve dışa/aşağı gider; nokta ışık, parlayan blok ve yapı üstü yıkama yok.
 * Bilinen gece gösterilerinden farklı: saat başı değil (21.20 ve 00.40), beyaz/altın değil (mercan, kayısı, gül, şeftali),
 * yapı üstünde pırıltı ya da dönen ışık değil, gökte dağınık süzülen çizgiler. Hareket azaltmada parçacık yok (`fx.calm`).
 * ip_risk 1 — gerekçe: kafes kulenin korunan gece aydınlatmasıyla "gece + kule" çağrışımı; renk, desen, yer ve zamanlama farklı.
 */
export interface SkyShow {
  /** simge merkezi (dünya) */
  x: number; z: number;
  /** doğuş bandı: merkezden Chebyshev yarı genişlik (iç ≥ ayak izi yarısı + marj) ve dış sınır */
  h0: number; h1: number;
  /** doğuş yüksekliği aralığı */
  y0: number; y1: number;
}
/** Zamanlama: gün içi dakika `% 720` (12 saatlik döngü) üzerinde iki pencere → gece (19.00–07.00) iki kez: 21.20 ve 00.40.
 *  Kullanıcı gündüz saatinde Gece ışığını seçerse aynı döngü (09.20, 12.40) → yine "gece başına" iki kez. Saat başı (:00) yok. */
export const STAR_SHOWER = {
  /** pencere başlangıçları (dakika, 12 saatlik döngüde) */
  at: [9 * 60 + 20, 40] as readonly number[],
  /** pencere süresi (sn) ve yumuşak giriş/çıkış (sn) */
  dur: 80, fade: 10,
  /** tepe yoğunlukta saniyede kayan yıldız */
  rate: 4,
  /** çizgi başına kutu (baş + kuyruk) ve boyları */
  sizes: [0.24, 0.17, 0.12, 0.08] as readonly number[],
  /** sıcak renkler (beyaz, sarı, altın yok) */
  colors: ["#FF8A65", "#FFB07C", "#FF7EA0", "#FFC2A1"] as readonly string[],
} as const;

/** Gösteri yoğunluğu 0–1 (`minute`: gün içi kesirli dakika, ör. 21 × 60 + 20,5). Pencere dışında 0. */
export function starShowerLevel(minute: number): number {
  const m = ((minute % 720) + 720) % 720;
  for (const a of STAR_SHOWER.at) {
    const u = (m - a) * 60; // saniye
    if (u >= 0 && u < STAR_SHOWER.dur) return Math.max(0, Math.min(1, u / STAR_SHOWER.fade, (STAR_SHOWER.dur - u) / STAR_SHOWER.fade));
  }
  return 0;
}
/** `Date` → gün içi kesirli dakika (yerel saat). */
export const minuteOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;

let SHOWER_COLS: number[] | null = null;
/** Tek kayan yıldız: baş + üç küçülen kuyruk (aynı hız; kuyruk hız yönünün tersinde). Hareket azaltmada hiçbir şey. */
export function starStreak(fx: FxState, show: SkyShow) {
  if (fx.calm) return;
  const cols = SHOWER_COLS ??= STAR_SHOWER.colors.map(paletteIndex);
  // kare halka üzerinde nokta: Chebyshev yarıçapı h ∈ [h0, h1] (simge marjının dışında)
  const th = R() * 6.2832, cx = Math.cos(th), cz = Math.sin(th), k = 1 / Math.max(Math.abs(cx), Math.abs(cz));
  const h = show.h0 + R() * (show.h1 - show.h0);
  const x = show.x + cx * k * h, z = show.z + cz * k * h, y = show.y0 + R() * (show.y1 - show.y0);
  // dışa (radyal ≥ 0,8) + hafif teğet + aşağı: simgeye hiç yaklaşmaz
  const out = 0.8 + R() * 0.8, tan = (R() - 0.5) * 0.9, vy = -(1.5 + R() * 0.9);
  const vx = cx * out - cz * tan, vz = cz * out + cx * tan;
  const sp = Math.hypot(vx, vy, vz), life = 1.3 + R() * 0.6, col = cols[Math.floor(R() * cols.length)];
  for (let i = 0; i < STAR_SHOWER.sizes.length; i++) {
    const back = i * 0.32;
    const p = spawn(fx, x - (vx / sp) * back, y - (vy / sp) * back, z - (vz / sp) * back, vx, vy, vz, life, STAR_SHOWER.sizes[i], col, 0, 0.35, 0.15);
    p.spin = 0; p.rot = 0;
  }
}

/** Kare başına sürücü: `level` (0–1, `starShowerLevel`) ile orantılı belirlenimci olmayan doğum; birikim `acc` çağıranda.
 *  Döner: yeni birikim. Hareket azaltmada ya da gündüz çağıran 0 verir → doğum yok, var olanlar söner. */
export function stepStarShower(fx: FxState, show: SkyShow, level: number, dt: number, acc: number): number {
  if (fx.calm || level <= 0) return 0;
  acc += STAR_SHOWER.rate * level * dt;
  while (acc >= 1) { starStreak(fx, show); acc -= 1; }
  return acc;
}

// ------------------------------------------------------------------ (C2) izler ve (A5) su halkaları
/**
 * Karda ya da kumda avatarın arkasında sönen ayak izleri: adım boyu `TRACE.stride`, sol/sağ sırayla, yere yapışık ince levha
 * (glyph 5), `TRACE.life` sn sonra küçülerek kaybolur. Aynı anda en çok `TRACE.max` iz (kendi halkası; fx havuzu tavanı
 * P_CAP/FX_CAP aşılmaz). Hareket azaltmada (`fx.calm`) hiç iz yok. Ödül, sayaç ya da kayıt yok: yalnız görsel.
 */
export const TRACE = {
  stride: 0.32, life: 2.6, max: 16, size: 0.14, side: 0.07,
  colors: { snow: "#C9D6E3", sand: "#B8955E" } as Readonly<Record<"snow" | "sand", string>>,
} as const;
export type TraceSurface = "snow" | "sand";
export interface TraceState { lx: number; lz: number; has: boolean; acc: number; side: number; born: Float64Array; i: number }
export function createTrace(): TraceState {
  return { lx: 0, lz: 0, has: false, acc: 0, side: 1, born: new Float64Array(TRACE.max).fill(-1e9), i: 0 };
}
let TRACE_COLS: Record<TraceSurface, number> | null = null;

/** Kare başı: avatar (x, z) ve ayak yüksekliği y; `surface` null ise iz yok (ama konum izlenir). `now` sn. Döner: bu karede
 *  basılan iz sayısı (0/1). */
export function stepTrace(fx: FxState, st: TraceState, x: number, y: number, z: number, surface: TraceSurface | null, now: number): number {
  if (!st.has) { st.lx = x; st.lz = z; st.has = true; return 0; }
  const dx = x - st.lx, dz = z - st.lz, d = Math.hypot(dx, dz);
  st.lx = x; st.lz = z;
  if (d > 1.5) { st.acc = 0; return 0; } // ışınlama / sahne değişimi
  if (fx.calm || !surface) { st.acc = 0; return 0; }
  st.acc += d;
  if (st.acc < TRACE.stride || d < 1e-5) return 0;
  st.acc = 0;
  // kendi halkası: en eski iz hâlâ yaşıyorsa yenisi basılmaz (aynı anda ≤ TRACE.max)
  if (now - st.born[st.i] < TRACE.life) return 0;
  st.born[st.i] = now; st.i = (st.i + 1) % TRACE.max;
  const cols = TRACE_COLS ??= { snow: paletteIndex(TRACE.colors.snow), sand: paletteIndex(TRACE.colors.sand) };
  const yaw = Math.atan2(dx, dz), px = Math.cos(yaw), pz = -Math.sin(yaw); // yürüyüş yönüne dik
  st.side = -st.side;
  const p = spawn(fx, x + px * TRACE.side * st.side, y + 0.012, z + pz * TRACE.side * st.side, 0, 0, 0, TRACE.life, TRACE.size, cols[surface], 5);
  p.rot = yaw; p.spin = 0; p.wob = 0.55;
  return 1;
}

/** Sağanak anında yerde tek su halkası: büyüyerek söner (glyph 5, kare levha). Hareket azaltmada hiçbir şey. */
export function puddle(fx: FxState, x: number, y: number, z: number) {
  if (fx.calm) return;
  const p = spawn(fx, x, y + 0.01, z, 0, 0, 0, 0.8, 0.05, C.water, 5, 0, 0, 4);
  p.spin = 0; p.wob = 1;
}

/** Anlık kutu (bu karelik; elde tutulan nesneler). */
export function box(fx: FxState, x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, pitch: number, roll: number, col: number) {
  if (fx.ni >= IMM_CAP) return;
  const o = fx.ni++ * 10, a = fx.imm;
  a[o] = x; a[o + 1] = y; a[o + 2] = z; a[o + 3] = sx; a[o + 4] = sy; a[o + 5] = sz; a[o + 6] = yaw; a[o + 7] = pitch; a[o + 8] = roll; a[o + 9] = col;
}

/** İki nokta arasında ince çubuk (olta, misina). */
export function seg(fx: FxState, ax: number, ay: number, az: number, bx: number, by: number, bz: number, thick: number, col: number) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return;
  // yaw (y ekseni) ve pitch (yataydan sapma) ile +z eksenini çubuk yönüne çevir ("YXZ")
  const yaw = Math.atan2(dx, dz), pitch = -Math.atan2(dy, Math.hypot(dx, dz));
  box(fx, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, thick, thick, len, yaw, pitch, 0, col);
}

// ------------------------------------------------------------------ güncelleme + örnek yazımı (Crowd.tsx kare sonu)
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, "YXZ"), _v = new THREE.Vector3(), _s = new THREE.Vector3();

export function makeFxMesh(): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ toneMapped: false }), FX_CAP);
  mesh.frustumCulled = false;
  mesh.name = "fun:fx";
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(FX_CAP * 3).fill(1), 3);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.visible = false;
  mesh.raycast = () => undefined; // tıklamaları engellemez
  return mesh;
}

function put(mesh: THREE.InstancedMesh, k: number, col: number) {
  mesh.instanceMatrix.array.set(_m.elements, k * 16);
  const c = PALETTE[col] ?? PALETTE[0];
  const a = mesh.instanceColor!.array as Float32Array;
  a[k * 3] = c.r; a[k * 3 + 1] = c.g; a[k * 3 + 2] = c.b;
}

/** Parçacıkları ilerletir ve örnekleri yazar; anlık kutular tüketilir. */
export function stepFx(fx: FxState, mesh: THREE.InstancedMesh | null, dt: number) {
  let k = 0;
  const cap = FX_CAP;
  for (const p of fx.ps) {
    if (!p.on) continue;
    p.age += dt;
    if (p.age >= p.life) { p.on = false; continue; }
    const u = p.age / p.life;
    if (p.or > 0) {
      p.rot += p.spin * dt;
      p.x = p.ox + Math.cos(p.rot) * p.or; p.z = p.oz + Math.sin(p.rot) * p.or;
    } else {
      p.vy -= p.grav * dt;
      const d = Math.max(0, 1 - p.drag * dt);
      p.vx *= d; p.vy *= d; p.vz *= d;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.glyph === 4) { p.x += Math.sin(p.age * 5 + p.wob) * 0.25 * dt; p.z += Math.cos(p.age * 4 + p.wob) * 0.25 * dt; } // süzülme
      else if (p.glyph === 1) p.x += Math.sin(p.age * 6 + p.wob) * 0.12 * dt;
      p.rot += p.spin * dt;
    }
    if (!mesh || k >= cap - 3) continue;
    // büyüme ve sönme (saydamlık yok: küçülerek kaybolur)
    const fade = u > 0.7 ? 1 - (u - 0.7) / 0.3 : u < 0.08 ? u / 0.08 : 1;
    const sz = p.size * (1 + p.grow * u) * fade;
    if (sz < 1e-3) continue;
    switch (p.glyph) {
      case 1: { // kalp: iki tepe + 45° dönük alt kutu
        _e.set(0, p.or > 0 ? 0 : Math.sin(p.age * 3 + p.wob) * 0.5, 0);
        _q.setFromEuler(_e);
        for (let sx = -0.5; sx <= 0.5; sx += 1) { _m.compose(_v.set(p.x + sx * sz * Math.cos(_e.y), p.y + sz * 0.45, p.z - sx * sz * Math.sin(_e.y)), _q, _s.set(sz, sz, sz * 0.6)); put(mesh, k++, p.col); }
        _e.set(0, _e.y, Math.PI / 4); _q.setFromEuler(_e);
        _m.compose(_v.set(p.x, p.y, p.z), _q, _s.set(sz * 1.05, sz * 1.05, sz * 0.6)); put(mesh, k++, p.col);
        break;
      }
      case 2: case 3: { // yıldız (artı) / nota (sap + baş)
        _e.set(0, p.rot * (p.glyph === 2 ? 1 : 0), p.glyph === 2 ? p.rot * 0.5 : 0); _q.setFromEuler(_e);
        if (p.glyph === 2) {
          _m.compose(_v.set(p.x, p.y, p.z), _q, _s.set(sz * 2.2, sz * 0.6, sz * 0.6)); put(mesh, k++, p.col);
          _m.compose(_v.set(p.x, p.y, p.z), _q, _s.set(sz * 0.6, sz * 2.2, sz * 0.6)); put(mesh, k++, p.col);
        } else {
          _m.compose(_v.set(p.x, p.y, p.z), _q, _s.set(sz * 1.3, sz, sz * 0.6)); put(mesh, k++, p.col);
          _m.compose(_v.set(p.x + sz * 0.55, p.y + sz * 1.3, p.z), _q, _s.set(sz * 0.3, sz * 2.4, sz * 0.3)); put(mesh, k++, p.col);
        }
        break;
      }
      case 5: // yer izi / su halkası: yere yatık, yalnız y ekseninde yönlü, dönmez
        _e.set(0, p.rot, 0); _q.setFromEuler(_e);
        _m.compose(_v.set(p.x, p.y, p.z), _q, _s.set(sz * p.wob, Math.max(0.006, sz * 0.12), sz)); put(mesh, k++, p.col);
        break;
      case 4: // yassı: dönerek süzülür
        _e.set(p.rot * 0.7, p.rot, Math.sin(p.age * 4 + p.wob) * 0.8); _q.setFromEuler(_e);
        _m.compose(_v.set(p.x, p.y, p.z), _q, _s.set(sz * 1.4, sz * 0.25, sz)); put(mesh, k++, p.col);
        break;
      default:
        _e.set(p.rot * 0.3, p.rot, 0); _q.setFromEuler(_e);
        _m.compose(_v.set(p.x, p.y, p.z), _q, _s.set(sz, sz, sz)); put(mesh, k++, p.col);
    }
  }
  if (mesh) {
    const a = fx.imm;
    for (let i = 0; i < fx.ni && k < cap; i++) {
      const o = i * 10;
      _e.set(a[o + 7], a[o + 6], a[o + 8]); _q.setFromEuler(_e);
      _m.compose(_v.set(a[o], a[o + 1], a[o + 2]), _q, _s.set(a[o + 3], a[o + 4], a[o + 5]));
      put(mesh, k++, a[o + 9]);
    }
    mesh.count = k;
    mesh.visible = k > 0;
    // [0, k) her karede baştan yazılır → yalnız kullanılan önek GPU'ya (eskiden kapasitenin tamamı)
    if (k > 0) {
      const im = mesh.instanceMatrix, ic = mesh.instanceColor!;
      im.clearUpdateRanges(); ic.clearUpdateRanges(); im.addUpdateRange(0, k * 16); ic.addUpdateRange(0, k * 3);
      im.needsUpdate = true; ic.needsUpdate = true;
    }
  }
  fx.drawn = k;
  fx.ni = 0;
}
