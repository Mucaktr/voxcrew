/**
 * (ürün sahibi 2026-11-02: "ada kulesinin tepesinde avatar kulenin değil gri bir kutunun cam korkuluklu çatısında; yapı
 * suyun altında; pencere yok; çevre bej kutular") — şehir landmarkı açık hava katının (seyir galerisi, kule terası, zirve, çatı
 * terası) GERÇEK simge ve GERÇEK şehir üstünde durması.
 *
 * Kök neden (eski yol): şehir iç mekânı ayrı sahnedir; güverte katı (`cityInteriorPlan`) altına simge yerine tek gri kutu
 * (`levelSupport`: ayak izi boyunca katı blok + 0,04'lük koyu şeritler), çevresine şehir yerine ucuz silüet halkası (`cityPanoBlocks`:
 * bej kutu sıraları) çiziyordu; deniz düzlemi (`envFor`) kat inişini (`cityPano.elev`) hiç saymadığı için döşemenin 0,42 altında
 * duruyor, kutunun gövdesi suyun içinde kalıyordu.
 *
 * Yeni yol (yalnız şehir haritası landmarkının açık hava katı; iç katlar ve taban sahne değişmez):
 * - **Simge gövdesi:** landmarkın kendi modeli (kayıtlıysa hi-res `hi`, değilse şehirde çizilen orta model `near`) tek bir benzerlik
 * dönüşümüyle (ölçek `k`, öteleme) güvertenin altına konur: modelin kendi seyir yüzeyi (`deckY`, modelin yükseklik haritasından
 * en üstteki açık, geniş yüzey — galeri, balkon, fener altı halka, kapsül çatısı, çatı terası) döşemeyle (y 0) çakışır. Güverte
 * ayak izinin üstüne çıkan model parçası (fener, külah, kapsül tepesi) katın kendi geometrisine bırakılır; dışında kalan parça durur.
 * - **Ölçek:** `k` = güverte açıklığı / modelin güverte hizasındaki açıklığı, [K_MIN, K_MAX] aralığında. Güverte modelden genişse
 * aradaki pay modelin rengiyle kademeli konsol eteği olur (balkon konsolu; "gerektiğinde yürünebilir güverte uzantısı").
 * - **Zemin / su:** model tabanı (y 0) ve şehir aynı dönüşümle iner: ada, rıhtım, sokak modelin altında, deniz düzlemi (`seaY`)
 * şehrin deniz yüzüyle (CITY_SEA_Y) aynı yerde — hiçbir gövde suyun altına girmez.
 * - **Çevre:** şehrin GERÇEK parsel blokları (`districtParcel` yakın LOD; akışla aynı önbellek) `DECK_RADIUS` karo içinde, kayıtlı
 * simgeler hi-res (`hiresMapItems`): kubbe, minare, köprü kulesi, çatılar gerçek silüetleriyle. Aynı dönüşüm → ölçek tutarlı.
 * Hareketli gruplar (bayrak, dalga, duman, bulut) panoramaya girmez (durağan).
 *
 * Saf modül (React/three yok), belirlenimci, önbellekli. Denetim: scripts/towerdeck_check.mjs (TOWER-DECK-IDENTITY-001,
 * TOWER-DECK-GROUND-001, VIEW-LOD-001).
*/
import { tx, tz, type Block, type Group } from "../scenes";
import { FULL_DECK_AT } from "../../full/towerDeck";
import { CITY_MAPS } from "../citymap/catalog";
import { designOf } from "../citymap/designs";
import { districtParcel, districtPlan } from "../citymap/district";
import { parcelDistrict } from "../citymap/source";
import { CITY_PD, CITY_PW, type CityMapFile } from "../citymap/format";
import { cityX, cityZ } from "../transit/model";
import { hiresMapItems } from "../hires/items";
import { CITY_SEA_Y } from "../citymap/shell";
import { cityBoundary, cityFiller } from "../citymap/horizon";
import { infoForSceneZone } from "../citymap/landmarkInfo";

/** Ölçek aralığı: altında güverte simgeyi taşır, üstünde pencereler avatarın birkaç katı olur (yürüme ölçeği düzeltmesi). */
export const K_MIN = 1.4;
export const K_MAX = 2;
/** Güverte çevresinde çizilen şehir yarıçapı (şehir karosu; simge merkezinden): bütün harita, kameranın uzak düzlemi (400) ölçekle sınırlar. */
export const DECK_RADIUS = 200;
export const DECK_FAR = 390;
export const deckRadius = (k: number) => Math.min(DECK_RADIUS, DECK_FAR / k);
/** Panoramaya giren durağan gruplar. */
const STATIC: ReadonlySet<Group> = new Set<Group>(["solid", "glass", "glow", "water"]);

export interface TowerDeck {
  city: string;
  district: string;
  landmark: string;
  /** modelin seyir yüzeyi (model birimi, şehir zemini 0) */
  deckY: number;
  /** model güverte hizası açıklığı (model birimi) ve merkezi (şehir dünyası) */
  span: number;
  mx: number;
  mz: number;
  /** simge gövdesinin ölçeği (güverte döşemesi simgenin güverte hizası açıklığına sığar → `kc`'den büyük olabilir)*/
  k: number;
  /** çevre şehrin ölçeği (eski `k`: [K_MIN, K_MAX]) — şehir gövdenin tabanına (groundY) oturur*/
  kc: number;
  /** güverte katı merkezi (kat dünyası) */
  lx: number;
  lz: number;
  /** kat çerçevesinde şehir zemini (sokak) ve deniz yüzü */
  groundY: number;
  seaY: number | null;
  /** hi-res model mi */
  hires: boolean;
  /** model blokları (şehir dünyası) */
  model: Block[];
}

const CITY_SITE = /^city_([a-z0-9_]+?)__([a-z0-9_]+?)__([a-z0-9_]+)$/;
const NO_DECK = new Set(["pier", "courtyard"]);

type LevelLike = { key: string; scene?: string; site: string; index?: number; kind: string; outdoor: boolean; name?: string; storey?: number; pano?: { drop: number } | null; built: { width: number; depth: number; blocked?: ReadonlySet<string> }; cityPano?: { elev: number } | null };

/** Landmarkın modeli (şehir dünyası): kayıtlıysa hi-res, değilse orta model. */
export function landmarkModel(map: CityMapFile, district: string, landmark: string): { blocks: Block[]; hires: boolean; rect: [number, number, number, number] } | null {
  const hi = hiresMapItems(map).find((it) => it.landmark === landmark && it.district === district);
  if (hi) return { blocks: hi.hi(), hires: true, rect: hi.rect as [number, number, number, number] };
  const dist = map.districts.find((d) => d.id === district);
  const design = designOf(map.id);
  if (!dist || !design) return null;
  const plan = districtPlan(map, dist);
  const lm = plan.landmarks.find((x) => x.id === landmark);
  const model = lm ? design.landmarks[lm.id] : null;
  if (!lm || !model) return null;
  const ox = cityX(plan.i0) - 0.5, oz = cityZ(plan.j0) - 0.5;
  const ctx = { x0: ox + lm.i0, z0: oz + lm.j0, w: lm.w, d: lm.d, h: lm.h, cx: ox + lm.i0 + lm.w / 2, cz: oz + lm.j0 + lm.d / 2 };
  return { blocks: model.near(ctx), hires: false, rect: [ctx.x0, ctx.z0, ctx.x0 + lm.w, ctx.z0 + lm.d] };
}

/**
 * Simgenin GERÇEK seyir yüzeyi (model birimi; `<şehir>/<landmark>#<kat dizini>`): modelin yükseklik haritasındaki açık yüzlerden, yapının
 * gerçekte sahip olduğu güverteye göre seçildi (gerçek yükseklik oranı ve model kesitine bakılarak). Birden çok seyir katı olan
 * kulede (kafes kuleler) her kat kendi platformuna oturur (`#<kat>`); tek güverteli kulede anahtar katsızdır. Tabloda olmayan kat
 * `modelDeck` sezgisini kullanır.
 */
export const DECK_AT: Readonly<Record<string, number>> = {
  ...FULL_DECK_AT,
  "istanbul/kiz_kulesi#1": 7.3, // fener odasının çevresindeki galeri (külah kademesi değil)
  "istanbul/galata_kulesi#2": 10.5, // konsollu seyir galerisi, konik külahın altında
  "istanbul/rumeli_hisari#1": 8.55, // sur yürüyüş yolu
  "londra/saat_kulesi#2": 11.1, // saat kadranlarının üstündeki çan katı
  "kapadokya/uchisar_kalesi#2": 21.0, // kaya zirvesi
  "kapadokya/uchisar_kalesi#1": 21.0, // taban sahne kalesinin güvertesi (iki katlı tarif) aynı kaya zirvesinde
};

const STEP = 0.1;
/**
 * Modelin seyir yüzeyi: 0,1'lik yükseklik haritasında en üstteki AÇIK (üstü kapalı olmayan) ve yeterince geniş düzlem. Yükseklik
 * haritası en üst yüzü verir, böylece fener/külah altında kalan halka yalnız açık kısmıyla sayılır. Eşik: ayak izi kutusunun
 * %8'i (en az 0,6 m²) ve modelin yarı yüksekliğinin üstü. Açıklık: o hizada ve üstünde kalan hücrelerin kapsadığı kutu.
 */
export function modelDeck(blocks: readonly Block[], fixed?: number): { deckY: number; span: number; mx: number; mz: number; sx: number; sz: number } | null {
  const solid = blocks.filter((b) => b.g !== "water" && b.g !== "cloud" && b.g !== "snow" && b.s[0] > 0.01 && b.s[2] > 0.01);
  if (!solid.length) return null;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, top = 0;
  for (const b of solid) {
    x0 = Math.min(x0, b.p[0] - b.s[0] / 2); x1 = Math.max(x1, b.p[0] + b.s[0] / 2);
    z0 = Math.min(z0, b.p[2] - b.s[2] / 2); z1 = Math.max(z1, b.p[2] + b.s[2] / 2);
    top = Math.max(top, b.p[1] + b.s[1] / 2);
  }
  const nx = Math.max(1, Math.ceil((x1 - x0) / STEP)), nz = Math.max(1, Math.ceil((z1 - z0) / STEP));
  const hm = new Float32Array(nx * nz);
  for (const b of solid) {
    const t = b.p[1] + b.s[1] / 2;
    const i0 = Math.max(0, Math.floor((b.p[0] - b.s[0] / 2 - x0) / STEP + 0.5)), i1 = Math.min(nx - 1, Math.floor((b.p[0] + b.s[0] / 2 - x0) / STEP - 0.5));
    const k0 = Math.max(0, Math.floor((b.p[2] - b.s[2] / 2 - z0) / STEP + 0.5)), k1 = Math.min(nz - 1, Math.floor((b.p[2] + b.s[2] / 2 - z0) / STEP - 0.5));
    for (let i = i0; i <= i1; i++) for (let k = k0; k <= k1; k++) if (t > hm[k * nx + i]) hm[k * nx + i] = t;
  }
  // yükseklik kovaları (0,15): açık yüz alanı
  const bucket = new Map<number, number>();
  for (const h of hm) if (h > 0) { const q = Math.round(h / 0.15); bucket.set(q, (bucket.get(q) ?? 0) + STEP * STEP); }
  const need = Math.max(0.6, 0.15 * (x1 - x0) * (z1 - z0));
  let deckY = fixed ?? -1;
  if (fixed === undefined) for (const [q, a] of [...bucket].sort((a, b) => b[0] - a[0])) {
    // komşu kovayla birlikte (döşeme + kenar silmesi aynı yüzey sayılır)
    const area = a + (bucket.get(q - 1) ?? 0);
    if (q * 0.15 >= top * 0.45 && area >= need) { deckY = q * 0.15; break; }
  }
  if (deckY < 0) return null;
  // kesin hiza: kovadaki en sık gerçek yükseklik
  const tally = new Map<number, number>();
  for (const h of hm) if (Math.abs(h - deckY) <= 0.15) tally.set(+h.toFixed(3), (tally.get(+h.toFixed(3)) ?? 0) + 1);
  const best = [...tally].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
  if (best) deckY = best[0];
  let a0 = Infinity, a1 = -Infinity, c0 = Infinity, c1 = -Infinity;
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) if (hm[k * nx + i] >= deckY - 0.16) {
    a0 = Math.min(a0, x0 + i * STEP); a1 = Math.max(a1, x0 + (i + 1) * STEP); c0 = Math.min(c0, z0 + k * STEP); c1 = Math.max(c1, z0 + (k + 1) * STEP);
  }
  return { deckY, span: Math.max(a1 - a0, c1 - c0), mx: (a0 + a1) / 2, mz: (c0 + c1) / 2, sx: a1 - a0, sz: c1 - c0 };
}

/**
 * (X-04): kale/müze/teras/tribün güvertesinde katın döşeli karoları simgenin seyir yüzeyinin ÜSTÜNE oturur. Eskiden ızgara,
 * güverte hizasındaki bütün yüzeylerin kutusunun ortasına konuyordu: U biçimli saray müzesinde 26 karoluk çatı terasının 18 sütunu avlunun
 * boşluğu üstünde (döşeme levhası havada, gövdeden 18 birim taşan etek). Döşeli karoların en çoğunu modelin güverte yüzeyine (≥ deckY −
 * ANCHOR_DROP) oturtan model noktası (0,25 adım; eşitlikte kutu ortasına en yakın); kazanç karoların %5'inden azsa kutu ortası kalır.
*/
export const ANCHOR_DROP = 0.6;
function deckAnchor(lv: LevelLike, blocks: readonly Block[], dk: { deckY: number; mx: number; mz: number }, k: number): [number, number] {
  const S = 0.25 / k, solid = blocks.filter((b) => STATIC.has(b.g) && b.g !== "water" && b.s[0] > 0.01 && b.s[2] > 0.01);
  if (!solid.length) return [dk.mx, dk.mz];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const b of solid) { x0 = Math.min(x0, b.p[0] - b.s[0] / 2); x1 = Math.max(x1, b.p[0] + b.s[0] / 2); z0 = Math.min(z0, b.p[2] - b.s[2] / 2); z1 = Math.max(z1, b.p[2] + b.s[2] / 2); }
  const nx = Math.ceil((x1 - x0) / S), nz = Math.ceil((z1 - z0) / S), on = new Uint8Array(nx * nz);
  for (const b of solid) {
    if (b.p[1] + b.s[1] / 2 < dk.deckY - ANCHOR_DROP || b.p[1] - b.s[1] / 2 >= dk.deckY + 0.5 / k) continue; // döşemenin üstündeki köşk/heykel taşımaz
    const i0 = Math.max(0, Math.floor((b.p[0] - b.s[0] / 2 - x0) / S)), i1 = Math.min(nx - 1, Math.ceil((b.p[0] + b.s[0] / 2 - x0) / S) - 1);
    const k0 = Math.max(0, Math.floor((b.p[2] - b.s[2] / 2 - z0) / S)), k1 = Math.min(nz - 1, Math.ceil((b.p[2] + b.s[2] / 2 - z0) / S) - 1);
    for (let i = i0; i <= i1; i++) for (let q = k0; q <= k1; q++) on[q * nx + i] = 1;
  }
  const lx = (tx(0) + tx(lv.built.width - 1)) / 2, lz = (tz(0) + tz(lv.built.depth - 1)) / 2, bl = lv.built.blocked;
  const tiles: [number, number][] = [];
  for (let i = 0; i < lv.built.width; i++) for (let j = 0; j < lv.built.depth; j++) if (!bl?.has(`${i},${j}`)) tiles.push([(tx(i) - lx) / k, (tz(j) - lz) / k]);
  const score = (cx: number, cz: number) => {
    let n = 0;
    for (const [dx, dz] of tiles) {
      const i = Math.floor((cx + dx - x0) / S), q = Math.floor((cz + dz - z0) / S);
      if (i >= 0 && q >= 0 && i < nx && q < nz && on[q * nx + i]) n++;
    }
    return n;
  };
  const s0 = score(dk.mx, dk.mz);
  let best: [number, number] = [dk.mx, dk.mz], bs = s0, bd = 0;
  const hx = (lv.built.width / 2) / k, hz = (lv.built.depth / 2) / k; // ızgara kenarı simgenin kenarından taşabilir
  for (let cx = x0 - hx; cx <= x1 + hx; cx += 0.25) for (let cz = z0 - hz; cz <= z1 + hz; cz += 0.25) {
    const v = score(cx, cz), d = Math.hypot(cx - dk.mx, cz - dk.mz);
    if (v > bs || (v === bs && v > s0 && d < bd)) { bs = v; best = [+cx.toFixed(3), +cz.toFixed(3)]; bd = d; }
  }
  return bs - s0 >= 0.05 * tiles.length ? best : [dk.mx, dk.mz];
}

const deckCache = new Map<string, TowerDeck | null>();
/**
 * Katın gerçek simge güvertesi (yoksa null): şehir haritası landmarkının açık hava katı (iskele ve avlu hariç) ve sokaktan yüksek
 * (`cityPano.elev` ≥ 1,05; eski gri gövdenin çizildiği katlar). Önbellekli.
 */
export function towerDeckOf(lv: LevelLike): TowerDeck | null {
  if (!lv.outdoor || NO_DECK.has(lv.kind) || (lv.cityPano?.elev ?? lv.pano?.drop ?? 0) < 1.05) return null;
  const ck = `${lv.key}:${lv.built.width}x${lv.built.depth}`;
  if (deckCache.has(ck)) return deckCache.get(ck)!;
  let out: TowerDeck | null = null;
  const m = CITY_SITE.exec(lv.site) ?? baseDeckSite(lv);
  const map = m ? CITY_MAPS[m[1]] : undefined;
  const mod = map && m ? landmarkModel(map, m[2], m[3]) : null;
  const dk = mod && m ? modelDeck(mod.blocks, DECK_AT[`${m[1]}/${m[3]}#${lv.index ?? 0}`] ?? DECK_AT[`${m[1]}/${m[3]}`]) : null;
  if (m && map && mod && dk) {
    const w = lv.built.width, d = lv.built.depth;
    const kc = +Math.min(K_MAX, Math.max(K_MIN, Math.max(w, d) / dk.span)).toFixed(3);
    // (ürün sahibi "kulenin tepesi saçma sapan"): eskiden gövde de kc ile ölçekleniyordu → 9–15 karoluk güverte 3–6 karoluk
    // gövdenin üstünde geniş kulübe/mantar. Gövde, katın döşeli karolarının açıklığı simgenin güverte açıklığına sığacak kadar büyür.
    const f = deckFloorRect(lv), k = +Math.max(kc, (f.x1 - f.x0) / dk.sx, (f.z1 - f.z0) / dk.sz).toFixed(3); // eksen eksen (uzun dar teras da)
    const groundY = +(-dk.deckY * k).toFixed(3);
    const [mx, mz] = SIL_KINDS.has(lv.kind) ? [dk.mx, dk.mz] : deckAnchor(lv, mod.blocks, dk, k);
    out = { city: m[1], district: m[2], landmark: m[3], deckY: dk.deckY, span: dk.span, mx, mz, k, kc,
      lx: (tx(0) + tx(w - 1)) / 2, lz: (tz(0) + tz(d - 1)) / 2, groundY, seaY: map.sea ? +(groundY + CITY_SEA_Y * kc).toFixed(3) : null,
      hires: mod.hires, model: mod.blocks };
  }
  deckCache.set(ck, out);
  return out;
}

/**
 * taban sahne kapısının kulesi (sahne etiketi şehir haritasındaki landmarka bağlı: `landmarkInfo` sceneTags) aynı
 * gerçek güverteyi kullanır — eskiden orta LOD taban dünyası panoraması (simge kesilmiş, gövde yerine taban dünyanın kaba modeli).
 * Yalnız kule/kale/gökdelen katları (taban teras ve müze çatıları panoramada kalır).
*/
const BASE_DECK_KINDS: ReadonlySet<string> = new Set(["tower", "castle", "skyscraper"]);
function baseDeckSite(lv: LevelLike): [string, string, string, string] | null {
  if (!lv.scene || !lv.pano || !BASE_DECK_KINDS.has(lv.kind)) return null;
  const info = infoForSceneZone(lv.scene, lv.site);
  return info?.landmark ? [lv.site, info.city, info.district, info.landmark] : null;
}

/** Şehir dünyası → kat dünyası (benzerlik dönüşümü). */
export function deckXf(td: TowerDeck, b: Block): Block {
  const k = td.k;
  return { p: [td.lx + (b.p[0] - td.mx) * k, (b.p[1] - td.deckY) * k, td.lz + (b.p[2] - td.mz) * k], s: [b.s[0] * k, b.s[1] * k, b.s[2] * k], c: b.c, g: b.g, j: b.j };
}

/** şehrin öteki simgelerinin ayak izi (kat dünyası, ölçek `kc`; deckRadius içinde) — dürbünün odak dikdörtgenleri.*/
export function deckLandmarkRects(td: TowerDeck): { x0: number; x1: number; z0: number; z1: number; key: string; h: number }[] {
  const map = CITY_MAPS[td.city], k = td.kc ?? td.k, R = deckRadius(k), out: { x0: number; x1: number; z0: number; z1: number; key: string; h: number }[] = [];
  for (const d of map?.districts ?? []) {
    const plan = districtPlan(map!, d);
    for (const lm of plan.landmarks) {
      if (d.id === td.district && lm.id === td.landmark) continue;
      const x0 = cityX(plan.i0 + lm.i0) - 0.5, x1 = x0 + lm.w, z0 = cityZ(plan.j0 + lm.j0) - 0.5, z1 = z0 + lm.d;
      if (Math.hypot(Math.max(x0 - td.mx, 0, td.mx - x1), Math.max(z0 - td.mz, 0, td.mz - z1)) > R) continue;
      out.push({ x0: td.lx + (x0 - td.mx) * k, x1: td.lx + (x1 - td.mx) * k, z0: td.lz + (z0 - td.mz) * k, z1: td.lz + (z1 - td.mz) * k, key: `${td.city}:${d.id}:${lm.id}`, h: lm.h * k });
    }
  }
  return out;
}

/** şehir dünyası → kat dünyası, çevre şehir için (ölçek `kc`, zemin gövdenin tabanında).*/
export function deckCityXf(td: TowerDeck, b: Block): Block {
  const k = td.kc ?? td.k;
  return { p: [td.lx + (b.p[0] - td.mx) * k, td.groundY + b.p[1] * k, td.lz + (b.p[2] - td.mz) * k], s: [b.s[0] * k, b.s[1] * k, b.s[2] * k], c: b.c, g: b.g, j: b.j };
}

/** Güverte ayak izi (kat dünyası). */
export function deckRect(lv: LevelLike) {
  const w = lv.built.width, d = lv.built.depth;
  return { x0: tx(0) - 0.5, x1: tx(w - 1) + 0.5, z0: tz(0) - 0.5, z1: tz(d - 1) + 0.5 };
}

/**
 * Simge gövdesi (kat dünyası): döşemenin altında kalan model + güverte ayak izi dışında kalan üst parçalar; güverte modelden geniş
 * ise konsol eteği. `kept`/`total`: denetim için korunan model hacmi.
 */
export function deckLandmarkBlocks(lv: LevelLike, td: TowerDeck): { blocks: Block[]; keptBelow: number; totalBelow: number; skirt: number; fit: number; body: number | null } {
  const r = deckRect(lv);
  const out: Block[] = [];
  const up: Block[] = [], cut = new Set<Block>(), orig = new Map<Block, Block>(), nat: Block[] = []; // döşeme üstündeki simge parçaları (ayak izinde) — taşıyıcı denetiminden geçenler çizilir
  let keptBelow = 0, totalBelow = 0;
  const tally = new Map<string, number>();
  const fit = deckFit(lv, td), env = deckEnvelope(lv, td);
  for (const b0 of td.model) {
    if (!STATIC.has(b0.g)) continue;
    const b = deckXf(td, b0);
    const top = b.p[1] + b.s[1] / 2, bot = b.p[1] - b.s[1] / 2;
    const inRect = b.p[0] + b.s[0] / 2 > r.x0 + 1e-3 && b.p[0] - b.s[0] / 2 < r.x1 - 1e-3 && b.p[2] + b.s[2] / 2 > r.z0 + 1e-3 && b.p[2] - b.s[2] / 2 < r.z1 - 1e-3;
    const vol = b.s[0] * b.s[1] * b.s[2];
    if (top <= 0.02) {
      totalBelow += vol;
      // (X-04): döşemeyle aynı hizadaki model çatısı (saray çatısı = teras döşemesi) ayak izinde döşemenin altına çekilir — z-fight benekleri yok
      if (inRect && top > -FLOOR_GAP && b.s[1] > FLOOR_GAP + 0.02) { const nb = { ...b, p: [b.p[0], b.p[1] - (top + FLOOR_GAP) / 2, b.p[2]] as [number, number, number], s: [b.s[0], b.s[1] - (top + FLOOR_GAP), b.s[2]] as [number, number, number] }; for (const q of env ? envClamp(env, nb) : [nb]) { keptBelow += q.s[0] * q.s[1] * q.s[2]; out.push(q); } continue; }
      // gövdeden geniş galeri levhası konsol zarfının içine çekilir (mantar eteği yok)
      for (const q of env ? envClamp(env, b) : [b]) { keptBelow += q.s[0] * q.s[1] * q.s[2]; out.push(q); }
      if (b.g === "solid" && b.s[1] > 0.5) tally.set(b.c, (tally.get(b.c) ?? 0) + vol);
      continue;
    }
    if (!inRect) { out.push(b); nat.push(b); continue; }
    // güverte üstü sivri uç / anten / kapsül tepesi — yalnız yürünmeyen karoların (çekirdek, cam zemin, kesik
    // kenar) üstündeyse çizilir: avatarın yürüdüğü karoyla çakışmaz, kat kendi çatısını çizmeyen güvertelerde (gökdelen terası, kafes zirvesi)
    // her güvertede simgenin kendi üst kısmı (çan katı, kemerli üst kat, külah, sivri çatı) çizilir; kat kendi
    // çatısını çizmez (store.ts levelView). Yürünen karonun üstünde yalnız kat yüksekliğinin (`storey`) üstü — avatarın boyu açık kalır.
    const head = deckHead(lv);
    // güverte üstü kısım katın yürünmez çekirdeğine oturacak kadar yatay ölçeklenir (`deckFit`; fener odası, taç)
    const u = fit === 1 ? b : { ...b, p: [td.lx + (b.p[0] - td.lx) * fit, b.p[1], td.lz + (b.p[2] - td.lz) * fit] as [number, number, number], s: [b.s[0] * fit, b.s[1], b.s[2] * fit] as [number, number, number] };
    nat.push(u);
    // modelin ince alçak korkuluk parçaları (T babalar) katın cam pencere kutularının içinde karmaşa — kat kendi korkuluğunu çizer
    if (bot >= -0.02 && top <= DECK_LOW && Math.min(u.s[0], u.s[2]) <= RAIL_W) continue;
    // (X-04): kule dışı güvertede (ızgara simge yüzeyine ötelenir) yürünen karoda gövde bandından geçen simge parçası (amfitiyatro
    // dış duvar ayağı) çizilmez — çarpışmasız, avatar ve güverte kamerası içinden geçerdi
    if (!SIL_KINDS.has(lv.kind) && lv.kind !== "castle" && bot < 1.0 && top > 0.3 && !overBlocked(lv, u)) continue; // kale suru kendi kulelerini taşır
    if (top > 0.3 && (spireOn(lv, td) || head !== null) && overBlocked(lv, u)) {
      const y0 = Math.max(bot, 0);
      const q: Block = y0 === bot ? u : { ...u, p: [u.p[0], (y0 + top) / 2, u.p[2]], s: [u.s[0], top - y0, u.s[2]] };
      up.push(q); orig.set(q, u);
    } else if (head !== null && top > head + 0.02) {
      // ince taşıyıcı (sütun, korkuluk babası, pilaster) kat çizgisinde kesilip havada kalmaz — döşemeden çizilir
      const thin = Math.max(u.s[0], u.s[2]) <= SLENDER_W;
      const y0 = bot < head && thin ? Math.max(bot, 0) : Math.max(bot, head);
      const q: Block = y0 === bot ? u : { ...u, p: [u.p[0], (y0 + top) / 2, u.p[2]], s: [u.s[0], top - y0, u.s[2]] };
      up.push(q); orig.set(q, u);
      if (bot < head && !thin) cut.add(q); // kat çizgisinde kesilen geniş taşıyıcı (gövde sürer): taşıyıcısız kalırsa köşe babalarıyla döşemeye iner
    }
    if (bot < -0.02) {
      // döşemeyi kesen parça (gövde sürer, fener odası): döşeme altına kadar kesilir, üstü katın kendi geometrisine kalır
      const h = -1 - bot;
      totalBelow += b.s[0] * (-bot) * b.s[2];
      const q = h > 0.02 ? { ...b, p: [b.p[0], bot + h / 2, b.p[2]] as [number, number, number], s: [b.s[0], h, b.s[2]] as [number, number, number] } : null;
      for (const c of q ? (env ? envClamp(env, q) : [q]) : []) { out.push(c); keptBelow += c.s[0] * (-bot) * c.s[2]; }
    }
  }
  // konsol eteği: güverte ayak izi simgenin güverte hizasındaki açıklığından genişse (yürünebilir uzantı)
  // döşeme levhası ve konsol katın DÖŞELİ karolarının kutusunda (eskiden bütün ızgara: kafes zirvesinde 15 × 15
  // kahverengi levha 7 × 9'luk salonun çevresinde)
  const f = deckFloorRect(lv), w = f.x1 - f.x0, d = f.z1 - f.z0, fx = (f.x0 + f.x1) / 2, fz = (f.z0 + f.z1) / 2, sp = td.span * td.k;
  let skirt = 0;
  const c = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "#A49A8A";
  // döşeme levhası (0,2, modelin rengi): güverte katı simgenin galeri/teras döşemesine oturur (TOWER-GROUND-001: karo taşıyıcısız değil)
  // sıra sıra döşeli karoların açıklığı (yuvarlak galeride yuvarlak; eskiden kare levha köşeleri halkanın dışına taşıyordu)
  for (const s of deckFloorRows(lv)) { out.push({ p: [(s.x0 + s.x1) / 2, -1.1, s.z], s: [s.x1 - s.x0, 0.2, 1], c, g: "solid", j: 0.03 }); skirt++; }
  if (env || Math.max(w, d) > sp + 0.6) {
    // kademeli konsol (korbel) — altındaki kademeler gövdenin güverte hizası açıklığına (sp) ve ortasına kadar
    // daralır; her kademe alttakinden bir yanda en çok SKIRT_STEP taşar. Eskiden iki ince levha gövdeye hiç ulaşmıyordu (güverte gövdenin
    // dışında havada asılı). Derinlik gövdenin üst %10'unun içinde: simgenin silüeti (TOWER-DECK-IDENTITY bantları) değişmez.
    // galeri levhası gövdeden geniş simgede (zarf kipi) kademeler galerinin altındaki GÖVDE kesitine iner
    const cx = env ? (env.x0 + env.x1) / 2 : td.lx, cz = env ? (env.z0 + env.z1) / 2 : td.lz;
    const ew = Math.min(w, env ? env.x1 - env.x0 : sp), ed = Math.min(d, env ? env.z1 - env.z0 : sp);
    const side = Math.max(cx - ew / 2 - f.x0, f.x1 - cx - ew / 2, cz - ed / 2 - f.z0, f.z1 - cz - ed / 2);
    const n = Math.max(2, Math.ceil(side / SKIRT_STEP - 1e-9)), t = Math.min(0.5, skirtDepth(-td.groundY) / n);
    for (let q = 1; q <= n; q++) {
      const u = q / n, ww = w + (ew - w) * u, dd = d + (ed - d) * u;
      if (env?.rows) { // yuvarlak galeri: kademe döşeme sıralarının biçimini izler (kare kademenin köşesi halkadan taşmaz)
        for (const e of envBoxes(env, q, 0)) out.push({ p: [(e.x0 + e.x1) / 2, -1.2 - (q - 0.5) * t, (e.z0 + e.z1) / 2], s: [e.x1 - e.x0, t, e.z1 - e.z0], c, g: "solid", j: 0.03 });
      } else out.push({ p: [fx + (cx - fx) * u, -1.2 - (q - 0.5) * t, fz + (cz - fz) * u], s: [ww, t, dd], c, g: "solid", j: 0.03 });
      skirt++;
    }
  }
  // kat çizgisinde kesilen simge parçası altında taşıyıcı kalmadıysa çizilmez (havada başlık/levha/blok yok)
  out.push(...keepSupported(up, [...out, ...deckOwnBlocks(lv, td)], cut, c, (b) => { const o = orig.get(b); return o === b && hangOver(o, nat) > hangTol(o); }));
  return { blocks: out, keptBelow, totalBelow, skirt, fit, body: env ? +Math.max(env.x1 - env.x0, env.z1 - env.z0).toFixed(3) : null };
}

/** ayak izinde model yüzünün döşemenin altında kalacağı pay (kat dünyası).*/
export const FLOOR_GAP = 0.06;
/** modelin korkuluk/baba parçası sayılan en büyük kısa kenar (kat dünyası; DECK_LOW altında çizilmez).*/
export const RAIL_W = 0.2;
/** ince taşıyıcı üst sınırı (kat dünyası; sütun, pilaster, korkuluk babası) — kat çizgisinde kesilmez, döşemeden çizilir.*/
export const SLENDER_W = 1.2;
/** taşıyıcı payı — bir yanda en çok max(HANG_PAD, HANG_FRAC × kısa kenar) taşıyan parça taşınıyor sayılır (saçak, konsol).*/
export const HANG_PAD = 0.7;
export const HANG_FRAC = 0.25;
/** alt yüzle taşıyıcı tepesi arasındaki en çok boşluk (modellerdeki 0,1 düzeyindeki derz).*/
export const HANG_GAP = 0.15;
/** içinden geçtiği bloğu taşıyan en büyük taban oranı (çit babası evet, levhayı delen kulübe hayır).*/
export const PIERCE_FRAC = 0.25;
/** çekirdeğe oturtma ölçeği aralığı ve gereken kazanç (yürünmez karoya oturan taşıyıcı payı).*/
export const FIT_MIN = 0.5;
export const FIT_MAX = 1;
/** yalnız güverteden belirgin dar tepe (fener odası, taç) çekirdeğe oturtulur; güverte kadar geniş gövde (gözlem katı) babalara oturur.*/
export const FIT_RATIO = 0.7;
export const FIT_GAIN = 0.25;

/**
 * `b`nin altından taşıyıcılarının (altta başlayıp alt yüzüne değen ya da onu tümüyle saran bloklar) kapladığı kutuya göre en
 * büyük yan taşma (kat dünyası); taşıyıcı yoksa Infinity. Denetim: scripts/tower_silhouette_check.mjs (TOWER-FLOAT-001).
*/
export function hangOver(b: Block, sup: readonly Block[]): number {
  const y0 = b.p[1] - b.s[1] / 2, y1 = b.p[1] + b.s[1] / 2;
  const bx0 = b.p[0] - b.s[0] / 2, bx1 = b.p[0] + b.s[0] / 2, bz0 = b.p[2] - b.s[2] / 2, bz1 = b.p[2] + b.s[2] / 2;
  let ax0 = Infinity, ax1 = -Infinity, az0 = Infinity, az1 = -Infinity;
  for (const s of sup) {
    if (s === b) continue;
    const s0 = s.p[1] - s.s[1] / 2, s1 = s.p[1] + s.s[1] / 2;
    if (!(s0 < y0 - 0.01 && s1 >= y0 - HANG_GAP)) continue;
    const sx0 = s.p[0] - s.s[0] / 2, sx1 = s.p[0] + s.s[0] / 2, sz0 = s.p[2] - s.s[2] / 2, sz1 = s.p[2] + s.s[2] / 2;
    // içinden geçen geniş blok taşımaz (levhayı delen kulübe); saran blok (gövde içindeki pencere ışığı) ve ince delen (çit babası) taşır
    if (s1 > y1 + 0.05 && !(sx0 <= bx0 + 1e-3 && sx1 >= bx1 - 1e-3 && sz0 <= bz0 + 1e-3 && sz1 >= bz1 - 1e-3) && s.s[0] * s.s[2] > PIERCE_FRAC * b.s[0] * b.s[2]) continue;
    const cx0 = Math.max(bx0, sx0), cx1 = Math.min(bx1, sx1), cz0 = Math.max(bz0, sz0), cz1 = Math.min(bz1, sz1);
    if (cx1 <= cx0 + 1e-3 || cz1 <= cz0 + 1e-3) continue;
    ax0 = Math.min(ax0, cx0); ax1 = Math.max(ax1, cx1); az0 = Math.min(az0, cz0); az1 = Math.max(az1, cz1);
  }
  return ax1 > ax0 ? Math.max(ax0 - bx0, bx1 - ax1, az0 - bz0, bz1 - az1) : Infinity;
}
export const hangTol = (b: Block) => Math.max(HANG_PAD, HANG_FRAC * Math.min(b.s[0], b.s[2]));

/** döşeme üstü parçalar alttan yukarı; taşıyıcısı (taban + kalanlar) yetmeyen düşer, üstündekiler de onunla düşer.*/
function keepSupported(cand: readonly Block[], base: readonly Block[], cut: ReadonlySet<Block>, c: string, native: (b: Block) => boolean): Block[] {
  const kept: Block[] = [...base], res: Block[] = [];
  for (const b of [...cand].sort((p, q) => p.p[1] - p.s[1] / 2 - (q.p[1] - q.s[1] / 2))) {
    const y0 = b.p[1] - b.s[1] / 2;
    if (y0 <= 0.05 || hangOver(b, kept) <= hangTol(b)) { kept.push(b); res.push(b); continue; }
    // simgenin kendi tasarımı (sırt kiremidi, heykel ayrıntısı modelde de böyle) değişmeden çizilir
    if (!cut.has(b)) { if (native(b)) { kept.push(b); res.push(b); } continue; } // taşıyıcısı kesilmiş üst parça: havada kalmasın, çizilmez
    // kesilen geniş taşıyıcı (kulenin gözlem katından geçen gövdesi): ayak izinin köşelerine döşemeden babalar
    const x0 = b.p[0] - b.s[0] / 2, x1 = b.p[0] + b.s[0] / 2, z0 = b.p[2] - b.s[2] / 2, z1 = b.p[2] + b.s[2] / 2;
    const t = Math.min(POST_W, (x1 - x0) / 2, (z1 - z0) / 2), pc = b.g === "solid" ? b.c : c;
    for (const [px, pz] of [[x0 + t / 2, z0 + t / 2], [x1 - t / 2, z0 + t / 2], [x0 + t / 2, z1 - t / 2], [x1 - t / 2, z1 - t / 2]]) {
      const post: Block = { p: [px, y0 / 2, pz], s: [t, y0, t], c: pc, g: "solid", j: 0.03 };
      kept.push(post); res.push(post);
    }
    kept.push(b); res.push(b);
  }
  return res;
}
/** köşe babası kalınlığı (kat dünyası).*/
export const POST_W = 0.3;

/** katın kendi çizilen blokları (store.ts levelView ile aynı süzgeç).*/
export function deckOwnBlocks(lv: LevelLike, td: TowerDeck): Block[] {
  const own = (lv.built as { blocks?: readonly Block[] }).blocks ?? [];
  const storey = lv.storey ?? Infinity;
  // (X-04): ızgaranın dışındaki kendi blokları tarifin sahte manzarası (silüet kutuları, vadi balonları) — gerçek şehir çizilir
  const r = deckRect(lv), inGrid = (b: Block) => b.p[0] > r.x0 - OWN_PAD && b.p[0] < r.x1 + OWN_PAD && b.p[2] > r.z0 - OWN_PAD && b.p[2] < r.z1 + OWN_PAD;
  return own.filter((b) => b.p[1] + b.s[1] / 2 >= -0.9 && b.p[1] - b.s[1] / 2 < storey - 0.05 && inGrid(b) && deckOwnKeep(lv, td, b));
}
/** katın kendi bloğunun ızgara kutusundan en çok uzaklığı (merkez; saçak, korkuluk payı).*/
export const OWN_PAD = 1.5;

/**
 * kule güvertesinde simgenin döşeme üstü kısmı (fener odası, taç, külah) katın yürünmez çekirdeğinden genişse kat
 * çizgisinde kesilip havada kalıyordu (yürünen karonun üstünde başlık). Taşıyıcı parçaların (döşemeden kat çizgisine uzananlar) yürünmez
 * karoya oturan payını en çok artıran yatay ölçek (FIT_MIN…FIT_MAX, eşitlikte 1'e en yakın); kazanç FIT_GAIN'den azsa 1.
*/
const fitCache = new WeakMap<TowerDeck, Map<string, number>>();
export function deckFit(lv: LevelLike, td: TowerDeck): number {
  const head = deckHead(lv);
  if (!SIL_KINDS.has(lv.kind) || !lv.built.blocked || head === null) return 1;
  const ck = `${lv.key}:${lv.built.width}x${lv.built.depth}`;
  const memo = fitCache.get(td) ?? new Map<string, number>();
  fitCache.set(td, memo);
  if (memo.has(ck)) return memo.get(ck)!;
  const r = deckRect(lv);
  const load = td.model.filter((q) => STATIC.has(q.g)).map((q) => deckXf(td, q)).filter((b) => {
    const top = b.p[1] + b.s[1] / 2, bot = b.p[1] - b.s[1] / 2;
    return top > head + 0.02 && bot < head - 0.02 && b.p[0] > r.x0 && b.p[0] < r.x1 && b.p[2] > r.z0 && b.p[2] < r.z1;
  });
  const score = (s: number) => load.filter((b) => overBlocked(lv, { ...b, p: [td.lx + (b.p[0] - td.lx) * s, b.p[1], td.lz + (b.p[2] - td.lz) * s], s: [b.s[0] * s, b.s[1], b.s[2] * s] })).length / load.length;
  let best = 1;
  let lx0 = Infinity, lx1 = -Infinity, lz0 = Infinity, lz1 = -Infinity;
  for (const b of load) { lx0 = Math.min(lx0, b.p[0] - b.s[0] / 2); lx1 = Math.max(lx1, b.p[0] + b.s[0] / 2); lz0 = Math.min(lz0, b.p[2] - b.s[2] / 2); lz1 = Math.max(lz1, b.p[2] + b.s[2] / 2); }
  const fr = deckFloorRect(lv);
  // yalnız kat çizgisinde kesilen geniş taşıyıcı katın kendi bloklarına oturamıyorsa (havada başlık) — taşınan taç olduğu gibi kalır
  const own = deckOwnBlocks(lv, td);
  const hangs = load.some((b) => {
    if (Math.max(b.s[0], b.s[2]) <= SLENDER_W || overBlocked(lv, b)) return false;
    const top = b.p[1] + b.s[1] / 2, q: Block = { ...b, p: [b.p[0], (head + top) / 2, b.p[2]], s: [b.s[0], top - head, b.s[2]] };
    return hangOver(q, own) > hangTol(q);
  });
  if (hangs && Math.max(lx1 - lx0, lz1 - lz0) <= FIT_RATIO * Math.max(fr.x1 - fr.x0, fr.z1 - fr.z0)) {
    const s1 = score(1);
    let bs = s1;
    for (let s = FIT_MIN; s <= FIT_MAX + 1e-9; s += 0.02) {
      const v = score(+s.toFixed(2));
      if (v > bs + 1e-9 || (Math.abs(v - bs) <= 1e-9 && Math.abs(s - 1) < Math.abs(best - 1))) { bs = v; best = +s.toFixed(2); }
    }
    if (bs - s1 < FIT_GAIN) best = 1;
  }
  memo.set(ck, best);
  return best;
}

/**
 * galeri levhası gövdeden geniş mi (zarf kipi). Gövde kesiti: simgenin döşemeden BODY_BAND altındaki kesit
 * kutusu (tek gövde: kutunun en az yarısı dolu). Döşemenin hemen altındaki (TOP_BAND) kesit bir bantta gövdeden SKIRT_STEP'ten fazla
 * taşıyorsa: konsol kademeleri döşemeden bu gövde kesitine iner, konsol derinliğindeki model blokları kademe zarfına çekilir. Yoksa null.
*/
export const TOP_BAND = 2.5;
export const BODY_BAND: readonly [number, number] = [-3.5, -2.5];
type Env = { x0: number; x1: number; z0: number; z1: number; f: { x0: number; x1: number; z0: number; z1: number }; n: number; t: number; rows: { x0: number; x1: number; z: number }[] | null };
const envCache = new WeakMap<TowerDeck, Map<string, Env | null>>();
export function deckEnvelope(lv: LevelLike, td: TowerDeck): Env | null {
  if (!SIL_KINDS.has(lv.kind) || -td.groundY < -BODY_BAND[0] + 1) return null;
  const ck = `${lv.key}:${lv.built.width}x${lv.built.depth}`;
  const memo = envCache.get(td) ?? new Map<string, Env | null>();
  envCache.set(td, memo);
  if (memo.has(ck)) return memo.get(ck)!;
  const f = deckFloorRect(lv);
  const mb = td.model.filter((q) => STATIC.has(q.g) && q.g !== "water").map((q) => deckXf(td, q));
  const sec = (y0: number, y1: number) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const b of mb) if (b.p[1] - b.s[1] / 2 < y1 && b.p[1] + b.s[1] / 2 > y0 && b.p[0] > f.x0 - 3 && b.p[0] < f.x1 + 3 && b.p[2] > f.z0 - 3 && b.p[2] < f.z1 + 3) {
      x0 = Math.min(x0, b.p[0] - b.s[0] / 2); x1 = Math.max(x1, b.p[0] + b.s[0] / 2); z0 = Math.min(z0, b.p[2] - b.s[2] / 2); z1 = Math.max(z1, b.p[2] + b.s[2] / 2);
    }
    return x1 > x0 ? { x0, x1, z0, z1 } : null;
  };
  let out: Env | null = null;
  const body = sec(BODY_BAND[0], BODY_BAND[1]);
  // ayrık gövdeler: döşeme altı bandın bütün kesiti (ör. 42 birimlik çatı parkı) altında gövde kesitinin yarısından azı dolu → konsol yok
  const topAll = boxOf(mb.filter((b) => b.p[1] - b.s[1] / 2 < 0 && b.p[1] + b.s[1] / 2 > -TOP_BAND));
  const under = topAll ? boxOf(mb.filter((b) => b.p[1] - b.s[1] / 2 < BODY_BAND[1] && b.p[1] + b.s[1] / 2 > BODY_BAND[0] && b.p[0] > topAll.x0 && b.p[0] < topAll.x1 && b.p[2] > topAll.z0 && b.p[2] < topAll.z1)) : null;
  if (body && under && singleBody(mb, under, BODY_BAND)) {
    // döşeme (katın döşeli kutusu) + simgenin üst bant kesitleri: bant bant bir yanda en büyük taşma
    let worst = 0, below = body;
    for (let y = BODY_BAND[1]; y < 0; y += 0.25) {
      const s = sec(y, y + 0.25);
      const cur = s ? (y + 0.25 > -1.2 ? { x0: Math.min(s.x0, f.x0), x1: Math.max(s.x1, f.x1), z0: Math.min(s.z0, f.z0), z1: Math.max(s.z1, f.z1) } : s) : y + 0.25 > -1.2 ? f : null;
      if (!cur) continue;
      worst = Math.max(worst, below.x0 - cur.x0, cur.x1 - below.x1, below.z0 - cur.z0, cur.z1 - below.z1);
      below = cur;
    }
    if (worst > SKIRT_STEP + 0.01) {
      const ew = Math.min(f.x1 - f.x0, body.x1 - body.x0), ed = Math.min(f.z1 - f.z0, body.z1 - body.z0), cx = (body.x0 + body.x1) / 2, cz = (body.z0 + body.z1) / 2;
      const side = Math.max(cx - ew / 2 - f.x0, f.x1 - cx - ew / 2, cz - ed / 2 - f.z0, f.z1 - cz - ed / 2);
      const n = Math.max(2, Math.ceil(side / SKIRT_STEP - 1e-9)), t = Math.min(0.5, skirtDepth(-td.groundY) / n);
      const rows = deckFloorRows(lv);
      const round = rows.some((s) => s.x0 > f.x0 + 1e-3 || s.x1 < f.x1 - 1e-3);
      out = { x0: cx - ew / 2, x1: cx + ew / 2, z0: cz - ed / 2, z1: cz + ed / 2, f, n, t, rows: round ? rows : null };
    }
  }
  memo.set(ck, out);
  return out;
}
function boxOf(bs: readonly Block[]) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const b of bs) { x0 = Math.min(x0, b.p[0] - b.s[0] / 2); x1 = Math.max(x1, b.p[0] + b.s[0] / 2); z0 = Math.min(z0, b.p[2] - b.s[2] / 2); z1 = Math.max(z1, b.p[2] + b.s[2] / 2); }
  return x1 > x0 ? { x0, x1, z0, z1 } : null;
}
/** Kesit kutusunun en az yarısı dolu mu (üç kuleyi bağlayan çatı parkı gibi ayrık gövdeler değil). 0,25'lik örnekleme. */
function singleBody(mb: readonly Block[], box: { x0: number; x1: number; z0: number; z1: number }, band: readonly [number, number]): boolean {
  const ins = mb.filter((b) => b.p[1] - b.s[1] / 2 < band[1] && b.p[1] + b.s[1] / 2 > band[0] && b.s[0] * b.s[2] >= 0.1);
  const nx = Math.ceil((box.x1 - box.x0) / 0.25), nz = Math.ceil((box.z1 - box.z0) / 0.25);
  const col = new Uint8Array(nx), row = new Uint8Array(nz);
  let hit = 0;
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
    const x = box.x0 + 0.125 + i * 0.25, z = box.z0 + 0.125 + k * 0.25;
    if (ins.some((b) => Math.abs(x - b.p[0]) <= b.s[0] / 2 && Math.abs(z - b.p[2]) <= b.s[2] / 2)) { hit++; col[i] = 1; row[k] = 1; }
  }
  // gövdeler arasında ≥ 1 birimlik boş şerit (üç ayrı kule) → ayrık
  const gap = (a: Uint8Array) => { let run = 0; for (let i = 1; i < a.length - 1; i++) { run = a[i] ? 0 : run + 1; if (run >= 4) return true; } return false; };
  return nx * nz > 0 && hit >= 0.5 * nx * nz && !gap(col) && !gap(row);
}
/** Zarf: döşeme kutusu (−1,2'ye kadar), altında konsol kademeleri; blok alt yüzündeki zarfa (0,02 içeri) kırpılır. Hiç kalmazsa null. */
function envClamp(env: Env, b: Block): Block[] {
  const bot = b.p[1] - b.s[1] / 2;
  const depth = 1.2 + env.n * env.t;
  if (b.p[1] + b.s[1] / 2 < -depth - 1e-3) return [b];
  const q = bot >= -1.2 ? 0 : Math.min(env.n, Math.ceil((-1.2 - bot) / env.t - 1e-9));
  // konsolun altına inen gövde bloğu gövde kesitine (değişmez), konsol içindeki levha kademenin 0,02 içine (görünmez)
  const out: Block[] = [];
  for (const e of envBoxes(env, q, bot < -depth ? 0 : 0.02)) {
    const x0 = Math.max(b.p[0] - b.s[0] / 2, e.x0), x1 = Math.min(b.p[0] + b.s[0] / 2, e.x1);
    const z0 = Math.max(b.p[2] - b.s[2] / 2, e.z0), z1 = Math.min(b.p[2] + b.s[2] / 2, e.z1);
    if (x1 - x0 >= 0.02 && z1 - z0 >= 0.02) out.push({ ...b, p: [(x0 + x1) / 2, b.p[1], (z0 + z1) / 2], s: [x1 - x0, b.s[1], z1 - z0] });
  }
  return out;
}
/** Zarfın q. kademesi (0: döşeme): dikdörtgen güvertede tek kutu, yuvarlak galeride döşeme sıralarından daralan şeritler; her yandan `inset` içeri. */
function envBoxes(env: Env, q: number, inset: number): { x0: number; x1: number; z0: number; z1: number }[] {
  const f = env.f, w = f.x1 - f.x0, d = f.z1 - f.z0, fx = (f.x0 + f.x1) / 2, fz = (f.z0 + f.z1) / 2, cx = (env.x0 + env.x1) / 2, cz = (env.z0 + env.z1) / 2;
  const u = q / env.n, ex = fx + (cx - fx) * u, ez = fz + (cz - fz) * u, hz = (d + (env.z1 - env.z0 - d) * u) / 2;
  if (!env.rows) { const hw = (w + (env.x1 - env.x0 - w) * u) / 2; return [{ x0: ex - hw + inset, x1: ex + hw - inset, z0: ez - hz + inset, z1: ez + hz - inset }]; }
  const out: { x0: number; x1: number; z0: number; z1: number }[] = [];
  for (const s of env.rows) {
    const z0 = Math.max(s.z - 0.5, ez - hz), z1 = Math.min(s.z + 0.5, ez + hz);
    if (z1 - z0 < 0.02) continue;
    const x0 = Math.max(s.x0, s.x0 + (env.x0 - s.x0) * u), x1 = Math.min(s.x1, s.x1 + (env.x1 - s.x1) * u); // yalnız daralır
    if (x1 - x0 > 2 * inset + 0.02) out.push({ x0: x0 + inset, x1: x1 - inset, z0: z0 + inset, z1: z1 - inset });
  }
  return out;
}
/** döşeme levhası sıraları (kat dünyası): her ızgara sırasında döşeli karoların ilkinden sonuncusuna; engel kümesi yoksa bütün sıra.*/
export function deckFloorRows(lv: LevelLike): { x0: number; x1: number; z: number }[] {
  const bl = lv.built.blocked, out: { x0: number; x1: number; z: number }[] = [];
  for (let j = 0; j < lv.built.depth; j++) {
    let i0 = Infinity, i1 = -Infinity;
    for (let i = 0; i < lv.built.width; i++) if (!bl || !bl.has(`${i},${j}`)) { i0 = Math.min(i0, i); i1 = Math.max(i1, i); }
    if (i0 <= i1) out.push({ x0: tx(i0) - 0.5, x1: tx(i1) + 0.5, z: tz(j) });
  }
  return out;
}
/** katın kendi tavan/çatı sınırı (kat dünyası; döşemeden): bunun üstünü simgenin kendi modeli çizer. Kat yüksekliği yoksa null.*/
export const deckHead = (lv: LevelLike): number | null => (typeof lv.storey === "number" && lv.storey > 0 ? lv.storey : null);

/** katın döşeli (engelsiz) karolarının kutusu (kat dünyası); engel kümesi yoksa bütün ızgara.*/
export function deckFloorRect(lv: LevelLike) {
  const bl = lv.built.blocked;
  if (!bl) return deckRect(lv);
  let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
  for (let i = 0; i < lv.built.width; i++) for (let j = 0; j < lv.built.depth; j++) if (!bl.has(`${i},${j}`)) { i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j); }
  return i0 > i1 ? deckRect(lv) : { x0: tx(i0) - 0.5, x1: tx(i1) + 0.5, z0: tz(j0) - 0.5, z1: tz(j1) + 0.5 };
}
/** simgenin güverte üstü parçası çizilen katlar (kendi külahı/çatısı olmayan açık güverte; kafes kulenin platformunda üst gövde ortadaki boşluktan yükselir).*/
export const SPIRE_LEVELS: ReadonlySet<string> = new Set(["lvl_deck", "room_summit", "room_platform"]);
/** <city> iğnesi de çizilir (dürbün yörüngesi büyük yükselmeyi derece başına rampalar: landmarkView `LIFT_SLOPE`).*/
export const spireOn = (lv: LevelLike, _td?: TowerDeck) => SPIRE_LEVELS.has(lv.name ?? "");
/** Blok ayak izinin düştüğü bütün ızgara karoları yürünmez (engelli ya da ızgara dışı). */
export function overBlocked(lv: LevelLike, b: Block): boolean {
  const bl = lv.built.blocked;
  if (!bl) return false;
  const i0 = Math.floor(b.p[0] - b.s[0] / 2 - tx(0) + 0.5 + 1e-3), i1 = Math.floor(b.p[0] + b.s[0] / 2 - tx(0) + 0.5 - 1e-3);
  const j0 = Math.floor(b.p[2] - b.s[2] / 2 - tz(0) + 0.5 + 1e-3), j1 = Math.floor(b.p[2] + b.s[2] / 2 - tz(0) + 0.5 - 1e-3);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    if (i < 0 || j < 0 || i >= lv.built.width || j >= lv.built.depth) continue;
    if (!bl.has(`${i},${j}`)) return false;
  }
  return true;
}
/**
 * kule güvertesinde katın kendi bloğu simgenin dış silüetinde mi (kat dünyası). Alçak eşya (korkuluk, parapet, bank;
 * döşemeden ≤ DECK_LOW) her zaman; daha yüksek blok (oda duvarı, cam salon, kulübe) yalnız simgenin aynı yükseklikteki kesit kutusunun
 * içinde (pay: %10 + 0,6). Dışında kalan çizilmez (çarpışma ızgarası değişmez) — Londra çan katının yerine geçen geniş seyir kulübesi,
 * davul kulesi salonundan taşan yuvarlak oda duvarı. Denetim: scripts/tower_silhouette_check.mjs (TOWER-SILHOUETTE-001).
*/
export const DECK_LOW = 1.3;
const SIL_KINDS: ReadonlySet<string> = new Set(["tower", "skyscraper"]);
const silCache = new WeakMap<TowerDeck, { y0: number; boxes: ([number, number, number, number] | null)[] }>();
export function deckOwnKeep(lv: LevelLike, td: TowerDeck, b: Block): boolean {
  if (!SIL_KINDS.has(lv.kind) || b.p[1] + b.s[1] / 2 <= DECK_LOW) return true;
  let sil = silCache.get(td);
  if (!sil) {
    const blocks = td.model.filter((q) => STATIC.has(q.g) && q.g !== "water").map((q) => deckXf(td, q));
    const top = Math.max(0, ...blocks.map((q) => q.p[1] + q.s[1] / 2)), n = Math.ceil(top / 0.25) + 1;
    const boxes: ([number, number, number, number] | null)[] = Array.from({ length: n }, () => null);
    for (const q of blocks) {
      const a = Math.max(0, Math.floor((q.p[1] - q.s[1] / 2) / 0.25)), c = Math.min(n - 1, Math.floor((q.p[1] + q.s[1] / 2) / 0.25));
      for (let i = a; i <= c; i++) {
        const r = boxes[i] ?? [Infinity, -Infinity, Infinity, -Infinity];
        r[0] = Math.min(r[0], q.p[0] - q.s[0] / 2); r[1] = Math.max(r[1], q.p[0] + q.s[0] / 2); r[2] = Math.min(r[2], q.p[2] - q.s[2] / 2); r[3] = Math.max(r[3], q.p[2] + q.s[2] / 2);
        boxes[i] = r;
      }
    }
    sil = { y0: 0, boxes };
    silCache.set(td, sil);
  }
  const a = Math.max(0, Math.floor((b.p[1] - b.s[1] / 2) / 0.25)), c = Math.floor((b.p[1] + b.s[1] / 2) / 0.25);
  let r: number[] | null = null;
  for (let i = a; i <= c && i < sil.boxes.length; i++) { const q = sil.boxes[i]; if (q) r = r ? [Math.min(r[0], q[0]), Math.max(r[1], q[1]), Math.min(r[2], q[2]), Math.max(r[3], q[3])] : [...q]; }
  if (!r) return false;
  const pad = 0.1 * Math.max(r[1] - r[0], r[3] - r[2]) + 0.6;
  return b.p[0] - b.s[0] / 2 >= r[0] - pad && b.p[0] + b.s[0] / 2 <= r[1] + pad && b.p[2] - b.s[2] / 2 >= r[2] - pad && b.p[2] + b.s[2] / 2 <= r[3] + pad;
}
/** konsol kademesi başına en çok taşma (model birimi, bir yandan).*/
export const SKIRT_STEP = 0.8;
/** Konsolun toplam derinliği (döşeme levhasının altı): gövde boyunun %10 bandının 0,3 üstünde kalır, en az 0,2, en çok %6. */
export const skirtDepth = (bodyH: number) => Math.min(0.06 * bodyH, Math.max(0.2, 0.1 * bodyH - 1.5));

const cityCache = new Map<string, Block[]>();
/** Şehrin gerçek parsel blokları (kat dünyası), simgenin kendisi hariç; kayıtlı simgeler hi-res. */
export function deckCityBlocks(td: TowerDeck): Block[] {
  const ck = `${td.city}:${td.district}:${td.landmark}:${td.k}:${td.kc}:${td.lx},${td.lz}`;
  const hit = cityCache.get(ck);
  if (hit) return hit;
  const map = CITY_MAPS[td.city];
  const out: Block[] = [];
  if (map) {
    const R = deckRadius(td.kc ?? td.k), I = Math.floor(td.mx + 11.5), J = Math.floor(td.mz + 7.5);
    const his = hiresMapItems(map).filter((it) => {
      const [a, b, c, e] = it.rect;
      return Math.hypot(Math.max(a - td.mx, 0, td.mx - c), Math.max(b - td.mz, 0, td.mz - e)) <= R;
    });
    const self = his.find((it) => it.landmark === td.landmark && it.district === td.district);
    const mod = self ? null : landmarkModel(map, td.district, td.landmark);
    const own = self ? self.zone : mod ? [mod.rect] : [];
    const zones = his.filter((it) => it !== self).map((it) => it.zone);
    // hi-res ile değişen orta model: bölge testine ek olarak birebir aynı blok (bölge dışına taşan saçak, kanat)
    const bk = (b: Block) => `${b.p.join(",")}|${b.s.join(",")}|${b.c}`;
    const midKeys = new Set(his.flatMap((it) => it.mid.map(bk)));
    if (mod) for (const b of mod.blocks) midKeys.add(bk(b)); // simgenin kendi orta modeli (gövde olarak ayrıca çizildi)
    // gövde (k) şehirden (kc) büyükse tabanının kapladığı şehir yapıları çizilmez (zemin ve su kalır) — gövde komşu yapıya girmez
    const foot = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
    for (const b0 of td.model) {
      if (!STATIC.has(b0.g) || b0.p[1] - b0.s[1] / 2 > 1) continue;
      const b = deckXf(td, b0);
      foot.x0 = Math.min(foot.x0, b.p[0] - b.s[0] / 2); foot.x1 = Math.max(foot.x1, b.p[0] + b.s[0] / 2); foot.z0 = Math.min(foot.z0, b.p[2] - b.s[2] / 2); foot.z1 = Math.max(foot.z1, b.p[2] + b.s[2] / 2);
    }
    const inFoot = (q: Block) => td.k > (td.kc ?? td.k) + 1e-6 && q.g !== "water" && q.p[1] + q.s[1] / 2 > td.groundY + 0.05
      && q.p[0] > foot.x0 && q.p[0] < foot.x1 && q.p[2] > foot.z0 && q.p[2] < foot.z1;
    const inZ = (b: Block, z: readonly (readonly number[])[]) => z.some((r) => b.p[0] >= r[0] && b.p[0] <= r[2] && b.p[2] >= r[1] && b.p[2] <= r[3] && b.p[1] - b.s[1] / 2 >= -0.05);
    for (let cz = Math.floor((J - R) / CITY_PD); cz <= Math.floor((J + R) / CITY_PD); cz++) for (let cx = Math.floor((I - R) / CITY_PW); cx <= Math.floor((I + R) / CITY_PW); cx++) {
      const d = parcelDistrict(map, cx, cz);
      const p = d ? districtParcel(map, d, cx, cz) : null;
      if (!p) continue;
      for (const b of p.near.blocks) {
        if (!STATIC.has(b.g) || b.r || (b as { entryDoor?: boolean }).entryDoor) continue; // ENTRY-DOOR-001: giriş kapısı yer seviyesinde, güverteden görünen gövde/çevre değil
        if (Math.hypot(b.p[0] - td.mx, b.p[2] - td.mz) > R + 2) continue;
        if (inZ(b, own) && b.g !== "water") continue; // simgenin kendisi gövde olarak çizildi
        if ((zones.some((z) => inZ(b, z)) || midKeys.has(bk(b))) && b.g !== "water") continue; // hi-res ile değişecek orta model
        const q = deckCityXf(td, b);
        if (inFoot(q)) continue;
        out.push(q);
      }
    }
    for (const it of his) if (it !== self) for (const b of it.hi()) if (STATIC.has(b.g)) { const q = deckCityXf(td, b); if (!inFoot(q)) out.push(q); }
    // şehrin doğal sınırı (kıyı şeridi, karşı kıyı silüeti, tepe/dağ; şehirde ufukta görünenin aynısı): kenarda gökyüzü renkli boşluk kalmaz
    // kara şehrinde meydan çevresi dolgusu (horizon.ts cityFiller; şehirde HorizonLayer'ın çizdiğinin aynısı) da
    for (const b of [...cityBoundary(map), ...cityFiller(map)]) if (STATIC.has(b.g) && Math.hypot(b.p[0] - td.mx, b.p[2] - td.mz) <= R + Math.max(b.s[0], b.s[2]) / 2) out.push(deckCityXf(td, b));
  }
  if (cityCache.size > 16) cityCache.clear();
  cityCache.set(ck, out);
  return out;
}

const viewCache = new Map<string, Block[]>();
/** Güvertenin bütün dış blokları (simge gövdesi + şehir). Gece pencereleri: şehir blokları zaten `glow` taşır. */
export function towerDeckBlocks(lv: LevelLike): Block[] {
  const td = towerDeckOf(lv);
  if (!td) return [];
  const ck = `${lv.key}:${lv.built.width}x${lv.built.depth}`;
  const hit = viewCache.get(ck);
  if (hit) return hit;
  // simge parçaları yapıdır (`fix`): foto/yürüme yan kesiti külahın karesel basamaklarını (taç donatısı) yakın yarıdan açmasın (walk/cover.ts sideProp)
  const out = [...deckLandmarkBlocks(lv, td).blocks, ...deckCityBlocks(td)].map((b) => (b.fix ? b : { ...b, fix: 1 as const }));
  if (viewCache.size > 16) viewCache.clear();
  viewCache.set(ck, out);
  return out;
}
