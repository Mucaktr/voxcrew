/**
 * WORK-ZONES (ürün sahibi 2026-10-28, plan §5 C2) — şehir OFİS BİNASI tarifi (bölge şablonu; GROWTH oteli `districts/hotel.ts` deseni).
 *
 * Bir ofis = bir 12×16 bölge (`OFFICE_TPL`): şehrin mimarisinde arka blok (kat kat cephe, tabela, çatı) + önünde tek katlı, cam
 * çatılı ÇALIŞMA SALONU (yürüme modunda çatı kesitiyle açılır, dünya görünümünde cam çatıdan masalar okunur). Ajanlar ön cephedeki
 * üç karoluk kapıdan girer, iki adada sekiz gerçek masada (sandalye oturağı = istasyon yüksekliği, `resolveStationSeats`) çalışır.
 * Bu modül yalnız bölgeyi çizer; plan/seçim kancaları `districts/core.ts` (OFFICE_TPL), istasyon ataması `world.ts`.
 *
 * Yerel karolar (li 0–11, lj 0–15): li 0 / lj 0 yol · arka blok li 1–11 × lj 1–3 (engelli, `floors` kat) · salon li 2–10 × lj 4–10:
 * lj 4 arka koridor (beyaz tahta: plan, bilgi ekranı: web) · adalar: masa sıraları lj 6–7, istasyonlar lj 5 (+z'ye bakar) ve
 * lj 8 (−z'ye bakar), li 2/4 ve 7/9 (dizüstü; CITY-WORK-001) · lj 9 koridor · lj 10 lobi (terminal: kabuk, kahve makinesi) · orta koridor li 6 ·
 * duvarlar li 1 / li 11 (lj 4–11) ve ön cephe lj 11 (kapı li 5–7) · ön avlu lj 12–15 (saçak, saksılar, fenerler, banklar).
 * Saf modül: React/three yok. Döngüsel içe aktarma: scenes.ts değerleri yalnız fonksiyon gövdelerinde.
*/
import { roof, cityBench, streetLamp } from "../city/kit";
import { DEFAULT_CITY, pick2, type CityStyle, type RoofKind } from "../city/style";
import { ISTANBUL_STYLE } from "../city/styles/istanbul";
import { KAPADOKYA_STYLE } from "../city/styles/kapadokya";
import { LONDRA_STYLE } from "../city/styles/londra";
import { NEW_CITY_PARTS } from "../cities/parts";
import { FULL_PILOT_STYLES } from "../../full/offices";
import { DOWN, flowerBed, LEFT, planter, rug, UP, whiteboard } from "../districts/parts";
import type { Amenity, Bay } from "../districts/themes";
import { noteObject } from "../rules/hooks";
import { tx, tz, type Builder, type Tile } from "../scenes";
import { officesOf, zoneLabel, type OfficeLook } from "./registry";

/** Bölge planındaki şablon kimliği (core.ts: -1 avlu, -2 kıyı, -3 otel). */
export const OFFICE_TPL = -4;
/** Masa (istasyon) karoları (yerel): iki ada × dört. Sıra = istasyon sırası (world.ts doluluk). */
export const OFFICE_SEATS: readonly (readonly [number, number])[] = [[2, 5], [4, 5], [7, 5], [9, 5], [2, 8], [4, 8], [7, 8], [9, 8]];
/** Kapı (orta karo) ve kapının içeri komşusu (yerel). */
export const OFFICE_DOOR: readonly [number, number] = [6, 11];
export const OFFICE_INSIDE: readonly [number, number] = [6, 9];
/** Salon yüksekliği (zemin kat) ve üst kat yüksekliği; cam çatı tabanı ≥ 2,2 (WALK-COVER-001). */
export const HALL_H = 2.8;
const FLOOR_H = 1.6;

type WindowKind = "curtain" | "punched" | "arched" | "factory" | "band";
export interface OfficeSpec {
  floors: number;
  walls: readonly string[];
  /** üç cephe parçası (kanal evi, dükkân-ev): her parça kendi renginde */
  split?: boolean;
  accent: string;
  roofKind: RoofKind;
  roofColor: string;
  windows: WindowKind;
  glass?: string;
  balcony?: boolean;
  gable?: boolean;
  wood?: boolean;
  /** salon zemini [a, b], masa üstü, sandalye */
  floor: readonly [string, string];
  desk: string;
  chair: string;
}

const LOOKS: Readonly<Record<OfficeLook, OfficeSpec>> = {
  tower: { floors: 6, walls: ["#4E6476", "#4A5E70"], accent: "#C9D3DB", roofKind: "flat", roofColor: "#5B6570", windows: "curtain", glass: "#86BAD6",
    floor: ["#C9CED6", "#BFC5CE"], desk: "#E7E2D8", chair: "#2B2F3A" },
  han: { floors: 3, walls: ["#D9C7A7", "#CDB894", "#E2D2B4"], accent: "#8A6A4A", roofKind: "tile", roofColor: "#A65A3E", windows: "arched",
    floor: ["#B98E64", "#AD845C"], desk: "#7A5634", chair: "#3A2E26" },
  loft: { floors: 4, walls: ["#8A4B36", "#7C4331", "#94553E"], accent: "#2F2B29", roofKind: "flat", roofColor: "#4A3A33", windows: "factory",
    floor: ["#A57C55", "#9A724D"], desk: "#C9B79A", chair: "#2F2B29" },
  castiron: { floors: 4, walls: ["#D8D2C4", "#CFC8B8"], accent: "#5E6B57", roofKind: "flat", roofColor: "#5E5A54", windows: "factory",
    floor: ["#B5A48C", "#AA9A82"], desk: "#E7E2D8", chair: "#2F2B29" },
  haussmann: { floors: 4, walls: ["#EEE4D0", "#E7DBC3"], accent: "#2B2F36", roofKind: "zinc", roofColor: "#7D8B99", windows: "punched", balcony: true,
    floor: ["#B98E64", "#AD845C"], desk: "#E9DFCB", chair: "#2B2F36" },
  modernist: { floors: 4, walls: ["#EAD7B5", "#E6C9A0"], accent: "#3F7D6E", roofKind: "tile", roofColor: "#B5543C", windows: "arched", balcony: true,
    floor: ["#D9B38C", "#CFA97E"], desk: "#F2E8D5", chair: "#34413E" },
  canal: { floors: 4, walls: ["#7E3B2E", "#5E6B57", "#2F2B29"], split: true, accent: "#F2EFE8", roofKind: "tile", roofColor: "#3E3A36", windows: "punched", gable: true,
    floor: ["#A57C55", "#9A724D"], desk: "#E9E1D2", chair: "#25292E" },
  shophouse: { floors: 3, walls: ["#A7D3C4", "#F0B7A4", "#E8D58C"], split: true, accent: "#F6F2E8", roofKind: "tile", roofColor: "#B5543C", windows: "punched",
    floor: ["#C9A27E", "#BC946F"], desk: "#F6F2E8", chair: "#2F4A44" },
  teak: { floors: 3, walls: ["#F3EADA", "#E8D9BC"], accent: "#7A4E2A", roofKind: "tile", roofColor: "#8E3B2E", windows: "punched", wood: true,
    floor: ["#A77B4F", "#9C7148"], desk: "#C9A27E", chair: "#3A2E24" },
  hanok: { floors: 2, walls: ["#F4F1EA", "#ECE7DD"], accent: "#5A4130", roofKind: "curved", roofColor: "#3E4650", windows: "punched", wood: true,
    floor: ["#C9A97E", "#BF9F74"], desk: "#E4DAC6", chair: "#33414C" },
  riad: { floors: 3, walls: ["#D9895B", "#CF7F55"], accent: "#2F6F73", roofKind: "flat", roofColor: "#C9784E", windows: "arched",
    floor: ["#E7D3B4", "#2F6F73"], desk: "#EBDCC4", chair: "#3A2A22" },
  cave: { floors: 2, walls: ["#E3C49E", "#D9B08E"], accent: "#9C6B4A", roofKind: "flat", roofColor: "#D2B48C", windows: "arched",
    floor: ["#D8BE98", "#CFB48D"], desk: "#E9D9C0", chair: "#4A3A2E" },
  modern: { floors: 4, walls: ["#F2F0EA", "#ECE9E1"], accent: "#2F8F9D", roofKind: "flat", roofColor: "#9AA3AB", windows: "band", glass: "#6FA3C0",
    floor: ["#D6D3CC", "#CCC9C2"], desk: "#F2F0EA", chair: "#2F3640" },
};
export const officeLookSpec = (look: OfficeLook): OfficeSpec => LOOKS[look];

const PILOT_STYLES: Readonly<Record<string, CityStyle>> = {
  istanbul: ISTANBUL_STYLE, kapadokya: KAPADOKYA_STYLE, londra: LONDRA_STYLE, ...FULL_PILOT_STYLES,
};
export const cityStyleOf = (scene: string): CityStyle => PILOT_STYLES[scene] ?? NEW_CITY_PARTS[scene]?.style ?? DEFAULT_CITY;
/** Tabela sözcüğü (genel; marka değil): Türkiye şehirlerinde OFIS, ötekilerde OFFICE. */
const wordOf = (scene: string) => (scene === "istanbul" || scene === "kapadokya" ? "OFIS" : "OFFICE");

/** 3×5 piksel harfler (yalnız tabela sözcükleri). */
const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  O: ["111", "101", "101", "101", "111"],
  F: ["111", "100", "110", "100", "100"],
  I: ["111", "010", "010", "010", "111"],
  S: ["111", "100", "111", "001", "111"],
  C: ["111", "100", "100", "100", "111"],
  E: ["111", "100", "110", "100", "111"],
};
function pixelWord(b: Builder, word: string, x: number, y: number, z: number, px: number, c: string): void {
  const cols = word.length * 4 - 1, x0 = x - (cols * px) / 2;
  [...word].forEach((ch, k) => {
    GLYPHS[ch]?.forEach((row, r) => {
      for (let c0 = 0; c0 < 3;) {
        if (row[c0] !== "1") { c0++; continue; }
        let c1 = c0; while (c1 + 1 < 3 && row[c1 + 1] === "1") c1++;
        const w = (c1 - c0 + 1) * px;
        b.box(x0 + (k * 4 + c0) * px + w / 2, y + (2 - r) * px, z, w, px, 0.04, c, "glow");
        c0 = c1 + 1;
      }
    });
  });
}

/** Ofis bölge şablonu (`OFFICE_TPL`). `office`: zones.json ofis kimliği; bilinmiyorsa ilk ofis. */
export function officeAmenity(scene: string, office: string): Amenity {
  const def = officesOf(scene).find((o) => o.id === office) ?? officesOf(scene)[0];
  const look: OfficeLook = def?.look ?? "modern";
  const spec = LOOKS[look], s = cityStyleOf(scene);
  return {
    label: zoneLabel(scene, def?.id ?? office),
    floor: (li, lj) => {
      if (li >= 2 && li <= 10 && lj >= 4 && lj <= 10) return li === 6 || lj === 9 ? spec.floor[1] : spec.floor[0];
      return lj >= 12 && li >= 5 && li <= 7 ? pick2(s.ground.quay, li, lj) : pick2(s.ground.sidewalk, li, lj);
    },
    build: (x) => buildOffice(x, spec, s, wordOf(scene)),
  };
}

function buildOffice(x: Bay, spec: OfficeSpec, s: CityStyle, word: string): void {
  const { b, I, J } = x;
  const X = (li: number) => tx(I(li)), Z = (lj: number) => tz(J(lj));
  const floors = Math.max(2, spec.floors), top = HALL_H + (floors - 1) * FLOOR_H;
  const wall = spec.walls[x.variant % spec.walls.length];
  const glass = spec.glass ?? s.window;
  const back = Z(1) - 0.5, front = Z(3) + 0.5, left = X(1) - 0.5, right = X(11) + 0.5, zc = (Z(1) + Z(3)) / 2;
  noteObject(b, "tower", [I(1), J(1)], { w: 11, d: 3, floors, y: top, enclosed: true });

  // ---- arka blok: kütle (bölünmüşse üç parça), engelli karolar, kat bantları
  const segs: [number, number][] = spec.split ? [[1, 4], [5, 7], [8, 11]] : [[1, 11]];
  segs.forEach(([a, c], k) => b.box((X(a) + X(c)) / 2, top / 2, zc, c - a + 1, top, 3, spec.split ? spec.walls[k % spec.walls.length] : wall, "solid", 0.03));
  for (let li = 1; li <= 11; li++) for (let lj = 1; lj <= 3; lj++) b.block(I(li), J(lj));
  for (let f = 1; f < floors; f++) {
    const y = HALL_H + (f - 1) * FLOOR_H;
    for (const z of [front + 0.04, back - 0.04]) b.box(X(6), y, z, 11.08, 0.1, 0.08, spec.accent);
  }

  // ---- pencereler: her katta, yürünür karodan görünen her yüzde (REAL-FACADE-001). Ön yüzün zemin katı salonun içidir (iç duvar).
  const lit = (wx: number, wy: number, wz: number, wh: number, yaw: number) => b.props.push({ k: "window", p: [wx, wy, wz], r: yaw, s: [0.4, wh - 0.04], c: s.windowLit });
  const faceX = (z: number, out: number, f: number) => { // x boyunca uzanan yüz (ön/arka), `out` dışa normal (±1)
    const y0 = f === 0 ? 0 : HALL_H + (f - 1) * FLOOR_H, fh = f === 0 ? HALL_H : FLOOR_H;
    const wy = y0 + fh * 0.55, wh = fh * (spec.windows === "band" ? 0.36 : 0.5);
    const zz = z + out * 0.03;
    if (spec.windows === "curtain" || spec.windows === "band") {
      b.box(X(6), wy, zz, 10.6, spec.windows === "curtain" ? fh * 0.78 : wh, 0.05, glass, "glass");
      for (let li = 1; li <= 11; li += 2) b.box(X(li) - 0.5 + (li === 1 ? 0.1 : 0), wy, zz + out * 0.02, 0.06, spec.windows === "curtain" ? fh * 0.8 : wh + 0.04, 0.05, spec.accent);
      for (const li of [3, 9]) lit(X(li), wy, zz + out * 0.03, wh, out > 0 ? 0 : Math.PI);
      return;
    }
    const step = spec.windows === "factory" ? 2 : 1;
    for (let li = 1; li <= 11; li += step) {
      const wx = step === 2 ? Math.min(X(li) + 0.5, X(11)) : X(li), ww = step === 2 ? 1.5 : 0.48;
      b.box(wx, wy, zz, ww, wh, 0.05, s.window, "glass");
      if (spec.windows === "factory") for (const o of [-0.25, 0.25]) b.box(wx + o, wy, zz + out * 0.02, 0.04, wh, 0.04, spec.accent);
      if (spec.windows === "arched") b.box(wx, wy + wh / 2 + 0.06, zz + out * 0.01, ww + 0.1, 0.12, 0.06, spec.accent);
      if ((li + f) % 3 === 0) lit(wx, wy, zz + out * 0.03, wh, out > 0 ? 0 : Math.PI);
    }
  };
  const faceZ = (xw: number, out: number, f: number) => { // z boyunca uzanan yan yüz (3 karo)
    const y0 = f === 0 ? 0 : HALL_H + (f - 1) * FLOOR_H, fh = f === 0 ? HALL_H : FLOOR_H;
    const wy = y0 + fh * 0.55, wh = fh * 0.5;
    for (const lj of [1, 3]) b.box(xw + out * 0.03, wy, Z(lj), 0.05, wh, spec.windows === "curtain" ? 0.9 : 0.48, spec.windows === "curtain" || spec.windows === "band" ? glass : s.window, "glass");
  };
  for (let f = 0; f < floors; f++) {
    faceX(back, -1, f);
    faceZ(left, -1, f); faceZ(right, 1, f);
    if (f > 0) faceX(front, 1, f);
  }
  // haussmann/modernist: iki katta korkuluklu balkon bandı; kanal evi: basamaklı alınlıklar; tik/hanok: ahşap dikmeler
  if (spec.balcony) for (const f of [1, floors - 1]) {
    const y0 = HALL_H + (f - 1) * FLOOR_H;
    b.box(X(6), y0 + 0.08, front + 0.22, 11, 0.06, 0.36, spec.accent);
    b.box(X(6), y0 + 0.45, front + 0.38, 11, 0.05, 0.04, spec.accent);
  }
  if (spec.gable) segs.forEach(([a, c]) => {
    const cx = (X(a) + X(c)) / 2, w = c - a + 1;
    [[1, 0], [0.66, 1], [0.33, 2]].forEach(([f, k]) => b.box(cx, top + 0.25 + k * 0.5, front - 0.4, w * f, 0.5, 0.6, spec.walls[(a + c) % spec.walls.length], "solid", 0.03));
  });
  if (spec.wood) for (const li of [1, 4, 8, 11]) b.box(X(li) + (li === 1 ? -0.4 : li === 11 ? 0.4 : 0), top / 2, front + 0.06, 0.16, top, 0.12, spec.accent);
  if (!spec.gable) roof(b, spec.roofKind, X(6), top, zc, 11, 3, spec.roofColor, "grid", 0.12);
  else b.box(X(6), top + 0.06, zc, 11, 0.12, 3, spec.roofColor, "solid", 0.02);

  // ---- tabela: arka bloğun ön yüzünde, salon çatısının üstünde (gece parlar)
  const sy = HALL_H + FLOOR_H * 0.5, px = 0.13, ww = (word.length * 4 - 1) * px;
  b.box(X(6), sy, front + 0.06, ww + 0.5, 5 * px + 0.36, 0.08, s.lamp.post, "solid", 0.02);
  b.box(X(6), sy, front + 0.11, ww + 0.62, 0.05, 0.05, spec.accent);
  pixelWord(b, word, X(6), sy, front + 0.12, px, s.lamp.glow);

  // ---- salon kabuğu: yan duvarlar (li 1 / 11) ve ön cephe (lj 11; kapı li 5–7) — denizlik + vitrin camı + üst kiriş
  const sill = 0.35, beam = 0.4;
  const storefrontX = (a: number, c: number) => {
    const cx = (X(a) + X(c)) / 2, w = c - a + 1, z = Z(11);
    b.box(cx, sill / 2, z, w, sill, 1, wall, "solid", 0.03);
    b.box(cx, (sill + HALL_H - beam) / 2, z + 0.35, w - 0.1, HALL_H - beam - sill, 0.06, glass, "glass");
    b.box(cx, HALL_H - beam / 2, z, w, beam, 1, wall, "solid", 0.03);
    for (let li = a; li <= c; li++) b.box(X(li) - 0.5, (sill + HALL_H - beam) / 2, z + 0.35, 0.08, HALL_H - beam - sill, 0.08, spec.accent);
  };
  storefrontX(1, 4); storefrontX(8, 11);
  for (const [li, xs] of [[1, -1], [11, 1]] as const) {
    const cx = X(li), z = (Z(4) + Z(10)) / 2;
    b.box(cx, sill / 2, (Z(4) + Z(11)) / 2, 1, sill, 8, wall, "solid", 0.03);
    b.box(cx + xs * 0.35, (sill + HALL_H - beam) / 2, z, 0.06, HALL_H - beam - sill, 6.8, glass, "glass");
    b.box(cx, HALL_H - beam / 2, (Z(4) + Z(11)) / 2, 1, beam, 8, wall, "solid", 0.03);
    for (let lj = 4; lj <= 10; lj += 2) b.box(cx + xs * 0.35, (sill + HALL_H - beam) / 2, Z(lj) - 0.5, 0.08, HALL_H - beam - sill, 0.08, spec.accent);
  }
  // kapı lentosu + ışıklı geçit (CITYLIFE portalFrameBlocks geleneği: iki parlak dikme + üst bant, açıklık kenarında)
  b.box(X(6), HALL_H - beam / 2, Z(11), 3, beam, 1, wall, "solid", 0.03);
  for (const sx of [-1, 1]) {
    b.box(X(6) + sx * 1.53, 1.2, Z(11) + 0.5, 0.12, 2.4, 0.1, spec.accent);
    b.box(X(6) + sx * 1.45, 1.15, Z(11) + 0.42, 0.05, 2.2, 0.05, s.lamp.glow, "glow");
  }
  b.box(X(6), 2.3, Z(11) + 0.42, 2.95, 0.12, 0.05, s.lamp.glow, "glow");
  for (let lj = 4; lj <= 11; lj++) { b.block(I(1), J(lj)); b.block(I(11), J(lj)); }
  for (const li of [2, 3, 4, 8, 9, 10]) b.block(I(li), J(11));

  // ---- cam çatı (çerçeveli) + çatı kenarı
  b.box(X(6), HALL_H + 0.05, (Z(4) + Z(10)) / 2, 9, 0.08, 7, "#CFE8F5", "glass");
  for (let li = 2; li <= 10; li += 2) b.box(X(li) + 0.5, HALL_H + 0.1, (Z(4) + Z(10)) / 2, 0.08, 0.1, 7, spec.accent);
  for (const z of [Z(4) - 0.5, Z(10) + 0.5]) b.box(X(6), HALL_H + 0.1, z, 9, 0.1, 0.08, spec.accent);
  b.box(X(6), HALL_H + 0.15, Z(11), 11, 0.3, 1, spec.roofColor, "solid", 0.02);
  for (const li of [1, 11]) b.box(X(li), HALL_H + 0.15, (Z(4) + Z(10)) / 2, 1, 0.3, 7, spec.roofColor, "solid", 0.02);

  // ---- iç: arka duvarda beyaz tahta (plan) ve bilgi ekranı (web), tavan ışıkları
  whiteboard(b, I(8), J(3), 2);
  b.spot("plan", I(8), J(4), DOWN); b.spot("plan", I(9), J(4), DOWN);
  b.box((X(3) + X(4)) / 2, 1.7, front + 0.05, 1.7, 0.95, 0.06, "#1F2937", "solid", 0.02);
  b.box((X(3) + X(4)) / 2, 1.7, front + 0.09, 1.55, 0.8, 0.02, "#7DD3FC", "glow");
  b.spot("web", I(3), J(4), DOWN); b.spot("web", I(4), J(4), DOWN);
  for (const lj of [5, 8]) for (const li of [3, 8]) b.box(X(li) + 0.5, HALL_H - 0.12, Z(lj) + (lj === 5 ? 0.5 : -0.5), 1.4, 0.06, 0.3, "#FFF6DA", "glow");

  // ---- adalar: masa çifti + monitör + masa lambası + sandalye (istasyon karosunda; oturak yüksekliği gerçek)
  for (const [li, lj] of OFFICE_SEATS) {
    const row0 = lj === 5, dj = row0 ? 1 : -1, face = row0 ? "+z" as const : "-z" as const;
    const i = I(li), dj0 = J(lj + dj);
    // şehirde iş dizüstüyle (CITY-WORK-001): masada dizüstü (ekran ajana bakar) + masa lambası
    b.desk(i, dj0, 2, spec.desk, "#6B7280", true);
    b.laptop(tx(i), 0.79, tz(dj0), row0 ? "-z" : "+z");
    b.deskLamp(i + 1, dj0, s.lamp.glow, 0.25, row0 ? 0.25 : -0.25);
    b.chair(i, J(lj), face, spec.chair);
    b.station(i, J(lj), row0 ? UP : DOWN, "sit_chair", "laptop");
  }
  // lobi: kabuk terminali (2,10 → nokta 3,10), kahve makinesi (10,10 → nokta 9,10), saksılar
  b.terminal(I(2), J(10), "+x");
  b.spot("shell", I(3), J(10), LEFT);
  b.coffeeMachine(I(10), J(10), "-x");
  planter(b, I(4), J(10)); planter(b, I(8), J(10));
  rug(b, I(5), J(10), 3, 1, spec.accent, 0.012);

  // ---- ön avlu: paspas, saçak, saksılar, fenerler, banklar (dinlenme zeminde), çiçek tarhı
  rug(b, I(5), J(12), 3, 1, spec.accent, 0.015);
  b.canopy(I(5), I(7), J(12), J(12), spec.accent, 2.35, s.lamp.post);
  planter(b, I(4), J(12)); planter(b, I(8), J(12));
  streetLamp(b, s, I(3), J(13)); streetLamp(b, s, I(9), J(13));
  cityBench(b, I(2), J(14), "+z"); cityBench(b, I(10), J(14), "+z");
  b.rest.push([I(2), J(15)], [I(10), J(15)]);
  flowerBed(b, I(3), J(15), 1, 1, s.awnings); flowerBed(b, I(9), J(15), 1, 1, s.awnings);
  b.hook("window", I(3), J(11));
  x.sign = [X(6), top + 0.9, front];
}

/** Ofis bölgesinin (sol-arka karosu i0, j0) kapı, içeri ve masa karoları (dünya). */
export function officeTiles(i0: number, j0: number): { door: Tile; inside: Tile; seats: Tile[] } {
  return {
    door: [i0 + OFFICE_DOOR[0], j0 + OFFICE_DOOR[1]],
    inside: [i0 + OFFICE_INSIDE[0], j0 + OFFICE_INSIDE[1]],
    seats: OFFICE_SEATS.map(([li, lj]) => [i0 + li, j0 + lj] as Tile),
  };
}
