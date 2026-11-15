/**
 * RENDER-FIX (kalite seferberliği §9 G1; ürün sahibi 2026-10-29: "hareketli nesneler … renk titreşimleri yapıyor"). Kutu modellerinde
 * z-fighting: iki kutunun AYNI yöne bakan yüzleri aynı düzlemde (ya da `ZF_EPS`'den yakın) üst üste biniyor ve renkleri (ya da
 * malzeme grupları) farklıysa derinlik tamponu her karede hangisinin önde olduğuna piksel piksel farklı karar verir → hareket eden
 * modelde renk titreşimi. Bu modül saf (three/React yok):
 *
 * - `zfights(boxes)`: çakışan yüz çiftleri (denetim: `scripts/zfight_check.mjs` REAL-ZFIGHT-001). Üst üste binen bölge üçüncü bir
 * kutunun içinde kalıyorsa (görünmez) sayılmaz.
 * - `dezfight(boxes)`: çiftleri çözer — KAZANAN yüz yerinde kalır, KAYBEDENİN yüzü içeri `ZF_GAP` çekilir (sınır kutusu değişmez;
 * kutu sayısı aynı). Kazanan: yüzü ötekinin yüzünün içinde kalan kutu (çıkartma/ayrıntı: pencere, kapı, far, teker); yüzü
 * ötekini bütünüyle örten kutu kaybeder (gövdeyi saran kuşak güverteyi boyamaz); kısmi örtüşmede küçük hacimli kutu kazanır.
 * Kaybeden kutu çekilemeyecek kadar inceyse kazanan dışarı itilir. Birkaç geçişte yakınsar (yeni çift doğarsa o da çözülür).
 *
 * Eşik: kamera yakın düzlemi 0,5, 24 bit derinlikte ayrım ≈ z² / (0,5 · 2²⁴): 0,004 ≈ 180 birime, 0,01 ≈ 290 birime kadar çözülür
 * (şehir sisi ≈ 96 birimde biter); daha yakın yüzler aynı düzlem sayılır.
*/

import { registerWaterAnchors } from "./waterAnchors";

/** Denetim ve çözüm için kutu: merkez `p`, ölçü `s`, `k` renk + malzeme anahtarı (aynı anahtar = aynı piksel, titreşim görünmez). */
export interface ZBox { p: number[]; s: number[]; k: string }
export interface ZFight { a: number; b: number; axis: 0 | 1 | 2; dir: 1 | -1; at: number; area: number }

/** Bu kadar yakın (yerel birim) aynı yönlü yüzler çakışık sayılır. */
export const ZF_EPS = 0.004;
/** Çözümde kaybeden yüz bu kadar içeri çekilir (`ZF_EPS`'den büyük: çözülen çift yeniden yakalanmaz). */
export const ZF_GAP = 0.01;
/** Bundan küçük ortak alan (yerel birim²) yok sayılır (kenar/köşe teması). */
export const ZF_MIN_AREA = 1e-4;

const lo = (b: ZBox, q: number) => b.p[q] - b.s[q] / 2;
const hi = (b: ZBox, q: number) => b.p[q] + b.s[q] / 2;
const TAN: readonly (readonly [number, number])[] = [[1, 2], [0, 2], [0, 1]];
const T = 1e-6;

function covered(boxes: readonly ZBox[], skipA: number, skipB: number, q: number, at: number, u: number, u0: number, u1: number, v: number, v0: number, v1: number): boolean {
  for (let c = 0; c < boxes.length; c++) {
    if (c === skipA || c === skipB) continue;
    const C = boxes[c];
    if (lo(C, q) < at && hi(C, q) > at && lo(C, u) <= u0 + T && hi(C, u) >= u1 - T && lo(C, v) <= v0 + T && hi(C, v) >= v1 - T) return true;
  }
  return false;
}

/** İki kutunun yüz çiftleri (a < b); `cover` örtü adayları (naif: bütün kutular; ızgara: a'nın komşuları). */
function pairFights(boxes: readonly ZBox[], a: number, b: number, eps: number, minArea: number, cover: readonly number[] | null, out: ZFight[], floor = -Infinity) {
  const A = boxes[a], B = boxes[b];
  if (A.k === B.k) return;
  for (let q = 0 as 0 | 1 | 2; q < 3; q = (q + 1) as 0 | 1 | 2) {
    const [u, v] = TAN[q];
    const u0 = Math.max(lo(A, u), lo(B, u)), u1 = Math.min(hi(A, u), hi(B, u));
    const v0 = Math.max(lo(A, v), lo(B, v)), v1 = Math.min(hi(A, v), hi(B, v));
    const area = Math.max(0, u1 - u0) * Math.max(0, v1 - v0);
    if (area < minArea) continue;
    for (const dir of [-1, 1] as const) {
      const fa = dir > 0 ? hi(A, q) : lo(A, q), fb = dir > 0 ? hi(B, q) : lo(B, q);
      if (Math.abs(fa - fb) >= eps) continue;
      // zemin düzlemindeki (ve altındaki) aşağı bakan yüz hiçbir kameradan görünmez (kamera hep üstte; arka yüz kırpılır)
      if (q === 1 && dir < 0 && Math.max(fa, fb) <= floor) continue;
      // bölge iki yüzün de hemen dışında başka bir kutunun içindeyse görünmez
      const at = dir > 0 ? Math.max(fa, fb) + eps : Math.min(fa, fb) - eps;
      if (cover ? coveredBy(boxes, cover, a, b, q, at, u, u0, u1, v, v0, v1) : covered(boxes, a, b, q, at, u, u0, u1, v, v0, v1)) continue;
      out.push({ a, b, axis: q, dir, at: (fa + fb) / 2, area });
    }
  }
}

function coveredBy(boxes: readonly ZBox[], list: readonly number[], skipA: number, skipB: number, q: number, at: number, u: number, u0: number, u1: number, v: number, v0: number, v1: number): boolean {
  for (const c of list) {
    if (c === skipA || c === skipB) continue;
    const C = boxes[c];
    if (lo(C, q) < at && hi(C, q) > at && lo(C, u) <= u0 + T && hi(C, u) >= u1 - T && lo(C, v) <= v0 + T && hi(C, v) >= v1 - T) return true;
  }
  return false;
}

/** bundan büyük listede süpürme elemesi; küçükte naif O(n²) (sonuç ikisinde de aynı, aynı sırada).*/
export const ZF_GRID_MIN = 64;

/**
 * kaba eleme (süpür ve buda): `pad` kadar şişirilmiş sınır kutuları kesişen kutuların komşu listeleri (iki yönlü,
 * artan sıra). Kutular en geniş yayılan yatay eksende alt kenara göre sıralanır; etkin listede yalnız o eksende hâlâ örtüşenler
 * kalır, diğer iki eksen doğrudan sınanır. O(n log n + n · etkin).
*/
export function zNeighbors(boxes: readonly ZBox[], pad: number): number[][] {
  const n = boxes.length;
  const out: number[][] = Array.from({ length: n }, () => []);
  if (!n) return out;
  const L = new Float64Array(n * 3), H = new Float64Array(n * 3);
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    const bx = boxes[i];
    for (let q = 0; q < 3; q++) {
      const l = bx.p[q] - bx.s[q] / 2 - pad, h = bx.p[q] + bx.s[q] / 2 + pad;
      L[i * 3 + q] = l; H[i * 3 + q] = h;
      if (l < mn[q]) mn[q] = l;
      if (h > mx[q]) mx[q] = h;
    }
  }
  const ax = mx[0] - mn[0] >= mx[2] - mn[2] ? 0 : 2, o1 = ax === 0 ? 1 : 0, o2 = ax === 0 ? 2 : 1;
  const order = Array.from({ length: n }, (_, i) => i).sort((x, y) => L[x * 3 + ax] - L[y * 3 + ax] || x - y);
  const active = new Int32Array(n);
  let na = 0;
  for (const i of order) {
    const li = L[i * 3 + ax], l1 = L[i * 3 + o1], h1 = H[i * 3 + o1], l2 = L[i * 3 + o2], h2 = H[i * 3 + o2];
    let w = 0;
    for (let k = 0; k < na; k++) {
      const j = active[k];
      if (H[j * 3 + ax] < li) continue;
      active[w++] = j;
      if (l1 <= H[j * 3 + o1] && L[j * 3 + o1] <= h1 && l2 <= H[j * 3 + o2] && L[j * 3 + o2] <= h2) { out[i].push(j); out[j].push(i); }
    }
    active[w++] = i;
    na = w;
  }
  for (const l of out) l.sort((x, y) => x - y);
  return out;
}

/** Aynı yöne bakan, (neredeyse) aynı düzlemde, örtüşen ve anahtarı farklı yüz çiftleri; örtüşmesi başka kutuyla örtülü olanlar hariç.
 * büyük listede ızgara elemesi (`zNeighbors`); sonuç ve sırası naif taramayla aynı.*/
export function zfights(boxes: readonly ZBox[], eps = ZF_EPS, minArea = ZF_MIN_AREA, floor = -Infinity): ZFight[] {
  const out: ZFight[] = [];
  if (boxes.length <= ZF_GRID_MIN) {
    for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) pairFights(boxes, a, b, eps, minArea, null, out, floor);
    return out;
  }
  const nb = zNeighbors(boxes, eps * 2);
  for (let a = 0; a < boxes.length; a++) for (const b of nb[a]) if (b > a) pairFights(boxes, a, b, eps, minArea, nb[a], out, floor);
  return out;
}

const vol = (b: ZBox) => b.s[0] * b.s[1] * b.s[2];

/** Yüzü q ekseninde `dir` yönünde `to` konumuna taşı (karşı yüz yerinde kalır). */
function moveFace(b: ZBox, q: number, dir: 1 | -1, to: number) {
  const other = dir > 0 ? lo(b, q) : hi(b, q);
  b.s[q] = Math.abs(to - other);
  b.p[q] = (to + other) / 2;
}

/** X'in q eksenine dik yüzü Y'ninkini teğet yönlerde bütünüyle kapsıyor mu? */
function faceContains(X: ZBox, Y: ZBox, q: number): boolean {
  const [u, v] = TAN[q];
  return lo(X, u) <= lo(Y, u) + T && hi(X, u) >= hi(Y, u) - T && lo(X, v) <= lo(Y, v) + T && hi(X, v) >= hi(Y, v) - T;
}
const faceArea = (b: ZBox, q: number) => { const [u, v] = TAN[q]; return b.s[u] * b.s[v]; };

/**
 * Çiftleri yerinde çözer (kutular değiştirilir); dönüş: kalan çift sayısı (0 = temiz). Kutu sayısı aynı; yüz kayması `ZF_GAP` katı.
 * düzlem kümesi başına KADEMELEME (eski ikili çözüm uzun zincirde — kaya yığını, basamak, çok pencereli cephe — 8 geçişte
 * bitmiyordu): aynı eksen ve yöndeki çakışma çizgesinde kutular yüz alanına göre (küçük önce; eşitse küçük hacim, sonra sonra
 * eklenen) sıralanır. Kademe 0 yerinde; kademe L yüzü L × `ZF_GAP` içeri. Bir yüz, içinde kalan (kapsadığı) her komşu yüzün
 * ARKASINDA olur (pencere, çıkartma, çatı kaplaması önde kalır: kademesi onlarınkinden büyük); kısmi örtüşen komşulardan yalnız
 * FARKLI kademe alır (hangisinin önde olduğu görünüşü değiştirmez — en küçük boş kademe; derinlik sığ kalır). Çekilemeyecek kadar
 * ince kutu yerinde kalır, önündeki komşuları dışarı itilir. Doğan yeni çift sonraki geçişte; yüz yönü bir kez seçilir (salınım
 * yok). Büyük listede komşuluk bir kez (pay `NB_REACH`), yalnız oynayan kutuların çevresi yeniden sınanır.
*/
const NB_REACH = 0.06;
export function dezfight(boxes: ZBox[], passes = 24, floor = -Infinity): number {
  const big = boxes.length > ZF_GRID_MIN;
  const pad = ZF_EPS * 2 + NB_REACH;
  let nb = big ? zNeighbors(boxes, pad) : null;
  const all = (): ZFight[] => {
    if (!nb) return zfights(boxes, ZF_EPS, ZF_MIN_AREA, floor);
    const o: ZFight[] = [];
    for (let a = 0; a < boxes.length; a++) for (const b of nb[a]) if (b > a) pairFights(boxes, a, b, ZF_EPS, ZF_MIN_AREA, nb[a], o, floor);
    return o;
  };
  let fights = all();
  let grown = new Float64Array(boxes.length);
  // yüz başına ilk hareket yönü (+1 dışarı, −1 içeri): ince yüz bir geçişte dışarı, sonra içeri gidip yerine dönmesin (salınım yok)
  const went = new Map<number, number>();
  for (let pass = 0; pass < passes && fights.length; pass++) {
    // eksen + yön başına çakışma çizgesi
    const graphs = new Map<number, Map<number, number[]>>();
    for (const f of fights) {
      const key = f.axis * 2 + (f.dir > 0 ? 1 : 0);
      let g = graphs.get(key);
      if (!g) { g = new Map(); graphs.set(key, g); }
      (g.get(f.a) ?? g.set(f.a, []).get(f.a)!).push(f.b);
      (g.get(f.b) ?? g.set(f.b, []).get(f.b)!).push(f.a);
    }
    const touched = new Set<number>();
    let rebuild = false;
    const move = (i: number, q: number, dir: 1 | -1, fk: number, to: number, out: boolean) => {
      const from = dir > 0 ? hi(boxes[i], q) : lo(boxes[i], q);
      if (out && (from - to) * dir >= -1e-9) return; // zaten o kadar önde
      moveFace(boxes[i], q, dir, to);
      went.set(fk, out ? 1 : -1);
      touched.add(i);
      if (out && (grown[i] += Math.abs(to - from)) > NB_REACH - ZF_GAP * 2) rebuild = true;
    };
    // iki evre: bütün düzlem kümelerinin kademeleri geçişin BAŞINDAKİ geometriyle hesaplanır, hareketler sonra uygulanır (bir
    // eksendeki çekilme öbür eksendeki yüz kapsamasını bozup eş yüzleri zincire çevirmesin)
    const snap = new Map<number, ZBox>();
    const S = (i: number) => { let b = snap.get(i); if (!b) { b = { p: [...boxes[i].p], s: [...boxes[i].s], k: boxes[i].k }; snap.set(i, b); } return b; };
    for (const g of graphs.values()) for (const i of g.keys()) S(i);
    const plan: [number, number, 1 | -1, number, number, boolean][] = [];
    for (const [key, g] of graphs) {
      const q = key >> 1, dir: 1 | -1 = key & 1 ? 1 : -1;
      const face = (i: number) => (dir > 0 ? hi(S(i), q) : lo(S(i), q));
      const nodes = [...g.keys()].map((i) => ({ i, a: faceArea(S(i), q), v: vol(S(i)) }));
      nodes.sort((x, y) => x.a - y.a || x.v - y.v || y.i - x.i);
      // önde olması gereken (katı sıra): yüzü ötekinin içinde kalan ayrıntı; kısmi örtüşmede gövdesi en az iki kat derin olan (ince
      // pervaz/kuşak gövdenin rengini boyamaz — katedral davul tepesi: kırmızı gövde, ondan biraz geniş beyaz pervaz). Geri kalanı
      // yalnız farklı kademe. Sıra: katı ilişkilere göre topolojik (eşitlikte küçük yüz alanı, küçük hacim, sonra eklenen).
      const rank = new Map(nodes.map((n, k) => [n.i, k]));
      const front = (i: number, j: number): boolean => { // i, j'nin önünde mi (katı)
        const jInI = faceContains(S(i), S(j), q), iInJ = faceContains(S(j), S(i), q);
        if (iInJ !== jInI) return iInJ;
        if (iInJ) return false; // eş yüz: sıra serbest
        const ti = S(i).s[q] <= ZF_GAP * 2.5, tj = S(j).s[q] <= ZF_GAP * 2.5;
        if (ti !== tj) return ti; // çekilemeyecek kadar ince (çıkartma) önde
        return S(i).s[q] >= S(j).s[q] * 2;
      };
      const indeg = new Map<number, number>(nodes.map((n) => [n.i, 0]));
      for (const { i } of nodes) for (const j of g.get(i)!) if (front(i, j)) indeg.set(j, indeg.get(j)! + 1);
      const order: number[] = [], done = new Set<number>();
      const ready = nodes.filter((n) => !indeg.get(n.i)).map((n) => n.i);
      while (order.length < nodes.length) {
        if (!ready.length) { const rest = nodes.find((n) => !done.has(n.i))!; ready.push(rest.i); } // döngü: sıradaki
        ready.sort((x, y) => rank.get(x)! - rank.get(y)!);
        const i = ready.shift()!;
        if (done.has(i)) continue;
        done.add(i); order.push(i);
        for (const j of g.get(i)!) if (!done.has(j) && front(i, j)) { const d = indeg.get(j)! - 1; indeg.set(j, d); if (d === 0) ready.push(j); }
      }
      const level = new Map<number, number>();
      for (const i of order) {
        const used = new Set<number>();
        let need = 0, hidden = Infinity;
        for (const j of g.get(i)!) {
          const lv = level.get(j);
          if (lv === undefined) continue;
          // yüzü önceki bir komşunun yüzünün içinde (ya da eşi) ve o kutu kalın: bir kademe arkasına → onun gövdesinde gizli
          // (gizli yüzler birbiriyle çakışsa da görünmez: örtülü sayılır) — eş yüzlü yığında derinlik 1'de kalır
          if (faceContains(S(j), S(i), q) && S(j).s[q] - lv * ZF_GAP > ZF_GAP * 2 + ZF_EPS) hidden = Math.min(hidden, lv + 1);
          if (front(j, i)) need = Math.max(need, lv + 1); else used.add(lv);
        }
        if (hidden < Infinity && hidden >= need) { level.set(i, hidden); continue; }
        while (used.has(need)) need++;
        level.set(i, need);
      }
      const thin: number[] = [];
      for (const [i, lv] of level) {
        if (!lv) continue;
        const fk = i * 6 + key;
        if (went.get(fk) !== 1 && S(i).s[q] - lv * ZF_GAP >= ZF_GAP / 2) plan.push([i, q, dir, fk, face(i) - dir * lv * ZF_GAP, false]);
        else thin.push(i);
      }
      // ince (ya da önceden dışarı itilmiş) yüz yerinde: önünde olması gereken komşular onun ZF_GAP önüne
      for (const i of thin) {
        const lv = level.get(i)!, f = face(i);
        for (const j of g.get(i)!) if (level.get(j)! < lv) plan.push([j, q, dir, j * 6 + key, f + dir * ZF_GAP, true]);
      }
    }
    for (const [i, q, dir, fk, to, out] of plan) move(i, q, dir, fk, to, out);
    if (!nb || rebuild) { if (nb) nb = zNeighbors(boxes, pad); grown = new Float64Array(boxes.length); fights = all(); continue; }
    const dirty = new Set<number>(touched);
    for (const t of touched) for (const n of nb[t]) dirty.add(n);
    const next = fights.filter((f) => !dirty.has(f.a) && !dirty.has(f.b));
    for (const a of dirty) for (const b of nb[a]) {
      if (dirty.has(b) && b < a) continue; // iki ucu da kirli çift bir kez
      const l2 = Math.min(a, b), h2 = Math.max(a, b);
      pairFights(boxes, l2, h2, ZF_EPS, ZF_MIN_AREA, nb[l2], next, floor);
    }
    fights = next;
  }
  return nb ? fights.length : zfights(boxes, ZF_EPS, ZF_MIN_AREA, floor).length;
}

/** Blok listesini çözülmüş KOPYA olarak döndürür (anahtar: malzeme grubu + renk; girdi değişmez, çift yoksa aynı dizi). */
export function dezfightBlocks<B extends { p: readonly number[] | number[]; s: readonly number[] | number[]; c: string; g: string }>(blocks: B[]): B[] {
  const bs: ZBox[] = blocks.map((b) => ({ p: [...b.p], s: [...b.s], k: `${b.g}|${b.c.toLowerCase()}` }));
  if (!zfights(bs).length) return blocks;
  dezfight(bs);
  return blocks.map((b, i) => ({ ...b, p: bs[i].p as B["p"], s: bs[i].s as B["s"] }));
}

/**
 * (ürün sahibi 2026-10-30: "<city>'da … her yerde bu modeller üzerinde renkler titreşiyor") — DURAĞAN modeller için merkezi
 * çözüm. Çizime giden her blok listesi (taban sahne `Blocks`, iç mekân, şehir haritası/çevre parseli akışı, yüksek çözünürlüklü
 * simge katmanı) çizilmeden önce bundan geçer; liste başına bir kez (dizi kimliğine göre önbellek), kare başına değil.
 *
 * Ayrım (titreşim yalnız birbirine göre DURAN yüzler arasında kalıcıdır):
 * - durağan sınıf: `solid`, `glow`, `glass` (+ `water`, `waterMoves` kapalıysa — yüksek çözünürlük katmanında su kıpırdamaz);
 * - `water` (`Blocks`/kuyrukta tüm ağ birlikte ±0,04 sallanır: kendi içinde durağan), `flame` (ağ ölçeklenir) ayrı sınıf;
 * - `spin`: aynı dönme tanımını (eksen, pivot, hız, faz, kabin askısı) paylaşan bloklar birlikte döner → tanım başına sınıf;
 * - `wave`, `bob`, `flag`, `snow`, `cloud`: örnek başına ayrı hareket — kalıcı çakışma yok, dokunulmaz.
 * Anahtar: malzeme grubu + renk; renk titreşimli (`j > 0`) blok örnek başına farklı ton alır → her biri kendi anahtarı.
 * Dönüş: çakışma yoksa AYNI dizi; varsa değişen bloklar kopya (yüz ≤ `ZF_GAP` içeri), değişmeyenler aynı nesne, sıra ve sayı aynı.
*/
export interface DrawBlock { p: readonly number[] | number[]; s: readonly number[] | number[]; c: string; g: string; j?: number; r?: unknown }
/** `anchors: false`: yalnız önbelleği ısıt — su damla kaynakları kaydedilmez (gerçek çizim çağrısı kaydeder).*/
export interface DrawOpts { waterMoves?: boolean; anchors?: boolean }
const STILL = new Set(["wave", "bob", "flag", "snow", "cloud"]);
/** Çizim sınıfı (aynı sınıftaki bloklar birbirine göre durur); null = örnek başına hareket (çakışma kalıcı değil). */
export function drawClass(b: DrawBlock, waterMoves = true): string | null {
  if (STILL.has(b.g)) return null;
  if (b.g === "spin") return `spin:${JSON.stringify(b.r ?? null)}`;
  if (b.g === "flame") return "flame";
  // CEOGOZU (ürün sahibi: "dere yolunda su yüzeyi titriyor"): su artık sallanmaz (Blocks.tsx: akış doku kayması, mesh konumu sabit) → su da
  // durağan sınıfta; su yüzü ile zemin/kıyı/köprü/başka su katmanı çakışması aynı düzlem çözümüyle giderilir. `waterMoves` geriye uyum için kalır.
  void waterMoves;
  return "static";
}
/** Çizim anahtarı (aynı anahtar = aynı piksel rengi): grup + renk; titreşimli blok tekil. */
export const drawKey = (b: DrawBlock, i: number): string => (b.j ? `${b.g}|${b.c.toLowerCase()}|j${i}` : `${b.g}|${b.c.toLowerCase()}`);
/** Bir blok listesini sınıflarına ayırıp ZBox listeleri (denetim ve çözüm aynı ayrımı kullanır). */
export function drawGroups(blocks: readonly DrawBlock[], opts: DrawOpts = {}): { idx: number[]; boxes: ZBox[] }[] {
  const m = new Map<string, { idx: number[]; boxes: ZBox[] }>();
  blocks.forEach((b, i) => {
    const cls = drawClass(b, opts.waterMoves ?? true);
    if (!cls) return;
    let e = m.get(cls);
    if (!e) { e = { idx: [], boxes: [] }; m.set(cls, e); }
    e.idx.push(i); e.boxes.push({ p: [b.p[0], b.p[1], b.p[2]], s: [b.s[0], b.s[1], b.s[2]], k: drawKey(b, i) });
  });
  return [...m.values()];
}
/** Dünya çerçevesindeki durağan listede bu yükseklikte ve altında aşağı bakan yüz hiç görünmez (kamera her kipte zeminin üstünde:
 *  yürüyüş/fotoğraf ≥ 0,35, yörünge kutup açısı < 90°; aşağı bakan yüzü yalnız altından bakan görür, üstten arka yüz kırpılır). */
export const ZF_FLOOR = 0.02;
/** Çizilen listede kalan çakışma sayısı (denetim). */
export function drawFights(blocks: readonly DrawBlock[], opts: DrawOpts = {}): number {
  let n = 0;
  for (const g of drawGroups(blocks, opts)) n += zfights(g.boxes, ZF_EPS, ZF_MIN_AREA, ZF_FLOOR).length;
  return n;
}
/**
 * (ürün sahibi: "Şehir içi dere yolunda su da flicker var … bu tür hataları yapma"): `wave` blok örnek başına ±`WAVE_AMP`
 * sallanır (Blocks.tsx `waveY` = 0,07 + 0,03). Sallanma aralığı bir taşın ya da durağan suyun içine giriyorsa yüzleri her döngüde
 * birbirinin içinden geçer (köpük kıyı taşından/su yüzünden geçip titrer). Böyle blok çizimde durağan `water` olur (akış doku
 * kayması `waterFlow.ts` sürer); açıklığı olan sallanmaya devam eder. Denetim: `scripts/waterfix1.test.mjs`.
*/
export const WAVE_AMP = 0.1;
const FIRM = new Set(["solid", "water"]);
/** `w` (wave) sallanma aralığıyla `s`'nin içine girer mi (yatayda kesin örtüşme; kenar teması değil). */
export function waveHits(w: DrawBlock, s: DrawBlock): boolean {
  for (let k = 0; k < 3; k++) if (Math.abs(w.p[k] - s.p[k]) >= (w.s[k] + s.s[k]) / 2 + (k === 1 ? WAVE_AMP : 0) - 1e-4) return false;
  return true;
}
/** Taş/suya giren `wave` blokları durağan `water` yapar; yoksa AYNI dizi. Durağanlaşan su tabanı üstündeki köpüğü de
 *  durağanlaştırır (değişmeyene dek tekrar). */
export function stillWaves<B extends DrawBlock>(blocks: readonly B[]): readonly B[] {
  let out: B[] | null = null;
  for (let changed = true; changed;) {
    changed = false;
    const cur: readonly B[] = out ?? blocks;
    if (!cur.some((b) => b.g === "wave")) break;
    const firm = cur.filter((b) => FIRM.has(b.g));
    cur.forEach((b, i) => {
      if (b.g !== "wave" || !firm.some((s) => waveHits(b, s))) return;
      out ??= blocks.slice();
      out[i] = { ...b, g: "water" };
      changed = true;
    });
  }
  return out ?? blocks;
}
/**
 * (ürün sahibi: sallanan nesne taşın içinden geçmesin): `bob` blok (tekne, nilüfer, yosun, balık, buhar) örnek başına dikeyde
 * ±`BOB_AMP` (Blocks.tsx `waveY` 0,1 × 1,2) sallanır. Sallanma aralığı bir `solid`a giren blok çizimde durağan `solid` olur; o bloğa
 * değen/örtüşen `bob` komşuları da (aynı gövde: yosun sapı, tekne) birlikte durur ki parçalar birbirinden ayrılmasın. Açıkta olan
 * (suda/havada) nesne sallanmaya devam eder. Veri tarafı elle düzeltilir; bu yalnız sınıfı kapatan emniyet. Denetim: `bobfix1.test.mjs`.
*/
export const BOB_AMP = 0.12;
const BOB_JOIN = 0.005; // yalnız değen/örtüşen parçalar bir gövde (zincirleme yayılma yok)
export function bobHits(w: DrawBlock, s: DrawBlock): boolean {
  for (let k = 0; k < 3; k++) if (Math.abs(w.p[k] - s.p[k]) >= (w.s[k] + s.s[k]) / 2 + (k === 1 ? BOB_AMP : 0) - 1e-4) return false;
  return true;
}
export function stillBobs<B extends DrawBlock>(blocks: readonly B[]): readonly B[] {
  const ids: number[] = [];
  blocks.forEach((b, i) => { if (b.g === "bob") ids.push(i); });
  if (!ids.length) return blocks;
  const solids = blocks.filter((b) => b.g === "solid");
  const par = ids.map((_, i) => i);
  const find = (i: number): number => (par[i] === i ? i : (par[i] = find(par[i])));
  for (let a = 0; a < ids.length; a++) for (let c = a + 1; c < ids.length; c++) {
    const u = blocks[ids[a]], v = blocks[ids[c]];
    if ([0, 1, 2].every((k) => Math.abs(u.p[k] - v.p[k]) <= (u.s[k] + v.s[k]) / 2 + BOB_JOIN)) par[find(a)] = find(c);
  }
  const stop = new Set<number>();
  ids.forEach((id, a) => { if (solids.some((s) => bobHits(blocks[id], s))) stop.add(find(a)); });
  if (!stop.size) return blocks;
  const out = blocks.slice();
  ids.forEach((id, a) => { if (stop.has(find(a))) out[id] = { ...blocks[id], g: "solid" }; });
  return out;
}
const drawnCache = new WeakMap<readonly DrawBlock[], { water: DrawBlock[] | null; still: DrawBlock[] | null }>();
/** `?zfix=0` adres parametresi merkezi çözümü kapatır (önce/sonra karşılaştırması ve acil geri dönüş). Node'da açık.*/
export const ZFIX_ENABLED: boolean = typeof location === "undefined" || new URLSearchParams(location.search).get("zfix") !== "0";
/** Çizime hazır liste (önbellekli; girdi değişmez). */
export function drawnBlocks<B extends DrawBlock>(blocks: readonly B[], opts: DrawOpts = {}): B[] {
  if (opts.anchors !== false) registerWaterAnchors(blocks); // CEOGOZU: çeşme/şelale damla kaynakları (waterAnchors.ts; liste başına bir kez)
  if (!ZFIX_ENABLED || blocks.length < 2) return blocks as B[];
  const wm = opts.waterMoves ?? true;
  let e = drawnCache.get(blocks);
  if (!e) { e = { water: null, still: null }; drawnCache.set(blocks, e); }
  const hit = wm ? e.water : e.still;
  if (hit) return hit as B[];
  const src = stillBobs(stillWaves(blocks)); // önce taşa/suya giren dalga durağan su olur (sonra o da düzlem çözümüne girer)
  let out: B[] | null = src === blocks ? null : (src as B[]);
  for (const g of drawGroups(src, opts)) {
    if (g.boxes.length < 2) continue;
    dezfight(g.boxes, 24, ZF_FLOOR);
    g.idx.forEach((i, k) => {
      const b = src[i], z = g.boxes[k];
      if (z.p[0] === b.p[0] && z.p[1] === b.p[1] && z.p[2] === b.p[2] && z.s[0] === b.s[0] && z.s[1] === b.s[1] && z.s[2] === b.s[2]) return;
      out ??= blocks.slice();
      out[i] = { ...b, p: z.p as B["p"], s: z.s as B["s"] };
    });
  }
  const res = out ?? (blocks as B[]);
  if (wm) e.water = res; else e.still = res;
  return res;
}

/** Sahne hareketlisi parçaları [x, y, z, w, h, d, renk] için aynı çözüm (tek malzeme; anahtar renk adı ya da hex). */
export function dezfightParts<P extends [number, number, number, number, number, number, string]>(parts: readonly P[]): P[] {
  const bs: ZBox[] = parts.map(([x, y, z, w, h, d, c]) => ({ p: [x, y, z], s: [w, h, d], k: c }));
  if (!zfights(bs).length) return parts as P[];
  dezfight(bs);
  return parts.map((pt, i) => [bs[i].p[0], bs[i].p[1], bs[i].p[2], bs[i].s[0], bs[i].s[1], bs[i].s[2], pt[6]] as P);
}

/**
 * RENDER-FIX: güneş gölgesinin normal kayması gölge haritası texeline göre (texel = 2 · yarı genişlik / harita; kayma 1,4 texel, en az
 * eski sabit 0,02). Gölge çerçevesi dünyanın sınırından kurulur (World.tsx); geniş dünyada texel 0,02'den büyük kalınca hareket eden
 * aracın ışığa yan duran yüzlerinde kayan "sivilce" (acne) deseni çıkıyordu. 2048 haritada yarı genişlik 14 → 0,02 (değişmez).
 */
export const sunNormalBias = (half: number, mapSize = 2048) => Math.max(0.02, ((2 * half) / mapSize) * 1.4);
