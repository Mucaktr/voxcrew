/**
 * EXP-INT (E1b) — kapasite kuyruğu yazıcısı ("E0 sonuçları" kural 3–5).
 *
 * `Blocks.tsx` durağan grupların (`solid/water/glass/glow`) tek `InstancedMesh`'ini `taban + TAIL_CAP` kapasiteyle kurar ve
 * burada kaydeder. Çevre akışı (`Outskirts.tsx`) yuva aralıklarını **`blocks` prop'unun dışında**, imperatif olarak yazar:
 * `setMatrixAt/setColorAt`, boş örnek sıfır matris, yalnız değişen aralık `addUpdateRange` ile GPU'ya; `mesh.count = taban +
 * kullanılan kuyruk`. Yeni mesh, malzeme ya da ışık yok → **+0 çizim çağrısı**.
 *
 * Mesh yeniden kurulunca (taban blokları değişti, sahne değişti) kuyruk sıfırlanır ve `tailVersion` artar; akış o karede
 * bütün yüklü yuvaları yeniden yazar. Renk titreşimi kuyrukta konumdan türetilir (yuva dizini değişse de ton aynı).
*/
import * as THREE from "three";
import type { Block, Group } from "../scenes";
import { tintHex, tintVersion } from "../props/weather";

interface TailMesh {
  mesh: THREE.InstancedMesh;
  /** taban örnek sayısı (kuyruk bundan sonra başlar) */
  base: number;
  /** mesh kapasitesi (taban + kuyruk) */
  cap: number;
  /** taban yazımı (tam yükleme) bekliyor: bu karede aralık eklenmez, tam tampon gider */
  full: boolean;
  /** TOUR-VIEW: örnek başına titreşimli geçiş saati (`tailFade`; yoksa geçiş yok) */
  fade: THREE.InstancedBufferAttribute | null;
  /** örnek başına yapı bayrağı (`cutFix`; Block.fix → 1, yan kesit açmaz)*/
  fix: THREE.InstancedBufferAttribute | null;
  /** TOUR-VIEW: silinmekte olan aralıklar (süre dolunca sıfır matris) */
  dying: { start: number; size: number; at: number }[];
  /** kullanılan kuyruk ucu (`setTailEnd`); silinen aralıklar bitene kadar `count` bunun altına inmez */
  end: number;
}

const meshes = new Map<Group, TailMesh>();
let version = 0;

/**
 * TOUR-VIEW (POP-IN-001) — kuyruğa yazılan parsel bloklarının **titreşimli (dither) geçişi**: yeni yazılan örnek `TAIL_FADE_S`
 * boyunca ekran uzayı 4 × 4 Bayer deseniyle belirir, bırakılan örnek aynı sürede tümleyen desenle silinir (uzak LOD ↔ yakın ayrıntı
 * ↔ silüet çapraz geçişi; saydamlık sıralaması yok, opak kalır, +0 çizim çağrısı). Öznitelik değeri: 0 → hep görünür, > 0 →
 * belirme başlangıcı (sn), < 0 → silinme başlangıcı (−sn). Saat `fadeNow()`; gölgelendirici birimleri `tailFadeUniforms`.
 */
export const TAIL_FADE_S = 0.4;
/** Geçiş saati (sn; her zaman > 0 → işaret yönü taşır). */
export const fadeNow = () => performance.now() / 1000 + 1;
export const tailFadeUniforms = { uTailNow: { value: 1 }, uTailDur: { value: TAIL_FADE_S } };

/** Kuyruk kaydı değişince artar (akış bütün yuvaları yeniden yazar). */
export const tailVersion = () => version;
/** Grubun kuyruğu var mı (sahnede olmayan grup: yazım düşer, üreteç zaten `solid`'e indirir). */
export const hasTail = (g: Group) => meshes.has(g);

/** Blocks.tsx: taban yazıldıktan sonra (useLayoutEffect) çağrılır. Kuyruk sıfır matrisle gizlenir, `count` = taban. */
export function registerTail(group: Group, mesh: THREE.InstancedMesh, base: number, cap: number, fade: THREE.InstancedBufferAttribute | null = null,
  fix: THREE.InstancedBufferAttribute | null = null): void {
  (mesh.instanceMatrix.array as Float32Array).fill(0, base * 16, cap * 16);
  mesh.count = base;
  if (fade) { (fade.array as Float32Array).fill(0); fade.needsUpdate = true; }
  const t: TailMesh = { mesh, base, cap, full: true, fade, fix, dying: [], end: 0 };
  // tam yükleme bu karede gider; sonrasında yalnız değişen aralıklar
  mesh.onAfterRender = () => { t.full = false; };
  meshes.set(group, t);
  version++;
}

export function unregisterTail(group: Group, mesh: THREE.InstancedMesh): void {
  if (meshes.get(group)?.mesh !== mesh) return;
  meshes.delete(group);
  version++;
}

const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _c = new THREE.Color();

const colors = new Map<string, THREE.Color>();
let colorsVer = -1;
/**
 * blok rengi (mevsim tonu `tintHex` dahil) `out`'a — renk dizesi hex başına BİR kez ayrıştırılır (kare başına yazılan
 * taksi/araç/simge bloklarında `Color.set(string)` ayrıştırması ve `toUpperCase` dizesi GC baskısıydı). Ton eşlemi değişince
 * (`tintVersion`) önbellek boşalır; sonuç `new Color.set(tintHex(hex))` ile birebir aynı.
*/
export function blockColor(hex: string, out: THREE.Color): THREE.Color {
  if (colorsVer !== tintVersion()) { colors.clear(); colorsVer = tintVersion(); }
  let c = colors.get(hex);
  if (!c) {
    if (colors.size > 4096) colors.clear();
    c = new THREE.Color().set(tintHex(hex));
    colors.set(hex, c);
  }
  return out.copy(c);
}

/**
 * Kuyruk aralığı [offset, offset + size) — `blocks` (dünya çerçevesi) yazılır, kalan örnekler sıfır matrisle gizlenir.
 * Dönüş: yazılamayan blok sayısı (grup yok ya da yuva taşması).
 */
export function writeTail(group: Group, offset: number, size: number, blocks: readonly Block[], fadeIn = false): number {
  const t = meshes.get(group);
  if (!t) return blocks.length;
  const start = t.base + offset;
  if (start + size > t.cap) return blocks.length;
  const { mesh } = t;
  // TOUR-VIEW: üst üste binen silinme bekleyen aralıklar iptal (yuva yeniden yazıldı); geçiş özniteliği aralık boyunca
  if (t.dying.length) t.dying = t.dying.filter((d) => d.start + d.size <= start || d.start >= start + size);
  if (t.fade) {
    const fa = t.fade.array as Float32Array;
    fa.fill(fadeIn && blocks.length ? fadeNow() : 0, start, start + size);
    t.fade.needsUpdate = true;
    if (!t.full) t.fade.addUpdateRange(start, size); else t.fade.clearUpdateRanges();
  }
  const arr = mesh.instanceMatrix.array as Float32Array;
  const n = Math.min(size, blocks.length);
  const xa = t.fix?.array as Float32Array | undefined;
  for (let k = 0; k < size; k++) {
    const at = start + k;
    if (xa) xa[at] = k < n && blocks[k].fix ? 1 : 0;
    if (k >= n) { arr.fill(0, at * 16, at * 16 + 16); continue; }
    const b = blocks[k];
    _m.compose(_p.set(b.p[0], b.p[1], b.p[2]), _q.identity(), _s.set(b.s[0], b.s[1], b.s[2]));
    mesh.setMatrixAt(at, _m);
    blockColor(b.c, _c); // mevsim taç rengi (şehir haritası semt ağaçları, çevre arazisi)
    if (b.j) _c.offsetHSL(0, 0, (hash(b.p[0] * 13.1 + b.p[2] * 7.3 + b.p[1] * 3.7) - 0.5) * b.j * 2);
    mesh.setColorAt(at, _c);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  if (t.fix) t.fix.needsUpdate = true;
  if (!t.full) {
    mesh.instanceMatrix.addUpdateRange(start * 16, size * 16);
    mesh.instanceColor?.addUpdateRange(start * 3, size * 3);
    t.fix?.addUpdateRange(start, size);
  } else {
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceColor?.clearUpdateRanges();
    t.fix?.clearUpdateRanges();
  }
  return blocks.length - n;
}

/** E3: grubun kayıtlı kuyruk boyu (mesh kapasitesi − taban); kuyruk yoksa 0. İnşa bölgesi bu boyun akış + hayalet sonrası kısmıdır. */
export function tailSize(group: Group): number {
  const t = meshes.get(group);
  return t ? t.cap - t.base : 0;
}

/** Kullanılan kuyruk ucu: `mesh.count = taban + end` (TOUR-VIEW: silinmekte olan aralık bitene kadar onun ucu da sayılır). */
export function setTailEnd(group: Group, end: number): void {
  const t = meshes.get(group);
  if (!t) return;
  t.end = Math.max(0, end);
  applyCount(t);
}

function applyCount(t: TailMesh) {
  let hi = t.base + t.end;
  for (const d of t.dying) hi = Math.max(hi, d.start + d.size);
  t.mesh.count = Math.min(t.cap, hi);
}

/**
 * TOUR-VIEW: kuyruk aralığını titreşimli silerek boşalt — geçiş özniteliği olan mesh'te örnekler `TAIL_FADE_S` boyunca tümleyen
 * desenle kaybolur, süre dolunca (`tickTail`) sıfır matrise iner; özniteliksiz mesh'te hemen boşalır (`writeTail(…, [])`).
 */
export function releaseTail(group: Group, offset: number, size: number): void {
  const t = meshes.get(group);
  if (!t) return;
  const start = t.base + offset;
  if (start + size > t.cap) return;
  if (!t.fade || t.full) { writeTail(group, offset, size, []); return; }
  const fa = t.fade.array as Float32Array, now = fadeNow();
  fa.fill(-now, start, start + size);
  t.fade.needsUpdate = true;
  t.fade.addUpdateRange(start, size);
  t.dying = t.dying.filter((d) => d.start + d.size <= start || d.start >= start + size);
  t.dying.push({ start, size, at: now + TAIL_FADE_S });
}

let ticked = -1;
/** TOUR-VIEW: her kare (Blocks.tsx kuyruk mesh'leri; aynı kare içinde ikinci çağrı işlemez): geçiş saati + süresi dolan silinmeler. */
export function tickTail(): void {
  const now = fadeNow();
  if (now - ticked < 0.002) return;
  ticked = now;
  tailFadeUniforms.uTailNow.value = now;
  for (const t of meshes.values()) {
    if (!t.dying.length) continue;
    const due = t.dying.filter((d) => d.at <= now);
    if (!due.length) continue;
    t.dying = t.dying.filter((d) => d.at > now);
    const arr = t.mesh.instanceMatrix.array as Float32Array, fa = t.fade?.array as Float32Array | undefined;
    for (const d of due) {
      arr.fill(0, d.start * 16, (d.start + d.size) * 16);
      t.mesh.instanceMatrix.addUpdateRange(d.start * 16, d.size * 16);
      if (fa && t.fade) { fa.fill(0, d.start, d.start + d.size); t.fade.addUpdateRange(d.start, d.size); }
    }
    t.mesh.instanceMatrix.needsUpdate = true;
    if (t.fade) t.fade.needsUpdate = true;
    applyCount(t);
  }
}

/** TOUR-VIEW: yalnız denetim — grubun bekleyen silinme sayısı. */
export const tailDying = (group: Group) => meshes.get(group)?.dying.length ?? 0;
