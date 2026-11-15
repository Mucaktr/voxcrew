/**
 * CITYLIFE (ürün sahibi 2026-10-28, B3) — yeme-içme mekânlarının **satıcısı**: `city/venues.ts placeVenue` ile kurulan her tezgâhlı mekânın
 * (balık-patates, pub, kafe, krep, sokak yemeği, çay bahçesi) arka duvarı ile tezgâhı arasında duran figüran. Satıcı ajan DEĞİLDİR:
 * adı, konuşması, Yakındakiler girdisi, arka uç kaydı yoktur. Piknik (`picnic`) tezgâhsızdır → satıcısı yoktur.
 *
 * - Bulma (`vendorsFrom`): mekânın imzası blok listesinden okunur (yazısız menü panosu `#26302B` 1,4 × 0,5 × 0,04 + 2,84 × 0,06 × 0,5
 * tezgâh üstü, panodan 0,54 ileride) — sahne ve semt dosyalarına dokunmadan her `placeVenue` çağrısı bulunur. Tür, tentenin ilk
 * şerit renginden (`PAL[kind].a`; türler arasında tek) okunur.
 * - Konum: panodan müşteriye doğru 0,145 (arka duvar iç yüzü −0,36 ile tezgâh gövdesi arkası −0,03 arasının ortası), tezgâhın sağ
 * yarısında (sol yarıda ocak/semaver/kızartma teknesi); bakış sipariş karosuna.
 * - El yapımı tezgâh (imzasız; ör. İstanbul balık-ekmek teknesi): mekânlı ritüelin konumu verilirse (`venueVendors`) satıcı
 * tezgâhın ardında, ritüel yönünde ilk boş ve basılabilir noktaya konur.
 * - Servis (`serveAt`): avatar sipariş karosunda durunca ya da bir ritüel mekânda başlayınca (FiguransLayer.tsx), ya da başka bir ekip
 * (ACTIVITY-FEEL: ajanlar mekâna uğrayınca) çağırınca satıcı ~1,6 sn uzatma hareketi (elde kâse/bardak) yapar.
 *
 * Diğer ekipler için API: `vendorNear(x, z)` ("bu mekânın satıcısı X konumunda"), `vendorRuntime.list` (o an çizilen dünyadaki
 * satıcılar), `serveAt(x, z)` (uzatma hareketini başlatır; true → bir satıcı servis ediyor). Saf çekirdek React/three kullanmaz.
*/
import type { Block } from "../scenes";
import type { VenueKind } from "../fun/venues";

export interface Vendor {
  id: string;
  kind: VenueKind;
  /** satıcının ayak noktası (dünya) ve zemin yüksekliği */
  x: number;
  z: number;
  y: number;
  /** bakış (rad, `AvatarState.heading`: 0 → +z): müşteriye */
  heading: number;
  /** sipariş karosu (müşterinin durduğu yer) */
  anchor: { x: number; z: number };
  /** tezgâh üstü (uzatılan nesne bu yükseklikte görünür) */
  counterTop: number;
  /** yerleşim ölçeği: sahne (chibi) ya da yürüme (insan ölçeği) */
  scale: "scene" | "walk";
  /** VENDOR-VIS: saçak/tavan alt yüzü (dünya y; satıcının başı bunu geçmez); el yapımı tezgâhta null */
  roof: number | null;
  /** tezgâhtan müşteriye birim yön (x, z); el yapımı tezgâhta yok*/
  dir?: readonly [number, number];
}

/** Tente ilk şerit rengi → tür (`city/venues.ts PAL[kind].a`). */
export const AWNING_KIND: Readonly<Record<string, VenueKind>> = {
  "#1f4e8c": "chip_shop", "#2e5e4e": "pub", "#b4463a": "cafe", "#e07a5f": "crepe_stand", "#c8553d": "food_stand", "#b91c1c": "tea_garden",
};
const MENU = "#26302b";
/** Satıcının panodan müşteriye uzaklığı ve tezgâh üstünün panodan uzaklığı (placeVenue: pano v −0,34, tezgâh üstü v 0,2). */
export const VENDOR_FROM_MENU = 0.145;
/** Satıcının tezgâh ortasından sağa kayması (sol yarıdaki tezgâh eşyasından uzak). */
export const VENDOR_SIDE = 0.45;
const MENU_TO_TOP = 0.54;
/** Ölçek boyları (placeVenue `H`): tezgâh ve saçak. */
const SCALE_H = { scene: { counter: 1.0, roof: 2.25 }, walk: { counter: 0.82, roof: 1.85 } } as const;

/**
 * VENDOR-VIS — satıcının çizim yüksekliği. Satıcı panoyla tezgâh arasındaki dar aralıkta durur (arka duvar + yan direkler + saçak çevreler);
 * zemin hizasında durunca omuz (0,84 × ölçek) tezgâh üstünün (sahne 1,0; yürüme haritası 0,82) altında kalır, yürümede (ölçek 0,645) kafa
 * bile tezgâhın ardında kalıp satıcı hiç görünmezdi. Çözüm: tezgâh üstü satıcının gövde ortasına (`VENDOR_COUNTER_AT` × ölçek) gelecek
 * kadar yükselir (tezgâh gövdesi alttaki boşluğu gizler; el yapımı tezgâhta FiguransLayer bir basamak kutusu çizer), kafa saçağı geçmez.
 */
export const VENDOR_COUNTER_AT = 0.45;
/** Chibi ölçeğinde omuz ve baş üstü yükseklikleri (voxel / 16; `BONE_PIVOT`: omuz 13,5 + 0,4 üst yüz; baş üstü 27 + saç payı). */
export const VENDOR_SHOULDER = 0.84;
export const VENDOR_HEAD_TOP = 1.72;
/** Satıcının ayak yüksekliği (dünya y); hs = `walkRuntime.humanScale` (1 genel bakış … ≈0,645 yürüme). Hiçbir zaman `v.y` altına inmez. */
export function vendorDrawY(v: Pick<Vendor, "y" | "counterTop" | "roof" | "dir">, hs: number): number {
  // (PROP-STAND-001): el yapımı açık tezgâh/araba (`dir` yok: arka duvar + tezgâh gövdesi gibi örtü yok) — yükseltme açıkta
  // "kasanın / arabanın üstünde duran satıcı" okunuyordu (basamak kutusu). Satıcı zeminde, arabanın ardında durur; baş tezgâhı aşar.
  if (!v.dir) return v.y;
  let y = Math.max(v.y, v.counterTop - VENDOR_COUNTER_AT * hs);
  if (v.roof !== null) y = Math.max(v.y, Math.min(y, v.roof - 0.02 - VENDOR_HEAD_TOP * hs));
  return y;
}

/**
 * VENDOR-VIS — boşta "çalışma" hareketi (FiguransLayer `poseTargets("idle")` üstüne yazar): iki kol tezgâh üstüne uzanır, küçük
 * silme/yoğurma salınımı; ~7 sn'de bir kafa müşteriye kalkar; ~11 sn'de bir sağ el kısa bir uzatma (servis jesti). Hareket azaltmada
 * durağan: kollar tezgâhta. `out` bir `Pose` olabilir (yalnız bu alanlar yazılır).
 */
export interface WorkPose { la: number; ra: number; laz: number; raz: number; hx: number; hy: number }
export const VENDOR_ARMS = -0.82;
/** Kol uzunluğu (voxel/16: omuz pivotu 13,5 → el ucu 5,5) ve omuz yüksekliği (13,5/16). */
export const VENDOR_ARM_LEN = 0.5, VENDOR_SHOULDER_PIVOT = 0.844;
/** El tezgâh üstünün hemen üstüne gelecek kol açısı (rad, negatif = öne; çizim yüksekliği `vendorDrawY`). Saçak sınırı vendoru alçak tutan mekânlarda kol daha yatay. */
export function vendorArmAngle(v: Pick<Vendor, "y" | "counterTop" | "roof" | "dir">, hs: number): number {
  const d = vendorDrawY(v, hs) + VENDOR_SHOULDER_PIVOT * hs - (v.counterTop + 0.04 * hs);
  return -Math.acos(Math.max(0.15, Math.min(1, d / (VENDOR_ARM_LEN * hs))));
}
export function vendorWorkPose(out: WorkPose, t: number, calm: boolean, seed = 0, arm = VENDOR_ARMS): void {
  out.la = arm; out.ra = arm; out.laz = 0.06; out.raz = -0.06; out.hx = 0.05; out.hy = 0;
  if (calm) return;
  const w = t * 1.9 + seed;
  out.la += 0.13 * Math.sin(w); out.ra += 0.13 * Math.sin(w + Math.PI * 0.8);
  out.laz += 0.05 * Math.sin(w * 0.5); out.raz -= 0.05 * Math.sin(w * 0.5 + 1);
  const g = (t + seed * 2.3) % 7, up = g < 1.4 ? Math.sin(Math.PI * g / 1.4) : 0; // müşteriye bakış
  out.hx -= 0.2 * up; out.hy = 0.12 * up * Math.sin(seed * 5 + Math.floor((t + seed * 2.3) / 7));
  const h = (t + seed * 3.1) % 11, give = h < 1.1 ? Math.sin(Math.PI * h / 1.1) : 0; // el uzatma
  out.ra -= 0.45 * give; out.hx += 0.08 * give;
}

const near = (a: number, b: number, e = 0.02) => Math.abs(a - b) <= e;
const lc = (c: string) => c.toLowerCase();

/** Blok listesindeki tezgâhlı mekânların satıcıları (belirlenimci; sıra blok sırası). */
export function vendorsFrom(blocks: readonly Block[], idPrefix = "v"): Vendor[] {
  const out: Vendor[] = [];
  const menus: Block[] = [], tops: Block[] = [], awn: Block[] = [];
  for (const b of blocks) {
    if (b.g !== "solid") continue;
    const s = b.s;
    if (lc(b.c) === MENU && near(s[1], 0.5) && ((near(s[0], 1.4) && near(s[2], 0.04)) || (near(s[2], 1.4) && near(s[0], 0.04)))) menus.push(b);
    else if (near(s[1], 0.06) && ((near(s[0], 2.84) && near(s[2], 0.5)) || (near(s[2], 2.84) && near(s[0], 0.5)))) tops.push(b);
    else if (near(s[1], 0.08) && near(s[0], 0.5) && near(s[2], 0.5) && AWNING_KIND[lc(b.c)]) awn.push(b);
  }
  for (const m of menus) {
    const alongX = m.s[0] > m.s[2];
    let best: Block | null = null, bd = 0.1;
    for (const t of tops) {
      // tezgâh üstü panoyla aynı yönde uzanır, pano ekseninde (yanal kayma ≤ 0,05), 0,54 ileride
      if ((t.s[0] > t.s[2]) !== alongX) continue;
      const lat = alongX ? Math.abs(t.p[0] - m.p[0]) : Math.abs(t.p[2] - m.p[2]);
      const fwd = alongX ? Math.abs(t.p[2] - m.p[2]) : Math.abs(t.p[0] - m.p[0]);
      const e = Math.abs(fwd - MENU_TO_TOP);
      if (lat > 0.05 || e >= bd) continue;
      best = t; bd = e;
    }
    if (!best) continue;
    const fx = alongX ? 0 : Math.sign(best.p[0] - m.p[0]), fz = alongX ? Math.sign(best.p[2] - m.p[2]) : 0;
    const roof = m.p[1] + 0.42, top = best.p[1] + 0.03;
    const scale: Vendor["scale"] = Math.abs((roof - top) - (SCALE_H.walk.roof - SCALE_H.walk.counter)) < Math.abs((roof - top) - (SCALE_H.scene.roof - SCALE_H.scene.counter)) ? "walk" : "scene";
    const ground = top - SCALE_H[scale].counter;
    // tür: tentenin (pano üstünde, müşteri tarafında) en sık rengi
    const votes = new Map<VenueKind, number>();
    for (const a of awn) {
      if (Math.hypot(a.p[0] - m.p[0], a.p[2] - m.p[2]) > 1.9 || a.p[1] < m.p[1]) continue;
      const k = AWNING_KIND[lc(a.c)]; votes.set(k, (votes.get(k) ?? 0) + 1);
    }
    const kind = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "food_stand";
    // tezgâhın sağ yarısında durur (sol yarıda ocak/semaver/kızartma teknesi; tezgâh üstü eşya gövdeye girmez)
    const rx = fz, rz = -fx;
    const x = m.p[0] + fx * VENDOR_FROM_MENU + rx * VENDOR_SIDE, z = m.p[2] + fz * VENDOR_FROM_MENU + rz * VENDOR_SIDE;
    // sipariş karosu: tezgâh kökeninden (pano + 0,34) müşteriye 1 karo
    const ax = m.p[0] + fx * 1.34, az = m.p[2] + fz * 1.34;
    out.push({ id: `${idPrefix}:${out.length}`, kind, x, z, y: Math.max(0, +ground.toFixed(3)), heading: Math.atan2(ax - x, az - z),
      anchor: { x: ax, z: az }, counterTop: top, scale, roof, dir: [fx, fz] });
  }
  return out;
}

// ------------------------------------------------------------------------------------------ çalışma zamanı (diğer ekipler)
/** Servis hareketinin süresi (ms). */
export const SERVE_MS = 1600;
/** Aynı satıcının yeniden servis etmesi için en kısa ara (ms). */
export const SERVE_COOL_MS = 2500;

/** O an çizilen dünyanın satıcıları (FiguransLayer.tsx yazar) ve süren servisler (satıcı kimliği → başlangıç ms). */
export const vendorRuntime: { list: readonly Vendor[]; serving: Map<string, number> } = { list: [], serving: new Map() };

/** (x, z) noktasına `r` içindeki en yakın satıcı (sipariş karosu ya da satıcının kendisi ölçülür); yoksa null. */
export function vendorNear(x: number, z: number, r = 2.2, list: readonly Vendor[] = vendorRuntime.list): Vendor | null {
  let best: Vendor | null = null, bd = r;
  for (const v of list) {
    const d = Math.min(Math.hypot(v.anchor.x - x, v.anchor.z - z), Math.hypot(v.x - x, v.z - z));
    if (d <= bd) { bd = d; best = v; }
  }
  return best;
}

/** (x, z) yakınındaki satıcı servis etsin (uzatma hareketi). Satıcı yoksa ya da soğumadaysa false. */
export function serveAt(x: number, z: number, now = typeof performance !== "undefined" ? performance.now() : Date.now(), r = 2.2): boolean {
  const v = vendorNear(x, z, r);
  if (!v) return false;
  const at = vendorRuntime.serving.get(v.id);
  if (at !== undefined && now - at < SERVE_MS + SERVE_COOL_MS) return now - at < SERVE_MS;
  vendorRuntime.serving.set(v.id, now);
  return true;
}

/** Servis ilerlemesi 0..1 (servis etmiyorsa −1). */
export function serveProgress(id: string, now: number): number {
  const at = vendorRuntime.serving.get(id);
  if (at === undefined) return -1;
  const u = (now - at) / SERVE_MS;
  return u >= 0 && u <= 1 ? u : -1;
}

// ------------------------------------------------------------------------------------------ el yapımı tezgâh (ritüel konumu)
export interface VenueAnchor { x: number; z: number; /** tezgâha bakış (rad; sin/cos → tezgâh yönü) */ face: number | null; kind: VenueKind; id: string }

/** Noktada satıcı gövdesi (taban + 0,3 … 1,2) katı bloğa girer mi; altındaki basılabilir üst yüz (−0,3 … 0,9) — yoksa null. */
function standAt(blocks: readonly Block[], x: number, z: number, half = 0.13): number | null {
  let floor = -Infinity;
  for (const b of blocks) {
    if (b.g !== "solid" && b.g !== "glass") continue;
    if (Math.abs(b.p[0] - x) > b.s[0] / 2 + half || Math.abs(b.p[2] - z) > b.s[2] / 2 + half) continue;
    const top = b.p[1] + b.s[1] / 2;
    const under = Math.abs(b.p[0] - x) <= b.s[0] / 2 && Math.abs(b.p[2] - z) <= b.s[2] / 2;
    // PROP-STAND-001: zemin alçak yüz ya da geniş platform; küçük eşya (kasa, araba çatısı, tezgâh) basılacak zemin değil
    if (under && top <= 0.9 && top >= -0.3 && (top <= 0.2 || (b.s[0] >= 1.2 && b.s[2] >= 1.2))) floor = Math.max(floor, top);
  }
  const ground = floor === -Infinity ? 0 : floor;
  for (const b of blocks) {
    if (b.g !== "solid" && b.g !== "glass") continue;
    if (Math.abs(b.p[0] - x) >= b.s[0] / 2 + half - 0.02 || Math.abs(b.p[2] - z) >= b.s[2] / 2 + half - 0.02) continue;
    const top = b.p[1] + b.s[1] / 2, bot = b.p[1] - b.s[1] / 2;
    if (top > ground + 0.3 && bot < ground + 1.2) return null;
  }
  return ground;
}

/** konumdan tezgâh yönündeki gerçek tezgâh/araba gövdesi üstü (en yüksek katı üst yüz, zeminin 0,15 … 1,4 üstü); yoksa zemin + 0,9.*/
function counterBetween(blocks: readonly Block[], ax: number, az: number, x: number, z: number, y: number): number {
  let top = -Infinity;
  for (let k = 1; k < 8; k++) {
    const px = ax + ((x - ax) * k) / 8, pz = az + ((z - az) * k) / 8;
    for (const b of blocks) {
      if (b.g !== "solid" || b.s[1] < 0.1 || Math.abs(b.p[0] - px) > b.s[0] / 2 || Math.abs(b.p[2] - pz) > b.s[2] / 2) continue; // ince kapak/çubuk tezgâh değil
      const t = b.p[1] + b.s[1] / 2;
      if (t > y + 0.15 && t < y + 1.4) top = Math.max(top, t);
    }
  }
  return +(top === -Infinity ? y + 0.9 : top).toFixed(3);
}

/**
 * Blok imzasıyla bulunan satıcılar + imzası olmayan (el yapımı) mekânlı ritüel konumları için satıcı: konumdan tezgâh yönünde
 * 1,0–1,9 arası ilk boş/basılabilir nokta (tezgâhın ardı). Yer bulunamazsa o konum atlanır (denetim yakalar).
 */
export function venueVendors(blocks: readonly Block[], anchors: readonly VenueAnchor[], idPrefix = "v"): Vendor[] {
  const out = vendorsFrom(blocks, idPrefix);
  for (const a of anchors) {
    if (a.face === null || vendorNear(a.x, a.z, 1.6, out)) continue;
    const fx = Math.sin(a.face), fz = Math.cos(a.face), rx = fz, rz = -fx;
    // açık araba/tezgâhta satıcı önce arabanın YANINDA (zeminde, tamamen görünür; müşteriye döner), sığmazsa ardında
    const spots: [number, number][] = [];
    for (const d of [1.0, 0.8, 1.25]) for (const l of [0.8, 1.0]) for (const sg of [1, -1]) spots.push([a.x + fx * d + rx * l * sg, a.z + fz * d + rz * l * sg]);
    for (const d of [1.25, 1.4, 1.1, 1.6, 1.9]) spots.push([a.x + fx * d, a.z + fz * d]);
    for (const [x, z] of spots) {
      const y = standAt(blocks, x, z);
      if (y === null) continue;
      out.push({ id: `${idPrefix}:${a.id}`, kind: a.kind, x, z, y: +y.toFixed(3), heading: Math.atan2(a.x - x, a.z - z), anchor: { x: a.x, z: a.z },
        counterTop: counterBetween(blocks, a.x, a.z, a.x + fx * 1.9, a.z + fz * 1.9, y), scale: "scene", roof: null });
      break;
    }
  }
  return out;
}
