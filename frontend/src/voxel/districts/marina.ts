/**
 * S41 — su üstü büyüme: yat sahnesi MARİNAYA, açık deniz sahnesi BALIKÇI LİMANINA büyür (eskiden: düz tahta güverte).
 *
 * Bölge düzeni (yerel karo li 0–11, lj 0–15; core.ts kurallarıyla uyumlu):
 *  - yol: lj 0 satırı ve li 0 sütunu tahta iskele (bütün dünyada sürekli); arka iskele lj 2, orta iskele li 6 (lj 1–15),
 *    ön platform lj 13–15. Geri kalan karolar SU: engellenir, okyanus düzlemi görünür (core.ts `marina`).
 *  - pod yuvası (2,3) (7,3) (2,8) (7,8) = bağlı bir tekne. Sol tekneler kıçtan orta iskeleye bağlı, pruvası −x'e (li 1 suyu);
 *    sağdakiler pruvası +x'e. Tekne güvertesi (4×4) yürünebilir; ortada kokpit masaları (engelli), kenarlarda kokpit bankında
 *    oturan ajanlar (`sit_chair`, laptop masada). Boş pod yuvasında yürünmez demirli yelkenli/motorbot.
 *  - ön şerit: uyku yerleri (güneşlenme minderi/şezlong).
 * Ekip rengi: tekne tentesi (bimini), borda şeridi, bayrak. Hepsi var olan blok gruplarıyla; yeni malzeme yok.
 */
import { noteObject } from "../rules/hooks";
import { tx, tz, type Builder } from "../scenes";
import { bench, counter, DOWN, parasolTable, RIGHT, UP } from "./parts";
import { breakSpot, seatMark, seatSide, teamCorner, type Amenity, type Bay, type Theme } from "./themes";
import { sleds } from "../city/furniture";

interface Style {
  hq: string; trim: string; under: string;
  deck: readonly [string, string, string, number];
  /** okyanus düzlemi (SceneDef.ocean.y) */
  waterY: number;
  /** marina su yüzeyi ve rengi */
  surface: number; water: string;
  hulls: readonly string[];
  teak: string; cushion: string;
  fishing: boolean;
}

const YACHT: Style = {
  hq: "dist_yacht_hq", trim: "#2386C8", under: "#1E3A5F", deck: ["#9C8B78", "#8F7F6C", "#94A3B8", 1.2], waterY: -1.3, surface: -0.24, water: "#2A8FD0",
  hulls: ["#F8FAFC", "#F1F5F9", "#1E3A5F", "#F8FAFC"], teak: "#C08A57", cushion: "#F8FAFC", fishing: false,
};
const HARBOUR: Style = {
  hq: "dist_island", trim: "#2A9BDB", under: "#6B4F35", deck: ["#A0805A", "#94744F", "#6B4F35", 0.5], waterY: -0.32, surface: -0.2, water: "#1E8FD0",
  hulls: ["#D9453B", "#2A9BDB", "#3F8F5A", "#F2B33D"], teak: "#A0805A", cushion: "#E8D5B5", fishing: true,
};

const plank = (s: Style) => (li: number, lj: number) => ((li + lj) % 2 ? s.deck[0] : s.deck[1]);
/** Çalışma bölgesi zemini: arka iskele, orta iskele, ön platform; geri kalanı su (pod'lar tekneyle örtülür). */
const workFloor = (s: Style) => (li: number, lj: number) => (lj === 2 || li === 6 || lj >= 13 ? plank(s)(li, lj) : "");

/** Tekne gövdesi: (pi, pj) yerel 4×4 yuvasında; `walk`: güverte yürünebilir (karo engeli kaldırılır). */
function hull(x: Bay, s: Style, pi: number, pj: number, o: { color: string; accent: string; walk: boolean; bowLeft: boolean; inset?: number;
  kind?: "motor" | "sail" | "fish" }) {
  const { b, I, J } = x;
  noteObject(b, "boat", [I(pi), J(pj)], { w: 4, d: 4, onWater: true }); // S45: kural izi (tekne suda)
  const inset = o.inset ?? 0.12;
  const x0 = tx(I(pi)) - 0.5, x1 = tx(I(pi + 3)) + 0.5, z0 = tz(J(pj)) - 0.5 + inset, z1 = tz(J(pj + 3)) + 0.5 - inset;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, wz = z1 - z0;
  const top = o.walk ? 0.06 : 0.0, bot = s.surface - 0.35, h = top - bot, cy = (top + bot) / 2;
  b.box(cx, cy, cz, x1 - x0, h, wz, o.color, "solid", 0.02);
  // pruva: daralan basamaklar suyun üstüne taşar
  [[0.55, 0.78], [0.5, 0.5], [0.45, 0.24]].forEach(([w, f], k) => {
    const bx = o.bowLeft ? x0 - 0.27 - k * 0.5 : x1 + 0.27 + k * 0.5;
    b.box(bx, cy + k * 0.04, cz, w, h - k * 0.05, wz * f, o.color, "solid", 0.02);
  });
  b.box(cx + (o.bowLeft ? -0.4 : 0.4), top - 0.16, cz, x1 - x0 + 1.4, 0.1, wz + 0.03, o.accent);
  b.box(cx, top + 0.02, cz, x1 - x0 - 0.5, 0.04, wz - 0.5, s.teak, "solid", 0.03);
  if (o.walk) {
    for (let li = pi; li <= pi + 3; li++) for (let lj = pj; lj <= pj + 3; lj++) b.blocked.delete(`${I(li)},${J(lj)}`);
    // kenar korkuluğu (uzun kenarlar) ve pruvada ön cam
    for (const z of [z0 + 0.04, z1 - 0.04]) {
      b.box(cx, 0.55, z, x1 - x0 - 0.2, 0.04, 0.04, "#CBD5E1");
      for (const dx of [-(x1 - x0 - 0.3) / 2, 0, (x1 - x0 - 0.3) / 2]) b.box(cx + dx, 0.3, z, 0.04, 0.5, 0.04, "#CBD5E1"); // REAL-SUPPORT: korkuluk direkleri güverteye basar
    }
    b.box(o.bowLeft ? x0 + 0.1 : x1 - 0.1, 0.5, cz, 0.06, 0.5, wz * 0.6, "#BFE3F5", "glass");
  }
  const kind = o.kind ?? (s.fishing ? "fish" : "motor");
  if (kind === "sail") {
    b.box(cx + (o.bowLeft ? 0.9 : -0.9), 0.3, cz, 1.2, 0.6, wz * 0.5, "#F8FAFC", "solid", 0.02);
    b.box(cx + (o.bowLeft ? 0.9 : -0.9), 0.35, cz + wz * 0.25 + 0.01, 1.0, 0.16, 0.02, "#22314A");
    b.box(cx, 2.4, cz, 0.1, 4.8, 0.1, "#E5E7EB");
    [[1.8, 0.4], [1.4, 1.3], [1.0, 2.2], [0.6, 3.1], [0.3, 3.8]].forEach(([w, y]) => b.box(cx + (o.bowLeft ? -1 : 1) * (w / 2 + 0.06), y + 0.4, cz, w, 0.9, 0.04, "#F8FAFC"));
    b.box(cx + (o.bowLeft ? 0.9 : -0.9), 0.55, cz, 1.6, 0.06, 0.06, "#94A3B8");
  } else if (kind === "fish" && !o.walk) {
    b.box(cx + (o.bowLeft ? 0.6 : -0.6), 0.45, cz, 1.0, 0.9, wz * 0.55, "#F8FAFC", "solid", 0.02);
    b.box(cx + (o.bowLeft ? 0.6 : -0.6), 0.95, cz, 1.2, 0.1, wz * 0.65, o.accent);
    b.box(cx + (o.bowLeft ? -0.8 : 0.8), 0.25, cz, 0.6, 0.5, 0.6, "#F2B33D");
  } else if (!o.walk) {
    b.box(cx + (o.bowLeft ? 0.4 : -0.4), 0.4, cz, 1.8, 0.8, wz * 0.6, "#F8FAFC", "solid", 0.02);
    b.box(cx + (o.bowLeft ? 0.4 : -0.4), 0.55, cz + wz * 0.3 + 0.01, 1.6, 0.26, 0.02, "#22314A");
    b.box(cx + (o.bowLeft ? 0.4 : -0.4), 0.85, cz, 2.0, 0.08, wz * 0.66, "#E2E8F0");
  }
  b.hook("perch", I(pi + 1), J(pj + 1));
}

/** Demir şamandırası (suda, engelli karoda). */
function buoy(b: Builder, i: number, j: number, waterY: number, c = "#E5584E") {
  b.box(tx(i), waterY + 0.12, tz(j), 0.36, 0.3, 0.36, c, "bob");
  b.box(tx(i), waterY + 0.32, tz(j), 0.3, 0.12, 0.3, "#FFFFFF", "bob");
}

/** Kıyı babası (iskele kenarında, engellemez). */
function bollard(b: Builder, x: number, z: number) {
  b.box(x, 0.18, z, 0.18, 0.3, 0.18, "#374151"); b.box(x, 0.34, z, 0.26, 0.05, 0.26, "#1F2937");
}

function lounger(b: Builder, i: number, j: number, c: string) {
  noteObject(b, "sun_lounger", [i, j]);
  b.box(tx(i), 0.2, tz(j), 0.8, 0.12, 0.95, c); b.box(tx(i), 0.42, tz(j) + 0.4, 0.8, 0.45, 0.12, c);
  sleds(b.box.bind(b), tx(i), tz(j), 0.8, 0.95, 0.14, "z"); // CORE-WALK: şezlong yere basar
  b.block(i, j); b.rest.push([i, j - 1]);
}

/** Yüzen ev / kazıklı kulübe (yatakhane): 4×4 yuvada platform + 3 duvar + çatı; içinde 4 yatak (uyku), önü açık güverte. */
function cabinBoat(x: Bay, s: Style, pi: number, pj: number, wall: string, roof: string, quilt: string, bowLeft: boolean) {
  const { b, I, J } = x;
  hull(x, s, pi, pj, { color: s.fishing ? "#8B6B47" : "#F8FAFC", accent: roof, walk: true, bowLeft, kind: "motor" });
  const x0 = tx(I(pi)) - 0.45, x1 = tx(I(pi + 3)) + 0.45, zb = tz(J(pj)) - 0.4, zf = tz(J(pj + 2)) + 0.45;
  const cx = (x0 + x1) / 2;
  b.box(cx, 0.9, zb, x1 - x0, 1.8, 0.1, wall, "solid", 0.03);
  for (const xx of [x0, x1]) b.box(xx, 0.9, (zb + zf) / 2, 0.1, 1.8, zf - zb, wall, "solid", 0.03);
  b.box(cx, 1.9, (zb + zf) / 2, x1 - x0 + 0.5, 0.16, zf - zb + 0.6, roof, "solid", 0.03);
  b.box(cx, 2.05, (zb + zf) / 2, x1 - x0 - 0.6, 0.14, zf - zb - 0.2, roof, "solid", 0.02);
  // HOTEL-SYS (E1): kamarada görünür yatak yok (uyku sahnenin konak geçidinde); yanan kamara lambaları kalır
  void quilt;
  for (let li = pi; li <= pi + 3; li++) b.box(tx(I(li)), 1.2, zb + 0.07, 0.5, 0.4, 0.02, "#FFE3A3", "glow");
  b.hook("roof", I(pi + 1), J(pj + 1));
}

function marinaTheme(s: Style): Theme {
  const floor = workFloor(s);
  /** Kokpit masası (iki karo, engelli) + ajan karosunda kokpit bankı (minder + sırtlık korkuluk tarafında). */
  const seat = (b: Builder, i: number, j: number, face: "+z" | "-z", n: number, team: string) => {
    const { user, dz, agentJ } = seatSide(j, face);
    const cx = tx(i) + 0.5, z = tz(j);
    b.box(cx, 0.68, z, 1.9, 0.08, 0.8, s.fishing ? "#8B5A2B" : "#B47D4B", "solid", 0.03);
    b.box(cx, 0.34, z, 0.3, 0.68, 0.3, "#94A3B8");
    b.block(i, j); b.block(i + 1, j);
    b.laptop(tx(i), 0.72, z, user);
    if (s.fishing) { b.crate(tx(i + 1), 0.72, z, 0.36, "#9A7442"); }
    else b.box(tx(i + 1), 0.8, z, 0.14, 0.16, 0.14, ["#FDE68A", "#F97316", "#93C5FD"][n % 3], "glass");
    const sz = tz(agentJ);
    b.box(tx(i), 0.33, sz + dz * 0.05, 0.86, 0.12, 0.6, s.cushion, "solid", 0.02);
    sleds(b.box.bind(b), tx(i), sz + dz * 0.05, 0.86, 0.6, 0.27, "z"); // CORE-WALK: minderli bank yere basar
    b.box(tx(i), 0.6, sz + dz * 0.36, 0.86, 0.42, 0.1, team, "solid", 0.02);
    seatMark(b, i, agentJ, face);
  };
  const back = (x: Bay) => {
    const { b, I, J } = x;
    // arka iskele (lj 2) üstünde araç noktaları: suya bakan kitap kutusu / dürbün / harita panosu lj 1 kazıklarında
    const post = (li: number, c: string, top: string) => {
      b.box(tx(I(li)), 0.2, tz(J(1)), 0.2, 1.0, 0.2, "#6B4F35");
      b.box(tx(I(li)), 1.0, tz(J(1)), 0.8, 0.7, 0.5, c, "solid", 0.03);
      b.box(tx(I(li)), 1.0, tz(J(1)) + 0.26, 0.66, 0.5, 0.02, top);
    };
    post(3, "#7B5236", "#CFEFFF"); b.spot("read", I(3), J(2), DOWN);
    b.box(tx(I(8)), 0.6, tz(J(1)), 0.12, 1.2, 0.12, "#94A3B8"); b.box(tx(I(8)), 1.2, tz(J(1)), 0.22, 0.22, 0.8, "#E5E7EB"); b.spot("web", I(8), J(2), DOWN);
    post(10, "#6B4226", "#93C5FD"); b.spot("plan", I(10), J(2), DOWN);
    for (const dx of [-0.42, 0.42]) b.box(tx(I(5)) + dx, 0.6, tz(J(1)), 0.1, 1.6, 0.1, "#6B4F35");
    b.box(tx(I(5)), 1.3, tz(J(1)), 1.2, 0.56, 0.1, x.color, "solid", 0.02);
    b.box(tx(I(5)), 1.3, tz(J(1)) + 0.06, 1.0, 0.36, 0.02, "#FFFDF8");
    x.sign = [tx(I(5)), 2.15, tz(J(1))];
    for (const li of [2, 4, 8, 10]) bollard(b, tx(I(li)), tz(J(2)) - 0.38);
    for (const lj of [4, 9]) bollard(b, tx(I(6)) - 0.38, tz(J(lj)));
  };
  const spare = (x: Bay, pi: number, pj: number, slot: number) => {
    const bowLeft = pi < 6;
    hull(x, s, pi, pj, { color: s.hulls[(slot + x.variant) % s.hulls.length], accent: x.color, walk: false, bowLeft, inset: 0.55,
      kind: slot % 2 ? "sail" : s.fishing ? "fish" : "motor" });
  };
  // ---- olanaklar
  const club: Amenity = {
    label: s.fishing ? "dist_dockcafe" : "dist_marinaclub",
    floor: (li, lj) => (lj <= 6 || li === 6 || lj >= 12 ? plank(s)(li, lj) : ""),
    build: (x) => {
      const { b, I, J } = x;
      counter(b, I(3), I(8), J(3), s.fishing ? "#7A4E2A" : "#1F2937", s.fishing ? "#F8FAFC" : "#C08A57");
      b.coffeeMachine(I(4), J(3), "+z", true);
      b.canopy(I(3), I(8), J(3), J(3), s.fishing ? "#2A9BDB" : "#F8FAFC", 2.3, "#7A4E2A", s.fishing ? "#1E8FD0" : "#2386C8");
      for (let li = 3; li <= 8; li += 2) b.stool(I(li), J(4), "#F97316");
      b.spot("plan", I(8), J(4), UP);
      for (const [li, c] of [[3, "#E07A5F"], [9, "#2A9BDB"]] as [number, string][]) parasolTable(b, I(li), J(6), c);
      for (const li of [2, 4, 8, 10]) bollard(b, tx(I(li)), tz(J(6)) + 0.38);
      hull(x, s, 2, 7, { color: s.hulls[0], accent: "#E07A5F", walk: false, bowLeft: true, inset: 0.4, kind: s.fishing ? "fish" : "motor" });
      hull(x, s, 7, 7, { color: s.hulls[1], accent: "#2A9BDB", walk: false, bowLeft: false, inset: 0.4, kind: "sail" });
      for (const li of [3, 8]) lounger(b, I(li), J(14), s.cushion);
      bench(b, I(9), J(13), s.deck[0]);
      for (const [li, lj] of [[2, 13], [11, 14]] as [number, number][]) { b.crate(tx(I(li)), 0.02, tz(J(lj)), 0.7); b.block(I(li), J(lj)); }
      b.hook("sea", I(6), J(9), 3);
      x.sign = [tx(I(6)), 2.8, tz(J(3))];
    },
  };
  const dorm: Amenity = {
    label: s.fishing ? "dist_stilthuts" : "dist_houseboats",
    floor: (li, lj) => (lj === 2 || li === 6 || lj === 7 || lj >= 13 ? plank(s)(li, lj) : ""),
    build: (x) => {
      const { b, I, J } = x;
      const walls = s.fishing ? ["#C8A165", "#B98E52"] : ["#F8FAFC", "#E2E8F0"];
      const roofs = s.fishing ? ["#D9B45A", "#CBA24A"] : ["#2386C8", "#1E3A5F"];
      const quilts = ["#E07A5F", "#6C8EBF", "#F2CC8F", "#3F6E5A"];
      ([[2, 3], [7, 3], [2, 8], [7, 8]] as [number, number][]).forEach(([pi, pj], k) => cabinBoat(x, s, pi, pj, walls[k % 2], roofs[k % 2], quilts[k], pi < 6));
      for (const li of [3, 9]) lounger(b, I(li), J(14), s.cushion);
      breakSpot(b, I(10), J(14)); b.box(tx(I(10)), 0.4, tz(J(14)), 0.6, 0.8, 0.6, "#8B5E3C", "solid", 0.05); b.block(I(10), J(14));
      for (const li of [2, 4, 8, 10]) bollard(b, tx(I(li)), tz(J(13)) - 0.38);
      x.sign = [tx(I(6)), 2.4, tz(J(2))];
    },
  };
  const third: Amenity = s.fishing ? {
    label: "dist_lighthouse",
    floor: (li, lj) => (li >= 4 && li <= 8 && lj >= 4 && lj <= 9 ? ((li + lj) % 3 ? "#9CA3AF" : "#8B9097") : lj === 2 || li === 6 || lj >= 13 ? plank(s)(li, lj) : ""),
    build: (x) => {
      const { b, I, J } = x;
      const lx = tx(I(6)), lz = tz(J(6));
      [[1.8, "#F8FAFC"], [1.6, "#E11D48"], [1.4, "#F8FAFC"], [1.2, "#E11D48"]].forEach(([w, c], k) => b.box(lx, 0.6 + k * 1.2, lz, w as number, 1.2, w as number, c as string, "solid", 0.02));
      b.box(lx, 5.1, lz, 1.0, 0.6, 1.0, "#FDE68A", "glow"); b.box(lx, 5.55, lz, 1.3, 0.3, 1.3, "#1F2937");
      for (const li of [5, 6, 7]) for (const lj of [5, 6, 7]) b.block(I(li), J(lj));
      b.spot("web", I(6), J(8), DOWN); b.spot("shell", I(4), J(6), RIGHT);
      for (const [li, lj] of [[4, 4], [8, 9], [8, 4]] as [number, number][]) { b.box(tx(I(li)), 0.25, tz(J(lj)), 0.8, 0.5, 0.7, "#78716C", "solid", 0.08); b.block(I(li), J(lj)); }
      bench(b, I(4), J(9), "#A0805A");
      for (const [li, lj, c] of [[2, 5, "#E5584E"], [10, 5, "#F2B33D"], [2, 10, "#F2B33D"], [10, 7, "#E5584E"]] as [number, number, string][]) buoy(b, I(li), J(lj), s.surface, c);
      hull(x, s, 7, 9, { color: s.hulls[2], accent: "#F2B33D", walk: false, bowLeft: false, inset: 0.5, kind: "fish" });
      bench(b, I(3), J(14), "#A0805A"); bench(b, I(8), J(14), "#A0805A");
      breakSpot(b, I(10), J(13)); b.box(tx(I(10)), 0.4, tz(J(13)), 0.6, 0.8, 0.6, "#8B5E3C", "solid", 0.05); b.block(I(10), J(13));
      b.hook("sea", I(2), J(8), 3); b.hook("perch", I(6), J(6));
      x.sign = [lx, 6.2, lz];
    },
  } : {
    label: "dist_superyacht",
    floor: (li, lj) => (lj === 2 || lj >= 13 || (li === 6 && lj <= 3) ? plank(s)(li, lj) : ""),
    build: (x) => {
      const { b, I, J } = x;
      // süper yat: uzun gövde (li 1–10, lj 4–11), iki güverte üst yapısı, köprü camı, radar direği, jakuzi
      const x0 = tx(I(1)) - 0.3, x1 = tx(I(10)) + 0.5, z0 = tz(J(4)) - 0.4, z1 = tz(J(11)) + 0.4, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const bot = s.surface - 0.4;
      b.box(cx, (0.1 + bot) / 2, cz, x1 - x0, 0.1 - bot, z1 - z0, "#F8FAFC", "solid", 0.02);
      [[0.8, 0.7], [0.7, 0.42], [0.6, 0.18]].forEach(([w, f], k) => b.box(x1 + 0.4 + k * 0.7, (0.1 + bot) / 2, cz, w, 0.1 - bot - k * 0.08, (z1 - z0) * f, "#F8FAFC", "solid", 0.02));
      b.box(cx + 0.5, -0.2, cz, x1 - x0 + 2.2, 0.12, z1 - z0 + 0.03, "#1E3A5F");
      b.box(cx, 0.14, cz, x1 - x0 - 0.2, 0.08, z1 - z0 - 0.2, s.teak, "solid", 0.03);
      b.box(cx - 0.6, 0.85, cz, 5.4, 1.4, 4.6, "#F8FAFC", "solid", 0.02);
      b.box(cx - 0.6, 0.9, cz + 2.31, 5.0, 0.5, 0.02, "#22314A");
      b.box(cx - 0.9, 1.65, cz, 6.4, 0.12, 5.6, s.teak, "solid", 0.02);
      b.box(cx - 0.2, 2.3, cz, 3.4, 1.2, 3.6, "#F8FAFC", "solid", 0.02);
      b.box(cx + 1.48, 2.35, cz, 0.04, 0.5, 3.0, "#22314A");
      b.box(cx - 0.2, 2.95, cz, 4.0, 0.1, 4.0, "#E2E8F0");
      b.box(cx - 0.6, 3.6, cz, 0.12, 1.3, 0.12, "#94A3B8"); b.box(cx - 0.6, 4.2, cz, 1.4, 0.1, 0.2, "#CBD5E1"); b.box(cx - 0.6, 4.35, cz, 0.12, 0.12, 0.12, "#F87171", "glow");
      for (let k = 0; k < 5; k++) b.box(cx - 2.6 + k * 1.0, 1.0, cz + 2.31, 0.6, 0.3, 0.02, "#FFE3A3", "glow");
      b.box(x0 + 1.2, 0.3, cz, 1.6, 0.3, 1.6, "#F8FAFC"); b.box(x0 + 1.2, 0.42, cz, 1.3, 0.08, 1.3, "#38BDF8", "water");
      b.box(x0 + 0.1, 1.35, cz, 0.06, 2.4, 0.06, "#E5E7EB"); // ekip renkli bayrak yok (direk anten olarak kalır)
      for (const li of [2, 4, 8, 10]) bollard(b, tx(I(li)), tz(J(2)) + 0.38);
      b.spot("web", I(6), J(3), DOWN);
      // ön platform: güneşlenme, tender, kahve
      for (const li of [2, 3, 8, 9]) b.daybed(I(li), J(14), "#F8FAFC", "#2386C8", "-z"); // HOTEL-SYS: güverte minderi (uyku geçitte)
      parasolTable(b, I(5), J(14), "#2386C8"); parasolTable(b, I(7), J(14), "#F97316");
      breakSpot(b, I(11), J(14)); b.box(tx(I(11)), 0.45, tz(J(14)), 0.8, 0.9, 0.6, "#F8FAFC", "solid", 0.02); b.block(I(11), J(14));
      b.rest.push([I(5), J(13)], [I(7), J(13)]);
      b.hook("perch", I(5), J(7)); b.hook("sea", I(6), J(12), 2);
      x.sign = [cx, 5.0, cz];
    },
  };
  const fourth: Amenity = s.fishing ? {
    label: "dist_boats",
    floor: (li, lj) => (lj <= 7 || li === 6 || lj >= 13 ? plank(s)(li, lj) : ""),
    build: (x) => {
      const { b, I, J } = x;
      // tekne tamirhanesi: kızakta iki tekne, ağlar, sandıklar; önde bağlı balıkçı tekneleri
      for (const [li, c] of [[3, "#D9453B"], [8, "#2A9BDB"]] as [number, string][]) {
        const cx = tx(I(li)), cz = tz(J(4)) + 0.5;
        for (const dz of [-0.6, 0.6]) b.box(cx, 0.2, cz + dz, 1.2, 0.4, 0.2, "#6B4F35");
        b.box(cx, 0.75, cz, 1.0, 0.6, 2.6, c, "solid", 0.03); b.box(cx, 1.08, cz, 0.9, 0.06, 2.4, "#A0805A");
        b.box(cx, 0.55, cz - 1.45, 0.6, 0.4, 0.4, c);
        for (const lj of [3, 4, 5]) b.block(I(li), J(lj));
      }
      b.spot("shell", I(4), J(6), UP); b.spot("read", I(9), J(6), UP);
      for (const [li, lj] of [[2, 6], [10, 3], [10, 6]] as [number, number][]) { b.crate(tx(I(li)), 0.02, tz(J(lj)), 0.7); b.block(I(li), J(lj)); }
      b.box(tx(I(6)) + 0.1, 0.06, tz(J(5)), 0.8, 0.08, 0.8, "#3F6E5A"); b.box(tx(I(6)), 0.14, tz(J(5)), 0.5, 0.08, 0.5, "#F2B33D");
      hull(x, s, 2, 8, { color: s.hulls[3], accent: "#1E3A5F", walk: false, bowLeft: true, inset: 0.45, kind: "fish" });
      hull(x, s, 7, 8, { color: s.hulls[0], accent: "#F8FAFC", walk: false, bowLeft: false, inset: 0.45, kind: "fish" });
      bench(b, I(3), J(14), "#A0805A");
      breakSpot(b, I(10), J(14)); b.box(tx(I(10)), 0.4, tz(J(14)), 0.6, 0.8, 0.6, "#8B5E3C", "solid", 0.05); b.block(I(10), J(14));
      // balık tezgâhı (tente), ağ yığınları, halat kangalları, şamandıra rafı
      counter(b, I(7), I(9), J(14), "#7A4E2A", "#BFE3F5");
      b.canopy(I(7), I(9), J(14), J(14), "#2A9BDB", 2.0, "#7A4E2A", "#F8FAFC");
      for (let k = 0; k < 3; k++) b.box(tx(I(7 + k)), 1.0, tz(J(14)), 0.5, 0.1, 0.3, ["#94A3B8", "#F97316", "#CBD5E1"][k]);
      for (const [li, lj] of [[2, 2], [5, 2], [9, 2], [4, 7], [8, 7], [2, 13], [11, 13]] as [number, number][]) {
        b.box(tx(I(li)), 0.12, tz(J(lj)), 0.7, 0.24, 0.6, (li + lj) % 2 ? "#3F6E5A" : "#2F5A48", "solid", 0.08);
        b.box(tx(I(li)) + 0.2, 0.28, tz(J(lj)), 0.18, 0.1, 0.18, "#F2B33D");
      }
      for (const [li, lj] of [[11, 2], [11, 7], [1, 13]] as [number, number][]) { b.box(tx(I(li)), 0.1, tz(J(lj)), 0.5, 0.2, 0.5, "#C8A165", "solid", 0.05); b.box(tx(I(li)), 0.22, tz(J(lj)), 0.2, 0.06, 0.2, "#A0805A"); }
      x.sign = [tx(I(6)), 1.6, tz(J(2))];
    },
  } : {
    label: "dist_sundeck",
    floor: (li, lj) => ((li >= 2 && li <= 10 && lj >= 2 && lj <= 11) || li === 6 || lj >= 13 ? plank(s)(li, lj) : ""),
    build: (x) => {
      const { b, I, J } = x;
      // yüzen havuz platformu: ortada havuz, çevresinde şezlong ve şemsiyeler
      for (let li = 4; li <= 8; li++) for (let lj = 4; lj <= 8; lj++) {
        const rim = li === 4 || li === 8 || lj === 4 || lj === 8;
        b.box(tx(I(li)), rim ? 0.15 : 0.0, tz(J(lj)), 1, rim ? 0.3 : 0.1, 1, rim ? "#F8FAFC" : "#38BDF8", rim ? "solid" : "water", 0.02);
        b.block(I(li), J(lj));
      }
      for (const li of [3, 5, 7, 9]) lounger(b, I(li), J(11), "#F8FAFC");
      for (const [li, c] of [[3, "#F97316"], [9, "#2386C8"]] as [number, string][]) parasolTable(b, I(li), J(3), c);
      b.spot("web", I(6), J(9), DOWN);
      for (const li of [2, 10]) for (const lj of [5, 7]) b.box(tx(I(li)), 0.3, tz(J(lj)), 0.5, 0.6, 0.5, "#E2E8F0");
      breakSpot(b, I(10), J(14)); b.box(tx(I(10)), 0.45, tz(J(14)), 0.8, 0.9, 0.6, "#F8FAFC", "solid", 0.02); b.box(tx(I(10)), 0.95, tz(J(14)), 0.3, 0.2, 0.3, "#F97316"); b.block(I(10), J(14));
      for (const li of [2, 3, 8, 9]) b.daybed(I(li), J(14), "#F8FAFC", "#38BDF8", "-z"); // HOTEL-SYS: güverte minderi (uyku geçitte)
      for (const [li, lj] of [[1, 6], [11, 9]] as [number, number][]) buoy(b, I(li), J(lj), s.surface, "#F2B33D");
      x.sign = [tx(I(6)), 1.2, tz(J(3))];
    },
  };
  return {
    hq: s.hq, trim: s.trim, under: s.under, deck: s.deck, marina: { waterY: s.waterY, surface: s.surface, water: s.water },
    ...(s.fishing ? {} : { gangway: { col: 14, rows: [13, 15] as [number, number] } }),
    path: (li, lj) => plank(s)(li, lj), floor,
    pose: "sit_chair", device: "laptop", seatY: 0.4,
    work: (x) => {
      back(x);
      teamCorner(x, (bb, i, j) => { lounger(bb, i, j, s.cushion); lounger(bb, i + 1, j, s.cushion); lounger(bb, i + 2, j, s.cushion); });
      x.b.hook("sea", x.I(1), x.J(7), 2);
    },
    pod: (x, pi, pj) => {
      const k = (pi + pj + x.variant) % s.hulls.length;
      hull(x, s, pi, pj, { color: s.hulls[k], accent: x.color, walk: true, bowLeft: pi < 6 });
      // kıç direği (ekip renkli bayrak yok) ve radar kemeri (tente yok: kamera kokpiti görsün)
      const { b, I, J } = x;
      const bowLeft = pi < 6;
      const ax = bowLeft ? tx(I(pi + 3)) + 0.35 : tx(I(pi)) - 0.35, cz = (tz(J(pj + 1)) + tz(J(pj + 2))) / 2;
      b.box(ax, 0.9, cz, 0.06, 1.8, 0.06, "#E5E7EB");
      const mx = (tx(I(pi)) + tx(I(pi + 3))) / 2;
      for (const dz of [-1.75, 1.75]) b.box(mx, 0.85, cz + dz, 0.1, 1.7, 0.1, "#F8FAFC");
      b.box(mx, 1.72, cz, 0.16, 0.12, 3.6, "#F8FAFC");
      b.box(mx, 1.86, cz, 0.3, 0.16, 0.3, x.color);
    },
    seat: (b, i, j, face, n, x) => seat(b, i, j, face, n, x.color),
    spare,
    sleeper: (b, i, j, k) => { b.daybed(i, j, k % 2 ? "#F8FAFC" : "#E2E8F0", s.fishing ? "#2A9BDB" : "#2386C8", "-z"); b.sleep(i, j, DOWN, "bed", 0.36); },
    amenities: [club, dorm, third, fourth],
    yard: {
      label: "dist_moorings",
      floor: (li, lj) => (li === 6 ? plank(s)(li, lj) : ""),
      build: (x) => {
        const { b, I, J } = x;
        // demir yeri: orta iskeleye bağlı tekneler, şamandıralar
        hull(x, s, 2, 2, { color: s.hulls[(x.variant + 1) % s.hulls.length], accent: s.trim, walk: false, bowLeft: true, inset: 0.4, kind: "sail" });
        hull(x, s, 7, 3, { color: s.hulls[(x.variant + 2) % s.hulls.length], accent: "#F2B33D", walk: false, bowLeft: false, inset: 0.4 });
        hull(x, s, 2, 9, { color: s.hulls[(x.variant + 3) % s.hulls.length], accent: "#E07A5F", walk: false, bowLeft: true, inset: 0.4 });
        hull(x, s, 7, 10, { color: s.hulls[x.variant % s.hulls.length], accent: s.trim, walk: false, bowLeft: false, inset: 0.4, kind: "sail" });
        for (const [li, lj, c] of [[4, 7, "#E5584E"], [9, 8, "#F2B33D"], [3, 14, "#F2B33D"], [10, 14, "#E5584E"]] as [number, number, string][]) buoy(b, I(li), J(lj), s.surface, c);
        for (const lj of [3, 7, 11]) bollard(b, tx(I(6)) + 0.38, tz(J(lj)));
        b.hook("sea", I(6), J(8), 5);
        x.sign = [tx(I(6)), 1.4, tz(J(1))];
      },
    },
  };
}

export function marinaThemes(): Record<string, Theme> {
  return { sea: marinaTheme(HARBOUR), yacht: marinaTheme(YACHT) };
}
