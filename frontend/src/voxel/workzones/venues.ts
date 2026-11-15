/**
 * (ürün sahibi 2026-11-02) — çalışma alanları şehrin mekânı olur.
 *
 * "Sonradan eklenen bayraklı (mavi, mor, sarı, kırmızı) alanlar normal şehir dokusunu bozuyor. Buralarda daha entegre, şehirle uyumlu
 * çalışma alanları olmalı. Hiçbir yapı yürüyüşü zorlaştırmamalı."
 *
 * Kök neden: şehir sahnelerinde ekip alanı (büyüme bölgesi) iki işaretle okunuyordu — masa altlarında ekip renginde yarı saydam ZEMİN
 * (World.tsx `ZoneTiles`, mor/mavi/kırmızı/sarı) ve arka çitte ekip renginde direkli pano (`outdoorBack` → `postSign`); taban dünyada
 * da ilk masanın köşesinde direk + renkli pano (`teamSignBlocks`), hedefte direkli altın bayrak (`GoalFlag`). Hepsi şehirle ilgisiz
 * renk kodlarıydı; arka sıradaki fener (11,2) koridor karosunu kapatıyordu.
 *
 * Çözüm: şehirdeki her ajan alanı bir MEKÂN modeline eşlenir (`moduleVenue`):
 * - çalışma (ekip/misafir bölgesi) → kafe, atölye, ortak çalışma ya da pazar ofisi: bölgenin arka sınırı (lj 1) çit yerine tek katlı
 * dükkân cephesi (şehrin duvar rengi, vitrin camı, korniş), ekibin şehir paletinden tentesi (ayırt edici ince ipucu), kapı üstünde
 * piksel simgeli tabela (fincan, dişli, dizüstü, sandık) — renk koduna gerek yok; kapı (li 6) sokağa açık geçit kalır;
 * - uyku → otel (districts/hotel.ts, yataklar içeride) · ofis bölgesi → ofis binası (offices.ts) · avlu → meydan · taban → merkez.
 * Yürüme sözleşmesi aynı: cephe yalnız çitin zaten engellediği karolarda, okuma/web/plan noktaları ve koridorlar (li 6/11, lj 2/7/12)
 * açık; fener koridordan cepheye (duvar feneri) alındı. Denetim: scripts/workzones1.test.mjs (WORKZONE-INTEGRATED-001, -WALK-001).
 * Saf modül: React/three yok; döngüsel içe aktarmalar yalnız fonksiyon gövdelerinde.
*/
import { districtRole } from "../districts/core";
import { hasTheme, theme, type Bay } from "../districts/themes";
import type { CityStyle } from "../city/style";
import { DOWN } from "../districts/parts";
import { tx, tz, type Builder, type ModuleCell } from "../scenes";

export type WorkVenue = "kafe" | "atolye" | "ortak" | "pazar";
export type VenueKind = WorkVenue | "otel" | "ofis" | "meydan" | "merkez" | "olanak";
export const WORK_VENUES: readonly WorkVenue[] = ["kafe", "atolye", "ortak", "pazar"];

/** 5×5 piksel simge (satır üstten alta; "1" dolu). */
const ICONS: Readonly<Record<WorkVenue, readonly string[]>> = {
  kafe: ["01010", "00000", "11110", "11111", "11110"], // buharlı fincan
  atolye: ["01010", "11111", "11011", "11111", "01010"], // dişli
  ortak: ["11111", "10001", "11111", "00000", "11111"], // dizüstü
  pazar: ["00100", "01010", "11111", "10101", "11111"], // sepet
};

/** Şehirde ekip alanı mekâna dönüşür mü? (GROWTH `teamTint`li şehir temaları). */
export function cityVenues(scene: string | null | undefined): boolean {
  return !!scene && hasTheme(scene) && !!theme(scene).teamTint;
}

/** Ekip alanının dünya çizim katmanları (World.tsx bunu kullanır; workzones1.test davranışını sınar). Şehirde: renkli zemin yok,
 *  taban dünyada direkli pano ve onun görünmez tıklama hedefi yok; bekleyen ekip işareti büyümüş dünyada mekân tabelasında
 *  (`venue`), tabanda ilk masanın zemininde (`ring`). Şehir dışı sahneler eski davranışta (zemin nabzı). */
export function zoneDraw(scene: string | null | undefined, grown: boolean): { pads: boolean; signBlocks: boolean; signTarget: boolean; waitCue: "pads" | "venue" | "ring" } {
  if (!cityVenues(scene)) return { pads: true, signBlocks: !grown, signTarget: true, waitCue: "pads" };
  return { pads: false, signBlocks: false, signTarget: grown, waitCue: grown ? "venue" : "ring" };
}

const hash = (t: string) => { let h = 11; for (const ch of t) h = (h * 33 + ch.charCodeAt(0)) >>> 0; return h; };
/** Çalışma bölgesinin mekânı: misafir bölgesi ortak çalışma; ekip bölgesi ekip adından belirlenimci (aynı ekip → aynı mekân). */
export function workVenue(team: string | null, variant: number): WorkVenue {
  return team ? WORK_VENUES[(hash(team) + variant) % WORK_VENUES.length] : "ortak";
}

/** Kurulmuş dünyadaki bölgenin mekân modeli (yoksa null: mekânsız alan). */
export function moduleVenue(m: Pick<ModuleCell, "kind" | "label"> & { venue?: string }): VenueKind | null {
  if (m.kind === "team" || m.kind === "guest") return WORK_VENUES.includes(m.venue as WorkVenue) ? (m.venue as WorkVenue) : null;
  if (m.kind === "hq") return "merkez";
  if (m.label?.startsWith("dist_wz_")) return "ofis";
  if (districtRole(m.kind, m.label) === "sleep") return "otel";
  if (m.kind === "yard") return "meydan";
  return m.label ? "olanak" : null;
}

/**
 * Çalışma bölgesinin arka sınırı (lj 1, li 1–11): tek katlı dükkân cephesi. Engellenen karolar eski çitle aynı (li 1, 2, 4, 7, 9, 11
 * duvar; 3/8/10 nokta eşyası, 5 mekân eşyası); li 6 kapı geçidi açık (lento 2,3'te: WALK-COVER). `props`: okuma/web/plan eşyaları
 * (çağıran temanın; karoyu kendileri engeller). Okuma (3,2), web (8,2), plan (10,2) noktaları eskisiyle aynı.
 */
export function venueFront(x: Bay, s: CityStyle, venue: WorkVenue, props: { read: (i: number, j: number) => void; web: (i: number, j: number) => void;
  plan: (i: number, j: number) => void }): void {
  const { b, I, J } = x;
  const j = J(1), z0 = tz(j), H = 2.6, back = z0 - 0.3;
  const wall = s.walls[hash(`${x.team ?? "g"}${x.variant}`) % s.walls.length];
  const X = (li: number) => tx(I(li));
  // duvar (kapı li 6 boş) + lento + korniş; duvar karonun arka yarısında, eşyalar önünde
  for (const [a, c] of [[1, 5], [7, 11]] as const) b.box((X(a) + X(c)) / 2, H / 2, back - 0.1, c - a + 1, H, 0.2, wall, "solid", 0.03);
  b.box(X(6), 2.45, back - 0.1, 1, 0.3, 0.2, wall, "solid", 0.03);
  b.box(X(6), H + 0.06, back - 0.08, 11.1, 0.12, 0.3, s.trim, "solid", 0.02);
  for (const li of [1, 2, 4, 7, 9, 11]) b.block(I(li), j);
  // vitrinler: ortak çalışma geniş bant cam (loft), ötekiler dükkân camı; cam duvara 1 cm gömülü (eş düzlem yok)
  const glassAt = venue === "ortak" ? [[1, 2], [4, 5], [7, 7], [9, 9], [11, 11]] as const : [[2, 2], [4, 4], [7, 7], [9, 9]] as const;
  for (const [a, c] of glassAt) {
    const wx = (X(a) + X(c)) / 2, w = (c - a + 1) - 0.3;
    b.box(wx, venue === "ortak" ? 1.35 : 1.4, back + 0.01, w, venue === "ortak" ? 1.5 : 1.0, 0.04, s.window, "glass");
    b.box(wx, 0.82, back + 0.06, w + 0.12, 0.08, 0.1, s.trim);
  }
  // tente: ekibin şehir paletinden tonu (x.color = teamTint), kapı açıklığında kesik; tentenin altı ≥ 2,1
  for (const [a, c] of [[1, 5], [7, 11]] as const) {
    const cx = (X(a) + X(c)) / 2, w = c - a + 1;
    b.box(cx, 2.22, back + 0.3, w, 0.08, 0.6, x.color, "solid", 0.02);
    b.box(cx, 2.12, back + 0.61, w, 0.16, 0.04, s.trim);
  }
  // tabela: parapet üstünde koyu pano + piksel simge (gece parlar)
  const px = 0.11, sy = H + 0.1 + 0.36; // pano kornişe 2 cm gömülü (eş düzlem yok)
  b.box(X(6), sy, back - 0.08, 1.3, 0.72, 0.12, s.lamp.post, "solid", 0.02);
  ICONS[venue].forEach((row, r) => {
    for (let c0 = 0; c0 < 5;) {
      if (row[c0] !== "1") { c0++; continue; }
      let c1 = c0; while (c1 + 1 < 5 && row[c1 + 1] === "1") c1++;
      const w = (c1 - c0 + 1) * px;
      b.box(X(6) + (c0 - 2) * px + w / 2 - px / 2, sy + (2 - r) * px, back - 0.005, w, px, 0.04, s.lamp.glow, "glow");
      c0 = c1 + 1;
    }
  });
  // duvar feneri (sağ uçta; eskiden koridor karosu (11,2) üstünde ayaklı fener)
  b.box(X(11), 1.9, back + 0.08, 0.1, 0.1, 0.18, s.lamp.post);
  b.box(X(11), 1.75, back + 0.2, 0.26, 0.3, 0.26, s.lamp.glow, "glow");
  b.props.push({ k: "lamp", p: [X(11), 1.75, back + 0.2], r: 0, s: [2.6, 0], c: s.lamp.glow });
  // nokta eşyaları (eski çitin boşluklarında) + mekân eşyası (li 5: eski renkli pano yeri)
  props.read(I(3), j); b.spot("read", I(3), J(2), DOWN);
  props.web(I(8), j); b.spot("web", I(8), J(2), DOWN);
  props.plan(I(10), j); b.spot("plan", I(10), J(2), DOWN);
  venueItem(b, I(5), j, venue, s);
  x.sign = [X(6), H + 1.1, back];
}

/** Mekân eşyası (1 karo, engeller): kafe/ortak = ayaklı menü panosu, atölye = tezgâh, pazar = sandık yığını. */
function venueItem(b: Builder, i: number, j: number, venue: WorkVenue, s: CityStyle): void {
  const x = tx(i), z = tz(j);
  if (venue === "atolye") {
    b.box(x, 0.75, z, 0.9, 0.08, 0.55, "#8A6A4A", "solid", 0.02);
    for (const dx of [-0.38, 0.38]) for (const dz of [-0.22, 0.22]) b.box(x + dx, 0.36, z + dz, 0.07, 0.72, 0.07, "#5D4632");
    b.box(x - 0.2, 0.86, z, 0.3, 0.14, 0.2, "#6B7280");
    b.box(x + 0.22, 0.83, z + 0.05, 0.26, 0.08, 0.08, s.trim);
  } else if (venue === "pazar") {
    b.crate(x - 0.2, 0, z, 0.55, "#9A7442");
    b.crate(x + 0.24, 0, z + 0.05, 0.45, "#A88252");
    b.box(x - 0.2, 0.6, z, 0.45, 0.1, 0.45, s.awnings[0], "solid", 0.03);
  } else {
    for (const dz of [-0.14, 0.14]) b.box(x, 0.5, z + dz, 0.62, 1.0, 0.05, s.lamp.post, "solid", 0.02);
    b.box(x, 0.58, z + 0.17, 0.5, 0.6, 0.02, venue === "kafe" ? "#2F3B33" : "#F2F0EA");
  }
  b.block(i, j);
}
