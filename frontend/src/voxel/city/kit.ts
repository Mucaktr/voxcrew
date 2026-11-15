/**
 * SP-W0 — şehir kiti: şehir sahnelerinin ve şehir büyüme temasının (districts/city.ts)
 * ortak, birleştirilebilir yardımcıları. `buildings.ts` deseni: Builder alan SERBEST fonksiyonlar; yalnız var olan blok
 * gruplarıyla çizer (yeni malzeme / çizim çağrısı yok). Ontoloji nesnesi çizenler `noteObject` çağırır.
 *
 * IP/kültür kuralları (…): hepsi özgün ve stilizedir — gerçek bir yapının ölçüsü, süslemesi, logosu, livresi,
 * bayrağı ya da yazısı yoktur. Kubbe/minare gibi dinî silüetler yalnız DIŞ silüettir ve `sacredHall` çevresine `sacred`
 * bölge koyar (SACRED-* kuralları). Simge yapıya gece desenli/animasyonlu ışık verilmez: kit simgelere glow koymaz.
 *
 * Koordinat: (i, j) karo; `tx(i)`, `tz(j)` karo merkezi; zemin üstü y = 0; kamera +z'den bakar → cepheler varsayılan +z'ye.
 * Kat yüksekliği `CITY_STOREY` (1,6): şehir binaları şirin ve alçak ( oranı); yalnız görsel, ajanlar zemin katta.
 *
 * Döngüsel içe aktarma: scenes.ts'ten yalnız fonksiyon gövdelerinde kullanılan değerler + tipler.
*/
import { noteObject } from "../rules/hooks";
import { key, tx, tz, type Block, type Builder, type Group, type Mover, type Tile } from "../scenes";
import { pick2, type CityStyle, type FacadeKind, type RoofKind, type TreeKind } from "./style";
import { isInSacredBuffer } from "./sacred";
import { spotReach } from "../reach";
import { NEW_CITIES } from "../cities/index";
import { FULL_CANOPY_ACCENT } from "../../full/kit";

export const CITY_STOREY = 1.6;
const UP = 0, DOWN = Math.PI;

/** Çizim katmanı: "grid" sahne blokları (blok bütçesi, kural olguları), "backdrop" ufuk silüeti (Built.backdrop). */
export type Layer = "grid" | "backdrop";
function put(b: Builder, layer: Layer, x: number, y: number, z: number, w: number, h: number, d: number, c: string, g: Group = "solid", j = 0) {
  if (layer === "grid") b.box(x, y, z, w, h, d, c, g, j);
  else b.backdrop.push({ p: [x, y, z], s: [w, h, d], c, g, j } as Block);
}

// ------------------------------------------------------------------ zemin
export type Surface = "street" | "sidewalk" | "plaza" | "grass" | "quay" | "water";

/** Şehir zemini: her karo bir yüzey türü; su karoları zemin küpü almaz (`waterBody` ile doldurulur). */
export function paintCity(b: Builder, s: CityStyle, surf: (i: number, j: number) => Surface): void {
  b.ground((i, j) => {
    const k = surf(i, j);
    return k === "water" ? null : pick2(s.ground[k], i, j);
  }, s.ground.under, 0.04);
}

/** Su gövdesi (nehir, Boğaz, kanal): satır başına birleşik "water" kutusu (üst −0,2), karolar engelli. `hook`: deniz/gölet
 *  kancası (martı, ördek) merkeze. */
export function waterBody(b: Builder, s: CityStyle, i0: number, j0: number, i1: number, j1: number, hook: "sea" | "pond" | null = "sea"): void {
  for (let j = j0; j <= j1; j++) {
    b.box((tx(i0) + tx(i1)) / 2, -0.6, tz(j), i1 - i0 + 1, 0.8, 1, s.water, "water", 0);
    for (let i = i0; i <= i1; i++) b.block(i, j);
  }
  // seyrek köpük şeritleri (dalga grubu; hareket azaltmada durağan)
  for (let i = i0; i <= i1; i += 3) for (let j = j0; j <= j1; j += 2) if ((i * 7 + j * 3) % 5 === 0) b.box(tx(i) + 0.2, -0.17, tz(j), 0.6, 0.04, 0.14, "#E6F4FB", "wave");
  if (hook) b.hook(hook, Math.round((i0 + i1) / 2), Math.round((j0 + j1) / 2), Math.max(1, Math.min(i1 - i0, j1 - j0) / 2));
}

/** Rıhtım kenarı: `j` satırındaki yürünebilir karoların su tarafında taş bordür, aralıklı babalar. `fish`: bu i'lerde balık
 *  tutma kancası (S48; karo yürünebilir, `side` yönündeki komşu su). */
export function quay(b: Builder, s: CityStyle, i0: number, i1: number, j: number, side: "+z" | "-z", fish: number[] = [], skip: number[] = []): void {
  const sg = side === "+z" ? 1 : -1;
  b.box((tx(i0) + tx(i1)) / 2, 0.06, tz(j) + sg * 0.44, i1 - i0 + 1, 0.12, 0.12, s.ground.quay[1], "solid", 0.03);
  // WALK-SCALE: babalar su kenarına yaslı (merkez artı şeridinin dışında: rıhtım karosu yol bulmada açık kalır) ve köprü
  // inişinde yok: su tarafındaki komşu açıksa (köprü önce kurulduysa) ya da `skip` (köprü rıhtımdan sonra kurulacaksa).
  // Not: dünya kaydı blokları sırayla tutar; sonradan blok silmek pişirmeyle uyuşmaz, bu yüzden karar burada verilir.
  for (let i = i0 + 1; i <= i1; i += 4) {
    if (skip.includes(i) || !b.blocked.has(key(i, j + sg))) continue;
    const z = tz(j) + sg * BOLLARD_OFF;
    b.box(tx(i), 0.2, z, 0.18, 0.4, 0.18, BOLLARD);
    b.box(tx(i), 0.42, z, 0.24, 0.06, 0.24, BOLLARD);
  }
  for (const i of fish) b.hook("fish", i, j, side === "+z" ? 0 : 1);
}

/** Rıhtım babası: renk ve su kenarından içe merkez uzaklığı (başlık 0,24 → su kenarına yaslı; WALK-SCALE). */
const BOLLARD = "#3A3F47";
export const BOLLARD_OFF = 0.39;

/** Taş kemer köprü: `i0..i1` sütunlarında (x boyunca köprü yolu `j0..j1` satırları) su üstünde yürünebilir güverte. */
export function archBridge(b: Builder, s: CityStyle, i0: number, i1: number, j0: number, j1: number, stone = "#BFB4A0"): void {
  const x = (tx(i0) + tx(i1)) / 2, w = i1 - i0 + 1;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) b.blocked.delete(key(i, j));
    b.box(x, -0.05, tz(j), w, 0.14, 1, pick2(s.ground.plaza, j, i0), "solid", 0.03);
  }
  const z0 = tz(j0) - 0.5, z1 = tz(j1) + 0.5, len = z1 - z0;
  for (const sx of [-1, 1]) b.box(x + sx * (w / 2 - 0.06), 0.3, (z0 + z1) / 2, 0.12, 0.5, len, stone, "solid", 0.03);
  // kemer: altta iki ayak + yay
  for (const f of [0.18, 0.82]) b.box(x, -0.55, z0 + len * f, w - 0.1, 0.9, 0.5, stone, "solid", 0.04);
  b.box(x, -0.22, (z0 + z1) / 2, w - 0.1, 0.24, len * 0.5, stone, "solid", 0.04);
}

// ------------------------------------------------------------------ sokak
/** Yaya geçidi: `i` sütununda (x boyunca sokak) ya da `j` satırında beyaz şeritler (engellemez). */
export function crosswalk(b: Builder, axis: "x" | "z", line: number, from: number, to: number): void {
  for (let k = from; k <= to; k++) for (const o of [-0.3, 0, 0.3]) {
    if (axis === "z") b.box(tx(line) + o, 0.012, tz(k), 0.16, 0.024, 0.8, "#F4F4F0");
    else b.box(tx(k), 0.012, tz(line) + o, 0.8, 0.024, 0.16, "#F4F4F0");
  }
}

/** Tramvay rayı (x boyunca, `j` satırı): iki ray + aralıklı travers (engellemez). Yolu `tramPath` verir. */
export function tramRail(b: Builder, j: number, i0: number, i1: number): void {
  const x = (tx(i0) + tx(i1)) / 2, w = i1 - i0 + 1;
  for (const o of [-0.26, 0.26]) b.box(x, 0.02, tz(j) + o, w, 0.04, 0.07, "#8A8F98");
  for (let i = i0; i <= i1; i += 2) b.box(tx(i), 0.008, tz(j), 0.18, 0.016, 0.7, "#5B4A3A");
}
/** Tramvay `mover` yolu (rayın üstü). */
export const tramPath = (j: number, i0: number, i1: number): [number, number, number][] => [[tx(i0), 0.04, tz(j)], [tx(i1), 0.04, tz(j)]];

/** Sokak lambası: direk + fener (glow) + gece ışık havuzu (`lamp` işareti). Karoyu engeller. */
export function streetLamp(b: Builder, s: CityStyle, i: number, j: number): void {
  const x = tx(i), z = tz(j);
  b.box(x, 0.12, z, 0.3, 0.24, 0.3, s.lamp.post);
  b.box(x, 1.1, z, 0.1, 2.0, 0.1, s.lamp.post);
  b.box(x, 2.18, z, 0.34, 0.3, 0.34, s.lamp.glow, "glow");
  b.box(x, 2.38, z, 0.44, 0.1, 0.44, s.lamp.post);
  b.props.push({ k: "lamp", p: [x, 2.18, z], r: 0, s: [2.6, 0], c: s.lamp.glow });
  b.block(i, j);
}

/** Şehir bankı (1 karo, engellemez): istasyon (`sit_bench`, dizüstü) ya da dinlenme karosu olarak kullanılır.
 * / K1: `Builder.parkBench` (n = 1) ile aynı ayak ve oturak (chibi oturak üstü ≈ 0,465; `sit_bench` istasyonu 0,46);
 * yalnız sırt incelir: 0,59–0,89 tahta yerine 0,49–0,59 (yürüme insanının 0,6'sı). Sırt iki yarım tahtadır (ortada direk
 * aralığı); tek geniş tahta 0,3–0,6 bandında oturak sanılır (scale_check bank sondası).*/
export function cityBench(b: Builder, i: number, j: number, face: "+z" | "-z", seat = "#6B4A2E", leg = "#2F3640"): void {
  const x = tx(i), z = tz(j), s = face === "+z" ? -1 : 1;
  for (const dx of [-0.34, 0.34]) {
    b.box(x + dx, 0.2, z, 0.1, 0.4, 0.52, leg);
    b.box(x + dx, 0.47, z + s * 0.3, 0.08, 0.24, 0.08, leg);
  }
  b.box(x, 0.43, z + s * 0.02, 0.92, 0.07, 0.52, seat, "solid", 0.03);
  for (const dx of [-0.235, 0.235]) b.box(x + dx, 0.54, z + s * 0.3, 0.45, 0.1, 0.06, seat, "solid", 0.03);
}

/** Saksı sırası (x boyunca; engeller). */
export function planterRow(b: Builder, i0: number, i1: number, j: number, box = "#9C9488", green = "#3E8E3E"): void {
  for (let i = i0; i <= i1; i++) {
    b.box(tx(i), 0.25, tz(j), 0.8, 0.5, 0.6, box, "solid", 0.04);
    b.box(tx(i), 0.6, tz(j), 0.7, 0.3, 0.5, green, "solid", 0.12);
    b.block(i, j);
  }
}

const TREE: Record<TreeKind, { trunk: string; leaf: [string, string]; h: number }> = {
  plane: { trunk: "#7A6A55", leaf: ["#4E9A3E", "#5DAE48"], h: 2.2 },
  cherry: { trunk: "#5D3A2A", leaf: ["#F4B6C8", "#F9CCD9"], h: 1.8 },
  judas: { trunk: "#5D3A2A", leaf: ["#C86AA6", "#D985B8"], h: 1.8 },
  birch: { trunk: "#EDEAE4", leaf: ["#8CC152", "#A0D468"], h: 2.4 },
  cypress: { trunk: "#5D3A1A", leaf: ["#2E5E3A", "#356B42"], h: 1.0 },
  palm: { trunk: "#9C7A54", leaf: ["#2E9E4F", "#38B25A"], h: 3 },
};
// ------------------------------------------------------------------ (C1): mevsimlik taç renkleri
/**
 * Taçlar yapımda yukarıdaki (yaz) renklerle çizilir; mevsim ÇALIŞMA ANINDA örnek rengine eşlenir (props/weather.ts `tintHex`,
 * Blocks + kuyruk yazıcısı). Yapım ve dünya JSON'u değişmez; yeni mesh yok. Eşlenen renkler yalnız ağaç taçlarıdır: kit ağaçları,
 * ek sahnenin ağacı (#4E9A3E) ve şehir haritası semt ağacı (citymap/district.ts #5F8F45). Ortak kullanılan iki ton bilinçli:
 * #5DAE48 (çit/saksı) ve kiraz pembesi (yer yaprakları/saksı) ağaçla birlikte döner (yaprak dökümü gibi görünür).
 * Herdem yeşiller (servi, çam) ve palmiye eşlenmez. Kat 0 alt taç, kat 1 üst taç.
 */
type CanopyClass = "leafy" | "blossom" | "birch";
const CANOPY_HEX: Readonly<Record<string, readonly [CanopyClass, 0 | 1]>> = {
  "#4E9A3E": ["leafy", 0], "#5DAE48": ["leafy", 1], "#5F8F45": ["leafy", 0],
  "#F4B6C8": ["blossom", 0], "#F9CCD9": ["blossom", 1], "#C86AA6": ["blossom", 0], "#D985B8": ["blossom", 1],
  "#8CC152": ["birch", 0], "#A0D468": ["birch", 1],
};
type CanopyLook = "spring" | "summer" | "autumn" | "bare" | "snow";
/** null: yapım rengi (değişmez). */
const CANOPY_SEASON: Readonly<Record<CanopyClass, Readonly<Record<CanopyLook, readonly [string, string] | null>>>> = {
  leafy: { spring: ["#6DB54A", "#F3D3DE"], summer: null, autumn: ["#C8702E", "#E0A040"], bare: ["#8C7B66", "#9A8A74"], snow: ["#8C7B66", "#EEF3F7"] },
  blossom: { spring: null, summer: ["#4E9A3E", "#5DAE48"], autumn: ["#C0503A", "#DD8236"], bare: ["#7E6656", "#8E7666"], snow: ["#7E6656", "#EEF3F7"] },
  birch: { spring: ["#A6D877", "#C3E79B"], summer: null, autumn: ["#E2B53C", "#EFCB57"], bare: ["#B9B2A6", "#C9C3B8"], snow: ["#B9B2A6", "#F1F5F9"] },
};
/** Küçük şehir vurgusu (ucuz: yalnız ton): İstanbul ilkbaharda erguvan, Kapadokya güz tonu (ve ek şehirlerde kendi tonları). */
const CANOPY_ACCENT: Readonly<Record<string, { spring?: string; autumn?: readonly [string, string] }>> = {
  istanbul: { spring: "#E09AC4" },
  ...FULL_CANOPY_ACCENT,
  kapadokya: { autumn: ["#D6A13A", "#E8C25A"] },
  ...Object.fromEntries(NEW_CITIES.flatMap((m) => (m.canopy ? [[m.catalog.id, m.canopy] as const] : []))),
};
/** Mevsim taç eşlemi (büyük harf hex → renk). Tropikal ya da tabloda olmayan yer, yaz ya da mevsimsiz: boş eşlem. */
export function canopyTint(place: string | null | undefined, season: "spring" | "summer" | "autumn" | "winter" | null,
  climate: { tropical: boolean; winter: "bare" | "snow" } | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!place || !season || !climate || climate.tropical) return out;
  const look: CanopyLook = season === "winter" ? climate.winter : season;
  const acc = CANOPY_ACCENT[place];
  for (const [hex, [cls, layer]] of Object.entries(CANOPY_HEX)) {
    let pair = CANOPY_SEASON[cls][look];
    if (look === "autumn" && acc?.autumn && cls !== "birch") pair = acc.autumn;
    let c = pair ? pair[layer] : null;
    if (look === "spring" && acc?.spring && layer === 1) c = acc.spring;
    if (c && c.toUpperCase() !== hex) out.set(hex, c.toUpperCase());
  }
  return out;
}

/** Şehir ağacı (tür stilden ya da açıkça): gövde karosu engelli, `tree` kancası (kuş). */
export function cityTree(b: Builder, i: number, j: number, kind: TreeKind): void {
  if (kind === "palm") { b.palm(i, j); return; }
  const t = TREE[kind], x = tx(i), z = tz(j);
  b.box(x, t.h / 2, z, 0.26, t.h, 0.26, t.trunk, "solid", 0.05);
  if (kind === "cypress") {
    [[0.9, 1.6], [0.75, 2.6], [0.55, 3.5], [0.3, 4.2]].forEach(([w, y]) => b.box(x, y, z, w, 1.1, w, t.leaf[0], "solid", 0.1));
  } else {
    b.box(x, t.h + 0.45, z, 1.7, 0.9, 1.7, t.leaf[0], "solid", 0.12);
    b.box(x, t.h + 1.05, z, 1.2, 0.5, 1.2, t.leaf[1], "solid", 0.12);
  }
  b.block(i, j);
  b.hook("tree", i, j);
}

// ------------------------------------------------------------------ yapı
export interface HouseOpts {
  floors: number;
  facade?: FacadeKind;
  roof?: RoofKind;
  /** cephe rengi (yoksa stilin `walls` listesinden `i0`'a göre) */
  wall?: string;
  /** zemin katta dükkân tentesi rengi (yoksa yok) */
  shop?: string | null;
  /** ön yüzde kapı (yerel sütun) */
  door?: number;
  /** gece pencereleri yanar mı (simge yapıda false —)*/
  lit?: boolean;
  layer?: Layer;
}

/** Sıra ev / apartman bloğu: (i0, j0) sol-arka karo, w × d; cephe +z'ye bakar. Stil: `row` (boyalı cephe + kat çizgisi +
 *  beşik çatı), `haussmann` (krem taş, yüksek zemin kat, demir balkon şeridi, çinko mansart + çatı penceresi + bacalar),
 *  `ottoman` (pastel ahşap, üst katta öne taşan cumba, geniş saçak, kiremit kırma çatı, kepenk). Ayak izini engeller. */
export function rowHouse(b: Builder, s: CityStyle, i0: number, j0: number, w: number, d: number, o: HouseOpts): void {
  const layer = o.layer ?? "grid", facade = o.facade ?? s.facade, H = CITY_STOREY;
  const wall = o.wall ?? s.walls[((i0 * 7 + j0 * 3) % s.walls.length + s.walls.length) % s.walls.length];
  const x = (tx(i0) + tx(i0 + w - 1)) / 2, z = (tz(j0) + tz(j0 + d - 1)) / 2;
  const front = tz(j0 + d - 1) + 0.5;
  const ground = facade === "haussmann" ? H * 1.25 : H;
  const top = ground + (o.floors - 1) * H;
  if (layer === "grid") noteObject(b, "tower", [i0, j0], { w, d, floors: o.floors, y: top, enclosed: true });
  put(b, layer, x, top / 2, z, w, top, d, wall, "solid", 0.03);
  if (facade === "haussmann") put(b, layer, x, ground / 2, front - 0.02, w + 0.02, ground, 0.08, "#CDBFA6", "solid", 0.02);
  // kat çizgileri ve pencereler (her karo bir pencere; kapı sütunu zemin katta boş)
  for (let f = 0; f < o.floors; f++) {
    const y0 = f === 0 ? 0 : ground + (f - 1) * H, fh = f === 0 ? ground : H;
    if (f > 0) put(b, layer, x, y0, front, w + 0.06, 0.1, 0.12, s.trim);
    for (let k = 0; k < w; k++) {
      const wx = tx(i0 + k);
      if (f === 0 && (o.door ?? Math.floor(w / 2)) === k) {
        put(b, layer, wx, 0.6, front + 0.02, 0.5, 1.2, 0.05, s.door);
        continue;
      }
      if (f === 0 && o.shop) {
        put(b, layer, wx, 0.55, front + 0.02, 0.8, 0.8, 0.04, "#A8D8F0", "glass");
        continue;
      }
      const wy = y0 + fh * 0.55, wh = fh * 0.5;
      put(b, layer, wx, wy, front + 0.02, 0.44, wh, 0.05, s.window);
      if (layer === "grid" && o.lit !== false) b.props.push({ k: "window", p: [wx, wy, front + 0.05], r: 0, s: [0.4, wh - 0.04], c: s.windowLit });
      if (facade === "ottoman") for (const sx of [-1, 1]) put(b, layer, wx + sx * 0.3, wy, front + 0.03, 0.12, wh, 0.04, s.trim);
    }
    if (facade === "haussmann" && f >= 1 && (f === 1 || f === o.floors - 1)) put(b, layer, x, y0 + 0.12, front + 0.18, w, 0.06, 0.3, "#2B2F36");
    if (facade === "haussmann" && f >= 1 && (f === 1 || f === o.floors - 1)) put(b, layer, x, y0 + 0.4, front + 0.32, w, 0.04, 0.03, "#2B2F36");
    // CITY-PASS-PAR (REAL-SUPPORT-001): balkon korkuluğu dikmelerle döşemeye bağlı (eskiden 0,23 havada duruyordu)
    if (facade === "haussmann" && f >= 1 && (f === 1 || f === o.floors - 1)) {
      const nb = Math.max(2, Math.round(w / 0.5));
      for (let k = 0; k <= nb; k++) put(b, layer, x - w / 2 + 0.03 + ((w - 0.06) * k) / nb, y0 + 0.28, front + 0.32, 0.03, 0.26, 0.03, "#2B2F36");
    }
  }
  // cumba: üst katlarda ortada öne taşan çıkma
  if (facade === "ottoman" && o.floors >= 2 && w >= 2) {
    const ch = (o.floors - 1) * H;
    put(b, layer, x, ground + ch / 2, front + 0.22, Math.max(1, w - 1), ch, 0.44, wall, "solid", 0.03);
    put(b, layer, x, ground - 0.06, front + 0.22, Math.max(1, w - 1) + 0.1, 0.12, 0.5, s.trim);
    for (let f = 1; f < o.floors; f++) put(b, layer, x, ground + (f - 1) * H + H * 0.55, front + 0.45, Math.max(0.6, w - 1.4), H * 0.45, 0.04, s.window);
  }
  if (o.shop) put(b, layer, x, ground - 0.15, front + 0.35, w, 0.08, 0.7, o.shop, "solid", 0.02);
  roof(b, o.roof ?? s.roof, x, top, z, w, d, s.roofColor, layer, facade === "ottoman" ? 0.35 : 0.12);
  if (layer === "grid") for (let i = i0; i < i0 + w; i++) for (let j = j0; j < j0 + d; j++) b.block(i, j);
}

/** Çatı: `zinc` mansart (iki kademe gri-mavi + çatı pencereleri + bacalar), `tile` beşik/kırma kiremit (kademeli), `flat`
 *  parapet, `curved` tonoz (kademeli yay). (x, z) merkez, y çatı tabanı. `eave`: saçak taşması. */
export function roof(b: Builder, kind: RoofKind, x: number, y: number, z: number, w: number, d: number, c: string,
  layer: Layer = "grid", eave = 0.12): void {
  if (kind === "flat") {
    put(b, layer, x, y + 0.12, z, w + 0.06, 0.24, d + 0.06, c, "solid", 0.02);
    return;
  }
  if (kind === "zinc") {
    put(b, layer, x, y + 0.3, z, w + eave, 0.6, d + eave, "#7D8B99", "solid", 0.03);
    put(b, layer, x, y + 0.75, z, w - 0.4, 0.4, d - 0.4, "#6C7A88", "solid", 0.03);
    for (let k = 0; k < Math.max(1, Math.floor(w / 2)); k++) {
      const dx = x - w / 2 + 1 + k * 2;
      put(b, layer, dx, y + 0.45, z + d / 2 + 0.02, 0.36, 0.4, 0.2, "#E9E4DA");
    }
    for (const sx of [-1, 1]) put(b, layer, x + sx * (w / 2 - 0.35), y + 1.1, z - d / 4, 0.3, 0.55, 0.3, "#B9A68D", "solid", 0.04);
    return;
  }
  if (kind === "curved") {
    [[1, 0.25], [0.8, 0.5], [0.5, 0.7]].forEach(([f, h]) => put(b, layer, x, y + h / 2 + (1 - f) * 0.5, z, w + eave, h, (d + eave) * f, c, "solid", 0.03));
    return;
  }
  // kiremit: d boyunca daralan dört kademe (beşik), kenarda saçak
  [[1, 0], [0.72, 1], [0.46, 2], [0.22, 3]].forEach(([f, k]) =>
    put(b, layer, x, y + 0.14 + k * 0.26, z, w + eave * 2, 0.28, Math.max(0.2, (d + eave * 2) * f), c, "solid", 0.05));
}

/** Kubbe: (x, z) merkez, y taban, r yarıçap; kademeli kutular + tepe topuzu (genel; belirli bir yapının birebiri değil). */
export function dome(b: Builder, x: number, y: number, z: number, r: number, c: string, layer: Layer = "grid", finial = "#C9A44C"): void {
  const steps = r > 1.5 ? 5 : 4;
  for (let k = 0; k < steps; k++) {
    const a = ((k + 0.5) / steps) * (Math.PI / 2), w = 2 * r * Math.cos(a), h = (r / steps) * 1.05;
    put(b, layer, x, y + r * Math.sin(a) - h / 2 + 0.05, z, w, h, w, c, "solid", 0.03);
  }
  put(b, layer, x, y + r + 0.12, z, 0.14, 0.3, 0.14, finial);
  put(b, layer, x, y + r + 0.32, z, 0.22, 0.14, 0.22, finial);
}

/** Minare silüeti (genel, ince kule + şerefe + külah). Yalnız dış silüet; `sacredHall` çevresine sacred bölge koyar. */
export function minaret(b: Builder, x: number, z: number, h: number, c: string, cap = "#7D8B99", layer: Layer = "grid"): void {
  put(b, layer, x, 0.4, z, 0.7, 0.8, 0.7, c, "solid", 0.03);
  put(b, layer, x, h / 2, z, 0.46, h, 0.46, c, "solid", 0.03);
  put(b, layer, x, h * 0.72, z, 0.72, 0.12, 0.72, c);
  put(b, layer, x, h * 0.72 + 0.2, z, 0.62, 0.3, 0.62, c, "solid", 0.02);
  [[0.4, 0], [0.28, 1], [0.16, 2]].forEach(([w, k]) => put(b, layer, x, h + 0.25 + k * 0.42, z, w, 0.45, w, cap, "solid", 0.02));
}

export interface SacredOpts {
  wall?: string;
  domeColor?: string;
  /** köşelerde 0, 2 ya da 4 minare silüeti (yalnız dış silüet; `0` örn. kubbeli kilise/tapınak silüeti) */
  minarets?: 0 | 2 | 4;
  /** sacred tampon (karo; varsayılan 1) */
  buffer?: number;
}
/** Kubbeli ibadet yapısının dış silüeti: ayak izi engelli, içi modellenmez; ayak izine `sacred` bölge (tampon 1).
 * Bölgeye istasyon/uyku/eğlence/ambient kanca konmaz (SACRED-* kuralları; kitin geri kalanı bunu çağıranın planına bırakır).*/
export function sacredHall(b: Builder, s: CityStyle, i0: number, j0: number, w: number, d: number, o: SacredOpts = {}): void {
  const wall = o.wall ?? "#E9E1D0", dc = o.domeColor ?? "#8E9AA6";
  const x = (tx(i0) + tx(i0 + w - 1)) / 2, z = (tz(j0) + tz(j0 + d - 1)) / 2, H = CITY_STOREY * 1.4;
  noteObject(b, "tower", [i0, j0], { w, d, floors: 1, y: H, enclosed: true });
  b.box(x, H / 2, z, w - 0.2, H, d - 0.2, wall, "solid", 0.03);
  b.box(x, H + 0.08, z, w, 0.16, d, s.trim);
  // kemerli giriş (dış silüet; içerisi yok)
  b.box(x, 0.8, z + d / 2 - 0.08, 0.9, 1.6, 0.06, "#5C4A3A");
  b.box(x, 1.65, z + d / 2 - 0.07, 0.6, 0.2, 0.06, "#5C4A3A");
  dome(b, x, H + 0.16, z, Math.min(w, d) * 0.42, dc);
  if (w >= 4) for (const sx of [-1, 1]) dome(b, x + sx * (w / 2 - 0.9), H + 0.16, z + d / 2 - 0.9, 0.6, dc);
  const n = o.minarets ?? 2;
  const corners: [number, number][] = n === 4 ? [[-1, -1], [1, -1], [-1, 1], [1, 1]] : n === 2 ? [[-1, -1], [1, -1]] : [];
  for (const [sx, sz] of corners) minaret(b, x + sx * (w / 2 - 0.25), z + sz * (d / 2 - 0.25), H * 2.4, wall, dc);
  for (let i = i0; i < i0 + w; i++) for (let j = j0; j < j0 + d; j++) b.block(i, j);
  sacredZone(b, i0, j0, w, d, o.buffer ?? 1);
}

/** Sacred bölge kaydı (plan §3.3). Ayak izinin dışındaki tampon karolar yürünebilir kalır ("bağlantı").*/
export function sacredZone(b: Builder, i0: number, j0: number, w: number, d: number, buffer = 1): void {
  b.zones.push({ kind: "sacred", i0, j0, w, d, buffer });
}

// ------------------------------------------------------------------ tezgâh ve sokak eşyası
export type StallKind = "fruit" | "bread" | "flowers" | "books" | "crafts" | "tea";
const GOODS: Record<StallKind, string[]> = {
  fruit: ["#E5484D", "#F59E0B", "#84CC16", "#FACC15"],
  bread: ["#D9A35B", "#C68A3E", "#E8C07A", "#B87333"],
  flowers: ["#F472B6", "#FDE047", "#A78BFA", "#FFFFFF"],
  books: ["#3B82F6", "#EF4444", "#10B981", "#F59E0B"],
  crafts: ["#B5543C", "#2F7FC4", "#D9A441", "#6B8E23"],
  tea: ["#B91C1C", "#F8FAFC", "#D97706", "#7C2D12"],
};
/** Pazar tezgâhı (1×1, karoyu engeller): tezgâh + mal + direkler + çizgili tente. Satıcı istasyonu `(i, j−1)`'de `stand`,
 *  +z'ye bakar (`marketStation`); tezgâh önü (j+1) müşteri/dinlenme karosu olabilir. */
export function marketStall(b: Builder, s: CityStyle, i: number, j: number, kind: StallKind, awning?: string): void {
  const x = tx(i), z = tz(j), aw = awning ?? s.awnings[(i + j) % s.awnings.length];
  b.box(x, 0.45, z, 0.92, 0.9, 0.62, "#8B6A47", "solid", 0.04);
  b.box(x, 0.92, z, 0.98, 0.06, 0.7, "#A47148");
  GOODS[kind].forEach((c, k) => b.box(x - 0.33 + k * 0.22, 1.02, z + (k % 2 ? 0.1 : -0.1), 0.18, 0.14, 0.18, c));
  for (const dx of [-0.44, 0.44]) b.box(x + dx, 1.25, z - 0.3, 0.06, 1.6, 0.06, "#5B4A3A");
  for (let k = 0; k < 3; k++) b.box(x - 0.32 + k * 0.32, 2.05, z, 0.32, 0.08, 1.0, k % 2 ? "#F8FAFC" : aw);
  b.block(i, j);
}
/** Tezgâhın satıcı istasyonu (ayakta, tablet; tezgâha bakar). */
export function marketStation(b: Builder, i: number, j: number): void {
  b.station(i, j - 1, UP, "stand", "tablet");
}

/** Kafe masası (engelli). Sandalyeleri çizmez: istasyon karolarına (`cafeStations`) canlı dekor ahşap sandalyeyi koyar
 *  (Props.tsx; ikinci sandalye çizilmez). */
export function cafeSet(b: Builder, i: number, j: number, top = "#F4EFE6"): void {
  const x = tx(i), z = tz(j);
  b.box(x, 0.36, z, 0.08, 0.72, 0.08, "#2F3640");
  b.box(x, 0.02, z, 0.4, 0.04, 0.4, "#2F3640");
  b.box(x, 0.74, z, 0.72, 0.05, 0.72, top, "solid", 0.02);
  b.box(x + 0.18, 0.8, z + 0.05, 0.1, 0.08, 0.1, "#F8FAFC");
  b.block(i, j);
}
/** Kafe masasının iki istasyonu (j−1 ve j+1; masaya bakar). */
export function cafeStations(b: Builder, i: number, j: number): void {
  b.station(i, j - 1, UP, "sit_chair", "laptop");
  b.station(i, j + 1, DOWN, "sit_chair", "laptop");
}

/** Küçük kiosk (gazete/çay/simit; 1×1, engeller) + kahve/mola noktası (önündeki karo). */
export function kiosk(b: Builder, s: CityStyle, i: number, j: number, roofC?: string): void {
  const x = tx(i), z = tz(j);
  b.box(x, 0.7, z, 0.9, 1.4, 0.9, s.trim, "solid", 0.03);
  b.box(x, 0.85, z + 0.46, 0.7, 0.45, 0.03, "#A8D8F0", "glass");
  b.box(x, 1.5, z, 1.1, 0.14, 1.1, roofC ?? s.roofColor, "solid", 0.02);
  b.props.push({ k: "coffee", p: [x, 0, z], r: 0, tile: [i, j + 1] });
  b.block(i, j);
}

// ------------------------------------------------------------------ yürüme (gerçek oran) sokak eşyası
// Şehir haritası yalnız yürüme modunda görülür (genel bakışı yok): eşya yürüme insanına (1,0) göre gerçek orandadır
// (walk/scaleStandard.ts; K1). Sahne kiti (cityBench, planterRow, marketStall, cafeSet) chibi kalır. `*At` biçimleri dünya
// koordinatında ve kutu yazıcısıyla çizer (şehir haritası süsleri `citymap/design.ts sink`); Builder biçimleri karoyu
// engeller (bank engellemez), sahne kitinin imzasını taşır.
/** Kutu yazıcısı: `Builder.box` ve şehir haritası `Sink` ile aynı imza. */
export type BoxFn = (x: number, y: number, z: number, w: number, h: number, d: number, c: string, g?: Group, j?: number) => void;
/** Oturanın (ya da müşterinin) baktığı yön. */
export type WalkFace = "+z" | "-z" | "+x" | "-x";
const boxOf = (b: Builder): BoxFn => (x, y, z, w, h, d, c, g = "solid", j = 0) => b.box(x, y, z, w, h, d, c, g, j);
/** Yöne göre yerel kutu: `u` boy ekseni, `v` arkaya doğru (bakışın tersi). */
function faced(box: BoxFn, x: number, z: number, face: WalkFace) {
  const back = face === "+z" || face === "+x" ? -1 : 1, alongX = face === "+z" || face === "-z";
  return (u: number, y: number, v: number, lu: number, h: number, lv: number, c: string, j = 0) =>
    alongX ? box(x + u, y, z + back * v, lu, h, lv, c, "solid", j) : box(x + back * v, y, z + u, lv, h, lu, c, "solid", j);
}

/** Yürüme bankı: oturak üstü 0,315 (diz/kalça; oturan kalçası `SEAT_HIP` 0,32 — ritüel oturuşu oturağa değer), sırt üstü 0,55.
 *  7 kutu. Sırt iki yarım tahta: tek geniş tahta 0,3–0,6 bandında oturak sanılır (scale_check bank sondası). */
export function walkBenchAt(box: BoxFn, x: number, z: number, face: WalkFace, len = 1.4, seat = "#6B4A2E", leg = "#2F3640"): void {
  const q = faced(box, x, z, face), half = len / 2, w = (len - 0.1) / 2;
  for (const su of [-1, 1]) {
    q(su * (half - 0.12), 0.145, 0, 0.06, 0.29, 0.34, leg);
    q(su * (half - 0.12), 0.425, 0.17, 0.06, 0.25, 0.05, leg);
    q(su * (w / 2 + 0.01), 0.49, 0.19, w, 0.12, 0.04, seat, 0.03);
  }
  q(0, 0.302, 0, len - 0.06, 0.026, 0.4, seat, 0.03);
}
/** Yürüme saksısı (tek kutu + yeşil): üstü 0,45. */
export function walkPlanterAt(box: BoxFn, x: number, z: number, w = 0.8, d = 0.6, boxC = "#9C9488", green = "#3E8E3E"): void {
  box(x, 0.15, z, w, 0.3, d, boxC, "solid", 0.04);
  box(x, 0.375, z, w - 0.1, 0.15, d - 0.1, green, "solid", 0.12);
}
/** Yürüme pazar tezgâhı: tezgâh üstü 0,52, mal 0,64, çizgili tente üstü 1,40 (altında insan durur). Direkler arkada; müşteri
 *  `face` yönünde. 11 kutu (sahne `marketStall` ile aynı sayı). */
export function walkMarketStallAt(box: BoxFn, x: number, z: number, face: WalkFace, goods: readonly string[], awning: string,
  body = "#8B6A47", top = "#A47148"): void {
  const q = faced(box, x, z, face);
  q(0, 0.24, 0, 0.92, 0.48, 0.6, body, 0.04);
  q(0, 0.5, 0, 0.98, 0.04, 0.68, top);
  goods.slice(0, 4).forEach((c, k) => q(-0.33 + k * 0.22, 0.58, k % 2 ? -0.1 : 0.1, 0.18, 0.12, 0.18, c));
  for (const du of [-0.44, 0.44]) q(du, 0.68, 0.3, 0.05, 1.36, 0.05, "#5B4A3A");
  for (let k = 0; k < 3; k++) q(-0.32 + k * 0.32, 1.37, 0, 0.32, 0.06, 1.0, k % 2 ? "#F8FAFC" : awning);
}
/** Yürüme kafe masası: masa yüzeyi 0,45 (gerçek ~0,75 m), tek ayak, fincan. Sandalye çizmez. */
export function walkCafeSetAt(box: BoxFn, x: number, z: number, top = "#F4EFE6", frame = "#2F3640"): void {
  box(x, 0.21, z, 0.05, 0.42, 0.05, frame, "solid", 0);
  box(x, 0.015, z, 0.3, 0.03, 0.3, frame, "solid", 0);
  box(x, 0.43, z, 0.6, 0.04, 0.6, top, "solid", 0.02);
  box(x + 0.15, 0.48, z + 0.04, 0.07, 0.06, 0.07, "#F8FAFC", "solid", 0);
}

/** `cityBench` yürüme varyantı (1 karo, engellemez). */
export function walkBench(b: Builder, i: number, j: number, face: "+z" | "-z", seat = "#6B4A2E", leg = "#2F3640"): void {
  walkBenchAt(boxOf(b), tx(i), tz(j), face, 1, seat, leg);
}
/** `planterRow` yürüme varyantı (x boyunca; engeller). */
export function walkPlanterRow(b: Builder, i0: number, i1: number, j: number, box = "#9C9488", green = "#3E8E3E"): void {
  for (let i = i0; i <= i1; i++) { walkPlanterAt(boxOf(b), tx(i), tz(j), 0.8, 0.6, box, green); b.block(i, j); }
}
/** `marketStall` yürüme varyantı (1×1, engeller; müşteri +z). */
export function walkMarketStall(b: Builder, s: CityStyle, i: number, j: number, kind: StallKind, awning?: string): void {
  walkMarketStallAt(boxOf(b), tx(i), tz(j), "+z", GOODS[kind], awning ?? s.awnings[(i + j) % s.awnings.length]);
  b.block(i, j);
}
/** `cafeSet` yürüme varyantı (engelli). */
export function walkCafeSet(b: Builder, i: number, j: number, top = "#F4EFE6"): void {
  walkCafeSetAt(boxOf(b), tx(i), tz(j), top);
  b.block(i, j);
}

// ------------------------------------------------------------------ hareketli set parçası
/** Hareketli set parçası ekler (props/movers.ts çizer). Bütçe: sahne başına ≤ 12 (SCENE-MOVER-001). */
export function addMover(b: Builder, m: Mover): void {
  b.movers.push(m);
}

/** Su üstünde döngü (feribot/vapur): dikdörtgen tur yolu, y = su yüzeyi. */
export function ferryLoop(x0: number, z0: number, x1: number, z1: number, y = -0.2): [number, number, number][] {
  return [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]];
}

// ------------------------------------------------------------------ araç noktası erişimi
const SPOT_FILL_KINDS = ["web", "read", "plan", "shell"] as const;
/** tür başına en çok bu kadar ek nokta */
const SPOT_FILL_MAX = 3;

/**
 * 36×32 şehir tabanında her istasyonun her araç türü için ölçeklenmiş yarıçap (`reach.ts spotReach`) içinde bir
 * noktası olsun: kapsanmayan istasyon kümesine en yakın, istasyonlarla aynı yürünür bileşende, bir engele (duvar, tezgâh,
 * pano) bakan serbest karoya ek nokta koyar (blok eklemez → çizim/blok bütçesi değişmez). Sahnede hiç olmayan tür eklenmez
 * (sahnenin tasarımı). Sacred tamponu, istasyon, yatak, dinlenme, kahve ve kanca karoları atlanır. Belirlenimci.
 * Şehir dosyası `b.done`'dan hemen önce çağırır. Kural: `SPOT-REACH-001` (scripts/logic_fix_d.test.mjs).
*/
export function fillSpotReach(b: Builder): void {
  const W0 = b.w, D0 = b.d, reach = spotReach({ width: W0, depth: D0, modules: [] });
  const free = (i: number, j: number) => i >= 0 && j >= 0 && i < W0 && j < D0 && !b.blocked.has(key(i, j));
  // yürünür bileşenler (4 komşu)
  const label = new Int32Array(W0 * D0).fill(-1);
  let n = 0;
  for (let j = 0; j < D0; j++) for (let i = 0; i < W0; i++) {
    if (label[j * W0 + i] >= 0 || !free(i, j)) continue;
    const q = [[i, j]]; label[j * W0 + i] = n;
    while (q.length) {
      const [ci, cj] = q.pop()!;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = ci + di, c = cj + dj;
        if (free(a, c) && label[c * W0 + a] < 0) { label[c * W0 + a] = n; q.push([a, c]); }
      }
    }
    n++;
  }
  const comp = (t: Tile) => (t[0] >= 0 && t[1] >= 0 && t[0] < W0 && t[1] < D0 ? label[t[1] * W0 + t[0]] : -1);
  const taken = new Set<string>();
  const mark = (t: Tile) => taken.add(key(t[0], t[1]));
  b.stations.forEach((s) => mark(s.tile)); b.rest.forEach(mark); b.ambient.forEach((h) => mark(h.tile));
  Object.values(b.spots).forEach((l) => l?.forEach((s) => mark(s.tile)));
  b.props.forEach((p) => { if (p.k === "coffee" && p.tile) mark(p.tile); });
  // istasyonların dört komşusu da boş kalsın (masaya yaklaşma, kuyruk)
  b.stations.forEach((s) => { for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) taken.add(key(s.tile[0] + di, s.tile[1] + dj)); });
  const zoned = { zones: b.zones };
  const md = (a: Tile, c: Tile) => Math.abs(a[0] - c[0]) + Math.abs(a[1] - c[1]);
  for (const kind of SPOT_FILL_KINDS) {
    const list = (b.spots[kind] ??= []);
    if (!list.length) continue;
    for (let k = 0; k < SPOT_FILL_MAX; k++) {
      const open = b.stations.filter((s) => !list.some((x) => md(x.tile, s.tile) <= reach));
      if (!open.length) break;
      let best: { t: Tile; face: number; score: number } | null = null;
      for (let j = 0; j < D0; j++) for (let i = 0; i < W0; i++) {
        const t: Tile = [i, j];
        if (!free(i, j) || taken.has(key(i, j)) || isInSacredBuffer(t, zoned, "anchor")) continue;
        let face = NaN;
        for (const [di, dj] of [[0, -1], [1, 0], [-1, 0], [0, 1]]) if (!free(i + di, j + dj)) { face = Math.atan2(di, dj); break; }
        if (Number.isNaN(face)) continue;
        const cov = open.filter((s) => md(t, s.tile) <= reach && comp(t) === comp(s.tile));
        if (!cov.length) continue;
        const score = cov.length * 1000 - cov.reduce((a, s) => a + md(t, s.tile), 0) / cov.length;
        if (!best || score > best.score) best = { t, face, score };
      }
      if (!best) break;
      list.push({ tile: best.t, face: best.face });
      mark(best.t);
    }
  }
}

/** Karo listesi yardımcısı (şehir dosyaları için okunur yerleşim). */
export const tiles = (...t: Tile[]) => t;
