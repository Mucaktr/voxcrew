/**
 * S38 — açık hava sahnelerinin büyüme temaları: park, sahil, kamp, savaş sahası (oyuncak), açık deniz, yat.
 * Sınırlar: çit, çalı, ip korkuluk, kum torbası; tabela ayaklı panodur. Ekip rengi: çerçeve, tabela, bayrak (ve temaya
 * göre masa örtüsü, çadır, şemsiye).
 */
import { noteObject } from "../rules/hooks";
import { sleds } from "../city/furniture";
import { tx, tz, type Builder } from "../scenes";
import { anchorAt, bench, counter, DOWN, fenceX, fenceZ, flowerBed, LEFT, parasolTable, RIGHT, rug, scatter, UP, type Fence } from "./parts";
import { breakSpot, outdoorBack, seatMark, seatSide, teamCorner, type Amenity, type Bay, type Theme } from "./themes";

const grassy = (a: string, c: string) => (li: number, lj: number) => ((li * 7 + lj * 3) % 5 ? a : c);
const BLOOMS = ["#F472B6", "#FDE047", "#A78BFA", "#FB7185", "#FFFFFF", "#F97316"];
/** S41 — çimde kır çiçekleri (engellemez). */
function blooms(x: Bay, n: number, seed: number, colors: readonly string[] = BLOOMS) {
  scatter(x.b, x.i0, x.j0, n, seed, (px, pz, k) => {
    x.b.box(px, 0.12, pz, 0.06, 0.24, 0.06, "#2F855A");
    x.b.box(px, 0.27, pz, 0.18, 0.12, 0.18, colors[k % colors.length]);
  });
}
/** S41 — küçük taş/mantar/deniz kabuğu (engellemez). */
function pebbles(x: Bay, n: number, seed: number, colors: readonly string[], h = 0.12) {
  scatter(x.b, x.i0, x.j0, n, seed, (px, pz, k) => x.b.box(px, h / 2, pz, 0.22 + (k % 3) * 0.06, h, 0.2 + (k % 2) * 0.08, colors[k % colors.length], "solid", 0.05));
}

/** Küçük bilgi panosu (web) / mantar pano (plan) / kitap kutusu (okuma): ayaklı, karoyu engeller. */
function board(b: Builder, i: number, j: number, face: string, frame: string, w = 1.0) {
  b.box(tx(i), 0.6, tz(j), 0.1, 1.2, 0.1, frame);
  b.box(tx(i), 1.25, tz(j), w, 0.7, 0.08, frame, "solid", 0.02);
  b.box(tx(i), 1.25, tz(j) + 0.05, w - 0.15, 0.55, 0.02, face);
  b.box(tx(i) - 0.15, 1.35, tz(j) + 0.065, 0.3, 0.2, 0.01, "#F8FAFC");
  b.box(tx(i) + 0.2, 1.15, tz(j) + 0.065, 0.25, 0.15, 0.01, "#FDE68A");
  b.block(i, j);
}
function bookBox(b: Builder, i: number, j: number, wood: string) {
  b.box(tx(i), 0.45, tz(j), 0.1, 0.9, 0.1, wood);
  b.box(tx(i), 1.1, tz(j), 0.8, 0.7, 0.55, wood, "solid", 0.03);
  b.box(tx(i), 1.5, tz(j), 0.95, 0.12, 0.7, "#B5543C");
  b.box(tx(i), 1.1, tz(j) + 0.28, 0.65, 0.5, 0.02, "#CFEFFF", "glass");
  for (let k = 0; k < 4; k++) b.box(tx(i) - 0.24 + k * 0.16, 1.05, tz(j) + 0.1, 0.1, 0.36, 0.2, ["#EF4444", "#3B82F6", "#F59E0B", "#10B981"][k]);
  b.block(i, j);
}
function telescope(b: Builder, i: number, j: number) {
  b.box(tx(i), 0.45, tz(j), 0.08, 0.9, 0.08, "#9CA3AF"); b.box(tx(i) - 0.2, 0.3, tz(j), 0.08, 0.6, 0.08, "#9CA3AF");
  b.box(tx(i), 1.0, tz(j), 0.22, 0.22, 0.9, "#E5E7EB");
  b.block(i, j);
}
/** Basit A çadır (3×3 karo, kapısı +z), `c` rengi. */
function tent(b: Builder, i: number, j: number, c: string, door = "#1F2937") {
  noteObject(b, "tent", [i, j]);
  [[2.8, 0.6], [2.1, 0.6], [1.3, 0.6], [0.6, 0.6]].forEach(([w, h], k) => b.box(tx(i), 0.3 + k * 0.6, tz(j), w, h, 2.4, c, "solid", 0.05)); // REAL-SUPPORT: sırt katı 0,6 (eskiden 0,4: altındaki kata 0,1 boşluk)
  b.box(tx(i), 0.45, tz(j) + 1.21, 0.7, 0.9, 0.02, door);
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) b.block(i + di, j + dj);
}
/** Su karosu (havuz/göl): engeller. */
function pool(b: Builder, i0: number, j0: number, i1: number, j1: number, c: string, y = -0.6) {
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { b.box(tx(i), y, tz(j), 1, 0.8, 1, c, "water"); b.block(i, j); }
}
/** Su üstünde iskele tahtası (yürünebilir; suyu `pool` çizer, çağıran engeli kaldırır). */
function pierTile(b: Builder, i: number, j: number, c1 = "#A0805A", c2 = "#94744F") {
  for (const o of [-0.33, 0, 0.33]) b.box(tx(i) + o, 0.02, tz(j), 0.28, 0.1, 0.96, (i + j) % 2 ? c1 : c2, "solid", 0.05);
  b.box(tx(i) - 0.45, -0.4, tz(j) - 0.45, 0.12, 0.8, 0.12, "#6B4F35");
}
/** Oyuncak araba / cip (z boyunca 2 karo). */
function jeep(b: Builder, i: number, j: number, c: string) {
  const x = tx(i), z = tz(j) + 0.5;
  b.box(x, 0.51, z, 0.95, 0.62, 1.8, c, "solid", 0.03); b.box(x, 0.85, z + 0.2, 0.85, 0.06, 0.9, "#4B5563"); // REAL-SUPPORT: gövde tavana değer (eskiden tavan 0,12 havada)
  b.box(x, 0.95, z - 0.45, 0.85, 0.35, 0.05, "#CFEFFF", "glass");
  for (const dx of [-0.48, 0.48]) for (const dz of [-0.6, 0.6]) b.box(x + dx, 0.2, z + dz, 0.14, 0.38, 0.38, "#1F2937");
  b.block(i, j); b.block(i, j + 1);
}
/** Şezlong (1 karo, sırtı +z) + önündeki dinlenme karosu. */
function lounger(b: Builder, i: number, j: number, c = "#F8FAFC") {
  noteObject(b, "sun_lounger", [i, j]);
  b.box(tx(i), 0.2, tz(j), 0.8, 0.12, 0.95, c); b.box(tx(i), 0.42, tz(j) + 0.4, 0.8, 0.45, 0.12, c);
  sleds(b.box.bind(b), tx(i), tz(j), 0.8, 0.95, 0.14, "z"); // CORE-WALK (REAL-SEAT): şezlong yere basar
  b.block(i, j); b.rest.push([i, j - 1]);
}

// ------------------------------------------------------------------ park
function parkTheme(): Theme {
  const hedge: Fence = { c: "#2F7D32", h: 0.9, t: 0.7, cap: "#3E8E3E" };
  const BLOOM = ["#F472B6", "#FDE047", "#A78BFA", "#FB7185", "#FFFFFF", "#F97316"];
  /** S41 — parkta masa yok: pod = sırt sırta iki bank, ortada çiçekli saksı; ajan bankta, dizüstü kucakta, yanında çanta. */
  const seat = (b: Builder, i: number, j: number, face: "+z" | "-z", n: number, x: Bay) => {
    const { agentJ } = seatSide(j, face);
    const out = face === "+z" ? "-z" : "+z";
    b.parkBench(i, agentJ, 2, out, n % 3 ? "#B07D48" : "#8B5A2B", "#3F4A3C");
    b.closedLaptop(tx(i + 1), 0.46, tz(agentJ), n % 2 ? "#CBD5E1" : "#94A3B8");
    b.box(tx(i + 1) + 0.25, 0.54, tz(agentJ) + (out === "+z" ? -0.1 : 0.1), 0.1, 0.14, 0.1, "#F8FAFC");
    b.block(i + 1, agentJ);
    // ortadaki saksı (iki karo): toprak, çalı, çiçekler; pod rengi şerit
    const cx = tx(i) + 0.5, z = tz(j);
    b.box(cx, 0.22, z, 1.9, 0.44, 0.9, "#9C7A54", "solid", 0.03);
    b.box(cx, 0.5, z, 1.8, 0.14, 0.8, "#2F855A", "solid", 0.1);
    for (let k = 0; k < 3; k++) b.box(cx - 0.6 + k * 0.6, 0.66, z + (k % 2 ? 0.15 : -0.15), 0.22, 0.16, 0.22, BLOOM[(n + k) % BLOOM.length]);
    b.box(cx, 0.45, z + (face === "+z" ? -0.46 : 0.46), 1.92, 0.08, 0.03, x.color);
    b.block(i, j); b.block(i + 1, j);
    seatMark(b, i, agentJ, out);
  };
  const pond: Amenity = {
    label: "dist_pond",
    floor: (li, lj) => (li >= 3 && li <= 9 && lj >= 3 && lj <= 9 ? "" : li >= 2 && li <= 10 && lj >= 2 && lj <= 10 ? "#D9C08A" : grassy("#6DBE45", "#62B03E")(li, lj)),
    build: (x) => {
      const { b, I, J } = x;
      pool(b, I(3), J(3), I(9), J(9), "#3B9DDB");
      for (let lj = 5; lj <= 9; lj++) { b.blocked.delete(`${I(6)},${J(lj)}`); pierTile(b, I(6), J(lj)); }
      b.box(tx(I(6)), 0.5, tz(J(5)) - 0.45, 1, 0.08, 0.08, "#8B5A2B");
      for (const dx of [-0.46, 0.46]) b.box(tx(I(6)) + dx, 0.25, tz(J(5)) - 0.45, 0.08, 0.5, 0.08, "#8B5A2B"); // REAL-SUPPORT: korkuluk direkleri iskele tahtasına basar
      b.spot("web", I(6), J(5), DOWN); b.spot("read", I(6), J(7), LEFT);
      b.box(tx(I(4)), -0.17, tz(J(4)), 0.5, 0.04, 0.5, "#2F855A"); b.box(tx(I(8)), -0.17, tz(J(6)), 0.4, 0.04, 0.4, "#38A169");
      // WATER-ALL: göldeki hareketsiz süs "ördek" kutuları kaldırıldı (tıklayınca tepki vermiyordu); gerçek ortam ördekleri suya habitat'tan yerleşir
      bench(b, I(2), J(13)); bench(b, I(8), J(13));
      breakSpot(b, I(10), J(11)); b.box(tx(I(10)), 0.4, tz(J(11)), 0.9, 0.8, 0.7, "#F2B33D", "solid", 0.03); b.box(tx(I(10)), 1.5, tz(J(11)), 1.2, 0.1, 1.0, "#E07A5F"); // REAL-SUPPORT: büfe zemine oturur
      b.box(tx(I(10)), 1.0, tz(J(11)), 0.06, 1.0, 0.06, "#9CA3AF"); b.block(I(10), J(11));
      b.tree(I(2), J(2), 3);
      x.sign = [tx(I(6)), 1.4, tz(J(11))];
    },
  };
  const playground: Amenity = {
    label: "dist_playground",
    floor: (li, lj) => (li >= 2 && li <= 10 && lj >= 3 && lj <= 11 ? ((li + lj) % 2 ? "#E8D3A0" : "#E0C990") : grassy("#6DBE45", "#62B03E")(li, lj)),
    build: (x) => {
      const { b, I, J } = x;
      // kaydırak: merdiven + kule + eğim
      const sx = tx(I(3)), sz = tz(J(4));
      b.box(sx, 0.75, sz, 0.9, 1.5, 0.9, "#EF4444", "solid", 0.03); b.box(sx, 1.6, sz, 1.0, 0.2, 1.0, "#F2B33D");
      for (let k = 0; k < 3; k++) {
        b.box(sx + 0.65 + k * 0.5, 1.3 - k * 0.45, sz, 0.55, 0.12, 0.7, "#3B82F6");
        if (k) b.box(sx + 0.8 + k * 0.5, (1.24 - k * 0.45) / 2, sz, 0.08, 1.24 - k * 0.45, 0.6, "#6B7280"); // REAL-SUPPORT: kaydırak basamakları ayakla zemine bağlı
      }
      b.block(I(3), J(4)); b.block(I(4), J(4)); b.block(I(5), J(4));
      // salıncak çerçevesi
      const wx = tx(I(8)) + 0.5, wz = tz(J(5));
      for (const dx of [-1, 1]) b.box(wx + dx, 1.1, wz, 0.12, 2.2, 0.12, "#6B7280");
      b.box(wx, 2.2, wz, 2.2, 0.12, 0.12, "#6B7280");
      for (const dx of [-0.45, 0.45]) { b.box(wx + dx, 1.4, wz, 0.03, 1.4, 0.03, "#CBD5E1"); b.box(wx + dx, 0.62, wz, 0.4, 0.06, 0.25, ["#10B981", "#F59E0B"][dx > 0 ? 1 : 0]); }
      b.block(I(7), J(5)); b.block(I(9), J(5));
      // kum havuzu
      fenceX(b, J(8), I(4), I(7), [], { c: "#B07D48", h: 0.3, t: 0.2, block: false });
      fenceX(b, J(10), I(4), I(7), [], { c: "#B07D48", h: 0.3, t: 0.2, block: false });
      b.box(tx(I(5)), 0.2, tz(J(9)), 0.3, 0.3, 0.3, "#EF4444"); b.box(tx(I(6)), 0.15, tz(J(9)), 0.4, 0.2, 0.25, "#3B82F6");
      b.spot("plan", I(5), J(9), UP);
      bench(b, I(2), J(13), "#B07D48"); bench(b, I(8), J(13), "#B07D48");
      breakSpot(b, I(10), J(11)); b.box(tx(I(10)), 0.5, tz(J(11)), 0.9, 0.9, 0.7, "#F8FAFC", "solid", 0.03); b.box(tx(I(10)), 1.0, tz(J(11)), 0.8, 0.2, 0.6, "#F472B6"); b.block(I(10), J(11));
      // S41: tahterevalli, dönme dolap, ağaçlar, çiçekler (boş kum alanı kalmasın)
      b.box(tx(I(8)) + 0.5, 0.3, tz(J(9)), 2.2, 0.1, 0.3, "#3B82F6"); b.box(tx(I(8)) + 0.5, 0.15, tz(J(9)), 0.2, 0.3, 0.2, "#6B7280");
      for (const dx of [-0.9, 0.9]) b.box(tx(I(8)) + 0.5 + dx, 0.45, tz(J(9)), 0.1, 0.25, 0.3, "#F59E0B");
      b.block(I(8), J(9)); b.block(I(9), J(9));
      b.box(tx(I(3)), 0.1, tz(J(9)), 1.6, 0.12, 1.6, "#EF4444", "solid", 0.02); b.box(tx(I(3)), 0.45, tz(J(9)), 0.1, 0.6, 0.1, "#9CA3AF"); // REAL-SUPPORT: dönme dolap tabanı zeminde (eskiden 0,06 havada)
      b.box(tx(I(3)), 0.6, tz(J(9)), 1.2, 0.06, 0.06, "#FDE047"); b.box(tx(I(3)), 0.6, tz(J(9)), 0.06, 0.06, 1.2, "#FDE047"); b.block(I(3), J(9));
      b.tree(I(1), J(4), 3); b.tree(I(11), J(8), 3);
      blooms(x, 36, 5);
      x.sign = [tx(I(6)), 1.4, tz(J(2))];
    },
  };
  const garden: Amenity = {
    label: "dist_garden",
    floor: (li, lj) => (li === 6 || lj === 8 ? "#C9A36B" : grassy("#6DBE45", "#62B03E")(li, lj)),
    build: (x) => {
      const { b, I, J } = x;
      const cs = [["#F472B6", "#FB7185"], ["#FDE047", "#F59E0B"], ["#A78BFA", "#FFFFFF"], ["#FB7185", "#FFFFFF"]];
      [[2, 3], [8, 3], [2, 10], [8, 10]].forEach(([li, lj], k) => flowerBed(b, I(li), J(lj), 3, 3, cs[k]));
      // çardak (gazebo): dört direk + çatı, ortası yürünebilir
      const gx = tx(I(6)), gz = tz(J(8));
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(gx + dx, 1.1, gz + dz, 0.14, 2.2, 0.14, "#F8FAFC");
      b.box(gx, 2.3, gz, 3.0, 0.2, 3.0, "#B5543C"); b.box(gx, 2.55, gz, 2.0, 0.3, 2.0, "#B5543C"); b.box(gx, 2.8, gz, 1.0, 0.2, 1.0, "#9A4532");
      b.spot("read", I(6), J(8), DOWN); b.spot("plan", I(6), J(7), UP);
      bench(b, I(3), J(7), "#B07D48"); bench(b, I(8), J(7), "#B07D48");
      breakSpot(b, I(10), J(14)); b.box(tx(I(10)), 0.5, tz(J(14)), 0.9, 0.9, 0.7, "#3F6E5A", "solid", 0.03); b.box(tx(I(10)), 1.0, tz(J(14)), 0.3, 0.2, 0.3, "#F8FAFC"); b.block(I(10), J(14));
      x.sign = [gx, 3.2, gz];
    },
  };
  /** S41 — hamak korusu (yatakhane): ağaçlar arasında hamak sıraları, çim örtüleri, limonata standı. */
  const grove: Amenity = {
    label: "dist_hammocks",
    floor: (li, lj) => (li === 6 || lj === 7 || lj === 12 ? "#D2B48C" : grassy("#5FAF3C", "#57A336")(li, lj)),
    build: (x) => {
      const { b, I, J } = x;
      const cs = ["#D9A441", "#E07A5F", "#6C8EBF", "#3F6E5A"];
      let k = 0;
      for (const lj of [4, 10]) for (const li of [3, 9]) {
        b.hammock(I(li), J(lj), cs[k++ % cs.length]); b.sleep(I(li), J(lj), LEFT, "hammock", 0.6);
      }
      for (const [li, lj] of [[3, 2], [9, 2], [3, 8], [9, 8], [3, 14], [9, 14]] as [number, number][]) { b.mat(I(li), J(lj), cs[(li + lj) % 4]); b.sleep(I(li), J(lj), DOWN, "mat", 0.06); }
      for (const [li, lj, h] of [[5, 4, 3], [7, 10, 4], [1, 9, 3], [11, 4, 3]] as [number, number, number][]) b.tree(I(li), J(lj), h);
      flowerBed(b, I(5), J(13), 1, 2, BLOOM); flowerBed(b, I(7), J(5), 1, 2, BLOOM);
      breakSpot(b, I(10), J(12), "-z"); b.box(tx(I(10)), 0.5, tz(J(12)), 0.9, 0.9, 0.7, "#FDE047", "solid", 0.03);
      b.box(tx(I(10)), 1.55, tz(J(12)), 1.1, 0.1, 1.0, "#F472B6"); b.box(tx(I(10)), 1.0, tz(J(12)), 0.06, 1.1, 0.06, "#9CA3AF"); b.block(I(10), J(12));
      b.rest.push([I(2), J(12)], [I(4), J(12)]);
      blooms(x, 40, 3);
      b.hook("grass", I(6), J(8), 5);
      x.sign = [tx(I(6)), 1.4, tz(J(7))];
    },
  };
  return {
    hq: "dist_park_hq", trim: "#E9D8A6", under: "#8B5A2B",
    path: (li, lj) => ((li * 3 + lj) % 4 ? "#C9A36B" : "#BF9A62"),
    floor: grassy("#6DBE45", "#64B33F"),
    work: (x) => {
      const { b, I, J } = x;
      outdoorBack(x, hedge, {
        read: (i, j) => bookBox(b, i, j, "#8B5A2B"),
        web: (i, j) => board(b, i, j, "#93C5FD", "#6B4226"),
        plan: (i, j) => board(b, i, j, "#C8A165", "#6B4226"),
      }, x.color, "#6B4226");
      fenceZ(b, I(1), J(2), J(15), [2, 7, 12].map(J), { ...hedge, h: 0.7, t: 0.6 });
      teamCorner(x, (bb, i, j) => bench(bb, i, j));
      b.hook("grass", I(6), J(9), 5);
    },
    seat, pose: "sit_bench", device: "laptop", seatY: 0.46, faceOut: true,
    aisle: (li, lj) => ((li * 3 + lj) % 4 ? "#D2B48C" : "#C9A36B"),
    sleeper: (b, i, j, k) => { b.mat(i, j, ["#93C5FD", "#F9A8D4", "#FDE68A", "#A7F3D0", "#C4B5FD"][k % 5]); b.sleep(i, j, DOWN, "mat", 0.06); },
    spare: (x, pi, pj, slot) => {
      const { b } = x;
      const i = x.I(pi), j = x.J(pj);
      if (slot % 2 === 0) {
        rug(b, i, j + 1, 3, 3, x.color);
        b.box(tx(i + 1), 0.15, tz(j + 2), 0.5, 0.3, 0.4, "#B07D48"); b.box(tx(i + 1), 0.32, tz(j + 2), 0.55, 0.04, 0.45, "#8B5A2B");
        b.block(i + 1, j + 2);
        b.rest.push([i, j + 1], [i + 2, j + 1], [i, j + 3]);
        b.spot("plan", i + 2, j + 3, UP);
      } else {
        flowerBed(b, i + 1, j + 1, 2, 2, ["#F472B6", "#FDE047", "#A78BFA"]);
        b.plant(i + 3, j + 3);
      }
    },
    amenities: [pond, grove, playground, garden],
    yard: {
      label: "dist_meadow",
      // kıvrımlı patika, kır çiçekleri, ağaç kümeleri, küçük gölcük ve bank
      floor: (li, lj) => (Math.abs(lj - (8 + Math.round(2.4 * Math.sin(li / 2)))) <= 0 ? "#D2B48C"
        : (li * 7 + lj * 5) % 6 === 0 ? "#7CC94F" : (li * 3 + lj) % 5 ? "#6DBE45" : "#62B03E"),
      build: (x) => {
        const { b, I, J } = x;
        for (const [li, lj, h] of [[3, 3, 3], [9, 3, 4], [3, 12, 3], [9, 13, 3], [2, 15, 3]] as [number, number, number][]) b.tree(I(li), J(lj), h);
        flowerBed(b, I(5), J(3), 2, 2, BLOOM); flowerBed(b, I(2), J(7), 1, 3, BLOOM); flowerBed(b, I(10), J(8), 1, 3, BLOOM);
        pool(b, I(5), J(11), I(7), J(12), "#3B9DDB", -0.45);
        b.box(tx(I(5)), -0.05, tz(J(11)), 0.5, 0.04, 0.5, "#2F855A");
        b.hook("pond", I(6), J(11), 1.5);
        bench(b, I(5), J(14), "#8B5A2B");
        for (let k = 0; k < 14; k++) {
          const li = 1 + ((k * 7) % 11), lj = 1 + ((k * 5) % 14);
          if (b.blocked.has(`${I(li)},${J(lj)}`)) continue;
          b.box(tx(I(li)) + 0.2, 0.12, tz(J(lj)) - 0.15, 0.06, 0.24, 0.06, "#2F855A");
          b.box(tx(I(li)) + 0.2, 0.27, tz(J(lj)) - 0.15, 0.18, 0.12, 0.18, BLOOM[k % BLOOM.length]);
        }
        b.hook("grass", I(6), J(7), 5);
        x.sign = [tx(I(6)), 1.4, tz(J(7))];
      },
    },
  };
}

// ------------------------------------------------------------------ sahil
function beachTheme(): Theme {
  const sand = (li: number, lj: number) => ((li * 5 + lj * 3) % 7 ? "#EBD9A8" : "#E3CF98");
  /** S41 — sahilde masa yok: pod = ortada iki şemsiye + soğutucu çanta, çevresinde dört şezlong (ajan uzanır, dizüstü
   *  karnında); şezlong yanında içecekli sehpa ve havlu. */
  const seat = (b: Builder, i: number, j: number, face: "+z" | "-z", n: number, x: Bay) => {
    const { agentJ } = seatSide(j, face);
    const out = face === "+z" ? "-z" : "+z";
    b.sunLounger(i, agentJ, out, n % 2 ? x.color : "#F8FAFC", "#E5E7EB");
    const sx = tx(i + 1), sz = tz(agentJ);
    b.box(sx, 0.2, sz, 0.5, 0.4, 0.5, "#C08A57", "solid", 0.03);
    b.box(sx - 0.1, 0.48, sz, 0.1, 0.16, 0.1, ["#F97316", "#22C55E", "#F43F5E"][n % 3], "glass");
    b.closedLaptop(sx + 0.08, 0.4, sz + 0.1, "#E2E8F0");
    b.block(i + 1, agentJ);
    if (face === "+z") b.umbrella(i + 1, j, n % 4 < 2 ? x.color : "#F97316", "#FFFFFF");
    else { b.box(tx(i + 1), 0.25, tz(j), 0.8, 0.5, 0.55, "#1E8FD0", "solid", 0.03); b.box(tx(i + 1), 0.52, tz(j), 0.84, 0.06, 0.6, "#F8FAFC"); b.block(i + 1, j); }
    b.box(tx(i), 0.015, tz(j), 0.8, 0.03, 0.9, ["#FCA5A5", "#93C5FD", "#FDE68A"][n % 3]);
    b.block(i, j);
    seatMark(b, i, agentJ, out);
  };
  const rope = (x: Bay): Fence => ({ c: "#D6C08A", h: 0.55, t: 0.05, post: x.color, every: 2, block: true });
  const club: Amenity = {
    label: "dist_beachclub",
    floor: (li, lj) => (lj <= 6 && li >= 2 ? ((li + lj) % 2 ? "#C08A57" : "#B47D4B") : sand(li, lj)),
    build: (x) => {
      const { b, I, J } = x;
      counter(b, I(3), I(9), J(3), "#8B5E3C", "#F8FAFC");
      b.coffeeMachine(I(5), J(3), "+z", true);
      b.box((tx(I(3)) + tx(I(9))) / 2, 2.4, tz(J(3)), 7.6, 0.2, 2.2, "#F2CC8F", "solid", 0.05);
      for (const li of [3, 9]) b.box(tx(I(li)), 1.2, tz(J(3)) - 0.4, 0.14, 2.4, 0.14, "#8B5E3C");
      for (let li = 3; li <= 9; li += 2) b.box(tx(I(li)), 0.25, tz(J(4)) + 0.1, 0.35, 0.5, 0.35, "#E07A5F");
      b.spot("plan", I(8), J(4), UP);
      for (const li of [3, 5, 7, 9]) lounger(b, I(li), J(11));
      for (const [li, c] of [[4, "#EF4444"], [8, "#3B82F6"]] as [number, string][]) parasolTable(b, I(li), J(8), c);
      b.palm(I(2), J(14)); b.palm(I(10), J(14));
      // S41: kulüp halısı, kabuklar, ek şezlong
      b.blanket(I(4), J(13), 5, 2, "#F2CC8F", "#E07A5F");
      pebbles(x, 18, 11, ["#F8FAFC", "#FBCFE8", "#FDE68A"], 0.06);
      x.sign = [tx(I(6)), 2.9, tz(J(3))];
    },
  };
  const volley: Amenity = {
    label: "dist_volley",
    floor: (li, lj) => ((li === 2 || li === 10) && lj >= 3 && lj <= 11 ? "#F8FAFC" : (lj === 3 || lj === 11) && li >= 2 && li <= 10 ? "#F8FAFC" : sand(li, lj)),
    build: (x) => {
      const { b, I, J } = x;
      const nz = tz(J(7));
      for (const li of [2, 10]) { b.box(tx(I(li)), 1.2, nz, 0.12, 2.4, 0.12, "#E5E7EB"); b.block(I(li), J(7)); }
      b.box((tx(I(2)) + tx(I(10))) / 2, 2.0, nz, 8, 0.7, 0.03, "#F8FAFC", "glass");
      b.box((tx(I(2)) + tx(I(10))) / 2, 2.38, nz, 8, 0.08, 0.06, "#1F2937");
      b.box(tx(I(5)), 0.22, tz(J(5)), 0.44, 0.44, 0.44, "#F43F5E");
      // cankurtaran kulesi (web)
      const lx = tx(I(10)), lz = tz(J(13));
      for (const dx of [-0.35, 0.35]) b.box(lx + dx, 0.9, lz, 0.1, 1.8, 0.1, "#F8FAFC");
      b.box(lx, 1.85, lz, 1.0, 0.12, 1.0, "#E11D48"); b.box(lx, 2.375, lz - 0.35, 1.0, 0.95, 0.1, "#E11D48"); b.box(lx, 2.9, lz, 1.2, 0.1, 1.2, "#F2B33D"); // REAL-SUPPORT: arka duvar çatıya değer
      b.block(I(10), J(13)); b.spot("web", I(9), J(13), RIGHT);
      bench(b, I(3), J(14), "#C08A57");
      breakSpot(b, I(7), J(14)); b.box(tx(I(7)), 0.4, tz(J(14)), 0.8, 0.8, 0.6, "#1E8FD0", "solid", 0.03); b.box(tx(I(7)), 0.82, tz(J(14)), 0.84, 0.06, 0.64, "#F8FAFC"); b.block(I(7), J(14));
      // S41: seyirci bankları, şemsiyeler, kabuklar
      bench(b, I(3), J(2), "#C08A57"); bench(b, I(8), J(2), "#C08A57");
      parasolTable(b, I(1), J(4), "#EF4444"); parasolTable(b, I(11), J(10), "#3B82F6");
      b.palm(I(1), J(10)); b.palm(I(11), J(4));
      pebbles(x, 28, 4, ["#F8FAFC", "#FBCFE8", "#FDE68A"], 0.06);
      x.sign = [tx(I(6)), 2.8, nz];
    },
  };
  /** S46 — kıyı şeridi ( B1): taban sahilin denizi (j 0–4) büyüyen dünyada MERKEZ'in sağında kesintisiz sürer.
   * lj 0–4 deniz (tabanla aynı renk bantları, köpük şeridi), li 0'da denize uzanan iskele (sokak sütunu yürünebilir kalır; uçta
   * balık tutma yeri), lj 5 ıslak kum, kumda cankurtaran kulesi (web), şemsiyeli şezlong sırası, palmiyeler, duş, kumdan kale.
   * Eski "kumun ortasında havuza uzanan iskele" olanağının yerini alır (iskele artık denize çıkar).*/
  const shore: Amenity = {
    label: "dist_pier",
    street: (li, lj) => lj > 4 || (li === 0 && lj > 0),
    floor: (li, lj) => (lj <= 4 ? "" : lj === 5 ? "#E3CF98" : sand(li, lj)),
    build: (x) => {
      const { b, I, J } = x;
      for (let li = 0; li < 12; li++) for (let lj = 0; lj <= 4; lj++) {
        b.box(tx(I(li)), -0.6, tz(J(lj)), 1, 0.8, 1, lj === 4 ? "#7DD3FC" : lj === 3 ? "#38BDF8" : "#1E8FD0", "water");
        b.block(I(li), J(lj));
      }
      for (let li = 1; li < 12; li += 2) b.box(tx(I(li)) + 0.3, -0.17, tz(J(4)) + 0.4, 0.6, 0.06, 0.2, "#F0F9FF");
      for (let lj = 1; lj <= 4; lj++) { b.blocked.delete(`${I(0)},${J(lj)}`); pierTile(b, I(0), J(lj)); }
      b.hook("fish", I(0), J(1), 1);
      b.hook("sea", I(6), J(2), 6); b.hook("sand", I(6), J(10), 5);
      // tek/çift bölge aynalı (kıyı boyunca kopya sıra olmasın: DIST-CLONE-001); M: yerel sütun
      const M = (li: number) => I(x.variant % 2 ? 12 - li : li);
      // cankurtaran kulesi (web) — denize bakar
      const lx = tx(M(9)), lz = tz(J(7));
      for (const dx of [-0.35, 0.35]) b.box(lx + dx, 0.9, lz, 0.1, 1.8, 0.1, "#F8FAFC");
      b.box(lx, 1.85, lz, 1.0, 0.12, 1.0, "#E11D48"); b.box(lx, 2.375, lz + 0.35, 1.0, 0.95, 0.1, "#E11D48"); b.box(lx, 2.9, lz, 1.2, 0.1, 1.2, "#F2B33D"); // REAL-SUPPORT: arka duvar çatıya değer
      b.block(M(9), J(7)); b.spot("web", M(9), J(8), UP);
      // şemsiyeli şezlong sırası (dinlenme), denize bakar
      for (const [li, c] of [[2, "#EF4444"], [5, "#3B82F6"]] as [number, string][]) {
        b.umbrella(M(li + 1), J(8), x.variant % 3 ? c : "#F97316", "#FFFFFF");
        lounger(b, M(li), J(8), "#F8FAFC"); lounger(b, M(li + 2), J(8), "#F8FAFC");
      }
      b.palm(M(2), J(13)); b.palm(M(10), J(12)); b.palm(M(6), J(14));
      // duş direği + kumdan kale + sörf tahtaları
      b.box(tx(M(11)), 1.1, tz(J(10)), 0.1, 2.2, 0.1, "#CBD5E1"); b.box(tx(M(11)), 2.2, tz(J(10)) + 0.15, 0.3, 0.08, 0.4, "#CBD5E1"); b.block(M(11), J(10));
      b.cube(M(4), J(12), 0, "#D9C08A", 0.6); b.box(tx(M(4)) - 0.3, 0.8, tz(J(12)) - 0.3, 0.3, 0.4, 0.3, "#D9C08A"); b.block(M(4), J(12));
      for (const [k, c] of [[0, "#F97316"], [1, "#14B8A6"]] as [number, string][]) b.box(tx(M(8)) - 0.2 + k * 0.4, 0.75, tz(J(13)), 0.3, 1.5, 0.08, c);
      b.block(M(8), J(13));
      bench(b, M(6), J(11), "#C08A57");
      pebbles(x, 20, 13 + x.variant, ["#F8FAFC", "#FBCFE8", "#FDE68A", "#E5E7EB"], 0.06);
      x.sign = [tx(I(6)), 1.4, tz(J(6))];
    },
  };
  /** S41 — plaj kulübeleri (yatakhane): iki sıra renkli kulübe, içleri yürünebilir; önlerinde havlu ve palmiye. */
  const huts: Amenity = {
    label: "dist_beachhuts",
    floor: (li, lj) => (lj === 7 || lj === 13 ? ((li + lj) % 2 ? "#C08A57" : "#B47D4B") : sand(li, lj)),
    build: (x) => {
      const { b, I, J } = x;
      const cs = ["#3B82F6", "#F59E0B", "#10B981", "#EF4444", "#8B5CF6", "#14B8A6", "#F472B6", "#0EA5E9", "#EAB308"];
      for (const lj of [4, 10]) for (let li = 2; li <= 10; li++) {
        const c = cs[(li + lj) % cs.length], hx = tx(I(li)), hz = tz(J(lj));
        b.box(hx, 0.9, hz - 0.45, 0.98, 1.8, 0.08, c, "solid", 0.02);
        b.box(hx - 0.47, 0.9, hz, 0.06, 1.8, 0.98, "#F8FAFC");
        b.box(hx, 1.92, hz, 1.04, 0.16, 1.04, (li % 2) ? "#F8FAFC" : c);
        b.mat(I(li), J(lj), (li % 2) ? "#FDE68A" : "#93C5FD");
        b.sleep(I(li), J(lj), DOWN, "mat", 0.06);
        b.hook("roof", I(li), J(lj));
      }
      for (const lj of [4, 10]) { b.box(tx(I(11)) - 0.47, 0.9, tz(J(lj)), 0.06, 1.8, 0.98, "#F8FAFC"); }
      b.palm(I(2), J(14)); b.palm(I(10), J(14)); b.palm(I(11), J(7));
      parasolTable(b, I(4), J(14), "#F97316"); parasolTable(b, I(8), J(14), "#14B8A6");
      breakSpot(b, I(6), J(14), "-z"); b.box(tx(I(6)), 0.45, tz(J(14)), 0.9, 0.9, 0.7, "#38BDF8", "solid", 0.03); b.box(tx(I(6)), 1.6, tz(J(14)), 1.2, 0.1, 1.1, "#F8FAFC"); b.block(I(6), J(14));
      for (const dx of [-0.55, 0.55]) b.box(tx(I(6)) + dx, 0.8, tz(J(14)) + 0.45, 0.06, 1.6, 0.06, "#E5E7EB"); // REAL-SUPPORT: tente direkleri (eskiden havada)
      pebbles(x, 22, 7, ["#F8FAFC", "#FBCFE8", "#FDE68A", "#E5E7EB"], 0.06);
      b.hook("sand", I(6), J(8), 5);
      x.sign = [tx(I(6)), 2.4, tz(J(4))];
    },
  };
  return {
    hq: "dist_beach_hq", trim: "#7DD3FC", under: "#D6C08A",
    path: (li, lj) => ((li + lj) % 2 ? "#C08A57" : "#B47D4B"),
    floor: sand,
    work: (x) => {
      const { b, I, J } = x;
      outdoorBack(x, rope(x), {
        read: (i, j) => bookBox(b, i, j, "#C08A57"),
        web: (i, j) => telescope(b, i, j),
        plan: (i, j) => board(b, i, j, "#1F3B2D", "#8B5E3C"),
      }, x.color, "#8B5E3C");
      fenceZ(b, I(1), J(2), J(15), [2, 7, 12].map(J), rope(x));
      teamCorner(x, (bb, i, j) => { lounger(bb, i, j, "#F8FAFC"); lounger(bb, i + 1, j, "#F8FAFC"); lounger(bb, i + 2, j, "#F8FAFC"); });
      b.hook("sand", I(6), J(9), 5);
    },
    seat, pose: "lounge", device: "laptop", seatY: 0.34, faceOut: true,
    aisle: (li, lj) => ((li + lj) % 2 ? "#C08A57" : "#B47D4B"),
    sleeper: (b, i, j, k) => { b.sunLounger(i, j, "-z", ["#FCA5A5", "#93C5FD", "#FDE68A"][k % 3], "#CBD5E1"); b.sleep(i, j, DOWN, "lounger", 0.34); },
    spare: (x, pi, pj, slot) => {
      const { b } = x;
      const i = x.I(pi), j = x.J(pj);
      if (slot % 2 === 0) { parasolTable(b, i + 1, j + 1, x.color); lounger(b, i + 1, j + 3, x.color); lounger(b, i + 2, j + 3, x.color); }
      else {
        b.cube(i + 1, j + 1, 0, "#D9C08A", 0.6); b.box(tx(i + 1) - 0.3, 0.8, tz(j + 1) - 0.3, 0.3, 0.4, 0.3, "#D9C08A"); b.block(i + 1, j + 1);
        b.box(tx(i + 2) + 0.2, 0.22, tz(j + 2), 0.44, 0.44, 0.44, "#F43F5E");
        // sörf tahtası standı (alçak: arkadaki pod'ları kapatmaz)
        for (const [k, c] of [[0, x.color], [1, "#F8FAFC"]] as [number, string][]) b.box(tx(i + 3) - 0.2 + k * 0.4, 0.75, tz(j + 3), 0.3, 1.5, 0.08, c);
        b.box(tx(i + 3), 0.1, tz(j + 3), 0.9, 0.2, 0.3, "#8B5E3C"); b.block(i + 3, j + 3);
      }
    },
    // S46: iç kumda havuza uzanan iskele (`pier`) kaldırıldı — iskele artık kıyı şeridinde denize çıkar (`coast`)
    amenities: [club, huts, volley],
    coast: shore,
    yard: {
      label: "dist_dunes",
      floor: sand,
      build: (x) => {
        const { b, I, J } = x;
        [[3, 4, 3, 0.5], [8, 9, 4, 0.6]].forEach(([li, lj, w, h]) => b.box(tx(I(li)), h / 2, tz(J(lj)), w, h, 3, "#E3CF98", "solid", 0.04));
        for (const [li, lj] of [[2, 4], [3, 4], [4, 4], [7, 9], [8, 9], [9, 9], [10, 9]] as [number, number][]) b.block(I(li), J(lj));
        b.palm(I(10), J(3)); b.palm(I(3), J(12)); b.palm(I(6), J(5)); b.palm(I(10), J(12));
        lounger(b, I(7), J(14)); lounger(b, I(8), J(14));
        // kum tepesi otları, deniz kabukları, kumdan kale, sörf tahtaları
        for (const [li, lj] of [[2, 6], [9, 7], [5, 9], [4, 13], [8, 11]] as [number, number][]) for (let k = 0; k < 3; k++)
          b.box(tx(I(li)) + (k - 1) * 0.18, 0.25 + k * 0.05, tz(J(lj)) + (k % 2) * 0.12, 0.05, 0.5 + k * 0.1, 0.05, "#9CA35A");
        pebbles(x, 30, 9, ["#F8FAFC", "#FBCFE8", "#FDE68A", "#E5E7EB"], 0.06);
        b.cube(I(6), J(11), 0, "#D9C08A", 0.6); b.box(tx(I(6)) - 0.3, 0.8, tz(J(11)) - 0.3, 0.3, 0.4, 0.3, "#D9C08A"); b.block(I(6), J(11));
        for (const [k, c] of [[0, "#F97316"], [1, "#14B8A6"]] as [number, string][]) b.box(tx(I(2)) - 0.2 + k * 0.4, 0.75, tz(J(10)), 0.3, 1.5, 0.08, c);
        b.block(I(2), J(10));
        b.hook("sand", I(6), J(8), 5);
        x.sign = [tx(I(6)), 1.2, tz(J(7))];
      },
    },
  };
}

// ------------------------------------------------------------------ kamp: ateş çevresinde halkalar
function campTheme(): Theme {
  const log: Fence = { c: "#6B4226", h: 0.5, t: 0.35, cap: "#7A4E2A" };
  const seat = (b: Builder, i: number, j: number, face: "+z" | "-z") => {
    const { user, dz, agentJ } = seatSide(j, face);
    // kütük oturak (ajan karosunda) + küçük kütük masa (masa karosunun ajan tarafında)
    b.box(tx(i), 0.2, tz(agentJ) + dz * 0.25, 0.9, 0.35, 0.35, "#7A4E2A", "solid", 0.05);
    b.box(tx(i), 0.28, tz(j) + dz * 0.25, 0.55, 0.56, 0.55, "#8B5A2B", "solid", 0.06);
    b.box(tx(i), 0.57, tz(j) + dz * 0.25, 0.5, 0.02, 0.5, "#A47148");
    b.laptop(tx(i), 0.58, tz(j) + dz * 0.25, user);
    b.block(i, j); b.block(i + 1, j);
    seatMark(b, i, agentJ);
  };
  const fire = (b: Builder, cx: number, cz: number, big = false) => {
    const r = big ? 0.9 : 0.55, s = big ? 1.5 : 1;
    for (let a = 0; a < 8; a++) b.box(cx + Math.cos(a * 0.785) * r, 0.1, cz + Math.sin(a * 0.785) * r, 0.25 * s, 0.2, 0.25 * s, "#78716C");
    b.box(cx, 0.12, cz, 0.9 * s, 0.14, 0.18, "#5D3A1A"); b.box(cx, 0.18, cz, 0.18, 0.14, 0.9 * s, "#6B4226");
    b.box(cx, 0.4 * s, cz, 0.45 * s, 0.45 * s, 0.45 * s, "#FF7A1A", "flame"); b.box(cx, 0.75 * s, cz, 0.28 * s, 0.35 * s, 0.28 * s, "#FFD34D", "flame");
  };
  const kettle = (b: Builder, i: number, j: number) => {
    breakSpot(b, i, j);
    b.box(tx(i), 0.3, tz(j), 0.6, 0.6, 0.6, "#8B5A2B", "solid", 0.06);
    b.box(tx(i), 0.75, tz(j), 0.34, 0.3, 0.34, "#374151"); b.box(tx(i) + 0.22, 0.8, tz(j), 0.12, 0.05, 0.05, "#374151");
    b.block(i, j);
  };
  const bonfire: Amenity = {
    label: "dist_bonfire",
    floor: (li, lj) => (Math.hypot(li - 6, lj - 8) < 2.6 ? "#6B4F35" : (li * 3 + lj) % 4 ? "#355E2E" : "#305529"),
    build: (x) => {
      const { b, I, J } = x;
      const cx = tx(I(6)), cz = tz(J(8));
      fire(b, cx, cz, true);
      for (const li of [5, 6, 7]) for (const lj of [7, 8, 9]) b.block(I(li), J(lj));
      for (const [li, lj, w, d] of [[6, 4, 3, 0.5], [6, 12, 3, 0.5], [2.5, 8, 0.5, 3], [9.5, 8, 0.5, 3]] as [number, number, number, number][]) {
        b.box(tx(I(0)) + li, 0.22, tz(J(0)) + lj, w, 0.4, d, "#7A4E2A", "solid", 0.05);
      }
      for (const li of [5, 6, 7]) { b.rest.push([I(li), J(5)], [I(li), J(11)]); b.block(I(li), J(4)); b.block(I(li), J(12)); }
      b.lights.push({ pos: [cx, 1.4, cz], color: "#FF9A3C", intensity: 9, distance: 10, flicker: true });
      kettle(b, I(10), J(13));
      pebbles(x, 22, 1, ["#78716C", "#A8A29E", "#DC2626"], 0.1);
      b.spot("plan", I(4), J(8), RIGHT);
      for (const [li, lj] of [[2, 2], [10, 2], [2, 14]] as [number, number][]) b.pine(I(li), J(lj));
      x.sign = [cx, 2.2, cz];
    },
  };
  const clearing: Amenity = {
    label: "dist_clearing",
    floor: (li, lj) => ((li * 3 + lj) % 4 ? "#3E6B35" : "#365F2E"),
    build: (x) => {
      const { b, I, J } = x;
      for (const [li, lj] of [[2, 3], [10, 3], [2, 12], [10, 12], [4, 2], [8, 14]] as [number, number][]) b.pine(I(li), J(lj));
      telescope(b, I(6), J(4)); b.spot("web", I(6), J(5), UP);
      // hamak (dinlenme): iki direk arası kumaş
      for (const li of [4, 8]) b.box(tx(I(li)), 0.8, tz(J(9)), 0.15, 1.6, 0.15, "#6B4226");
      b.box(tx(I(6)), 0.6, tz(J(9)), 3.9, 0.1, 0.8, "#D9A441"); for (const li of [4, 5, 6, 7, 8]) b.block(I(li), J(9)); // REAL-SUPPORT: bez iki direğe değer (eskiden 0,12 kısa)
      b.rest.push([I(5), J(8)], [I(7), J(8)]);
      bookBox(b, I(3), J(7), "#7A4E2A"); b.spot("read", I(3), J(8), UP);
      for (const [li, lj] of [[5, 12], [7, 13], [4, 14]] as [number, number][]) { b.box(tx(I(li)), 0.1, tz(J(lj)), 0.1, 0.2, 0.1, "#F8FAFC"); b.box(tx(I(li)), 0.24, tz(J(lj)), 0.3, 0.12, 0.3, "#E11D48"); }
      kettle(b, I(10), J(8));
      // S41: yıldız gözlem minderleri, eğreltiotu ve mantarlar
      // HOTEL-SYS (E1): açıklıkta yer yatağı yok (uyku sahnenin kulübe geçidinde)
      scatter(b, x.i0, x.j0, 22, 5, (px, pz, k) => { b.box(px, 0.15, pz, 0.36, 0.3, 0.36, k % 3 ? "#2F6B2A" : "#3E7A34", "solid", 0.1); },
        (li, lj) => anchorAt(b, I(li), J(lj))); // REAL-SEAT: eğreltiotu uyku minderi karosuna konmaz
      pebbles(x, 16, 9, ["#DC2626", "#F5F5F4", "#78716C"], 0.12);
      x.sign = [tx(I(6)), 1.9, tz(J(4))];
    },
  };
  const lake: Amenity = {
    label: "dist_lake",
    floor: (li, lj) => (li >= 2 && li <= 10 && lj >= 3 && lj <= 10 ? "" : (li * 3 + lj) % 4 ? "#355E2E" : "#305529"),
    build: (x) => {
      const { b, I, J } = x;
      pool(b, I(2), J(3), I(10), J(10), "#1E5F8A");
      for (let lj = 6; lj <= 10; lj++) { b.blocked.delete(`${I(6)},${J(lj)}`); pierTile(b, I(6), J(lj), "#7A4E2A", "#6B4226"); }
      b.spot("web", I(6), J(6), DOWN);
      for (const [li, c] of [[4, "#E11D48"], [8, "#D9A441"]] as [number, string][]) {
        b.box(tx(I(li)), -0.12, tz(J(7)), 0.6, 0.25, 2.2, c, "bob"); b.box(tx(I(li)), 0.02, tz(J(7)), 0.45, 0.06, 1.8, "#7A4E2A", "bob");
      }
      bench(b, I(3), J(13), "#7A4E2A"); kettle(b, I(9), J(13));
      bookBox(b, I(10), J(14), "#7A4E2A"); b.spot("read", I(10), J(13), DOWN);
      b.pine(I(2), J(14));
      x.sign = [tx(I(6)), 1.2, tz(J(11))];
    },
  };
  /** S41 — çadır köyü (yatakhane): açık önlü çadırlar, içlerinde uyku tulumu; ortada ateş ve kütükler. */
  const tents: Amenity = {
    label: "dist_tents",
    floor: (li, lj) => (lj === 7 || lj === 13 || li === 6 ? ((li + lj) % 2 ? "#6B4F35" : "#5E4630") : (li * 3 + lj) % 4 ? "#355E2E" : "#305529"),
    build: (x) => {
      const { b, I, J } = x;
      const cs: [string, string][] = [["#F97316", "#C2410C"], ["#22C55E", "#15803D"], ["#EAB308", "#A16207"], ["#0EA5E9", "#0369A1"]];
      let k = 0;
      for (const lj of [3, 9]) for (const li of [2, 7]) {
        const [c, d] = cs[k++ % 4];
        b.openTent(I(li), J(lj), c, d);
        for (const di of [1, 2]) { b.mat(I(li + di), J(lj + 1), ["#2563EB", "#DC2626"][di - 1], "#F3E7C9"); b.sleep(I(li + di), J(lj + 1), DOWN, "tent", 0.06); }
        b.hook("roof", I(li + 1), J(lj + 1));
      }
      for (const li of [3, 4, 8, 9]) { b.mat(I(li), J(14), "#7C3AED", "#F3E7C9"); b.sleep(I(li), J(14), DOWN, "mat", 0.06); }
      fire(b, tx(I(6)), tz(J(13))); b.block(I(6), J(13));
      for (const li of [5, 7]) { b.box(tx(I(li)), 0.2, tz(J(13)), 0.4, 0.35, 0.9, "#7A4E2A", "solid", 0.05); b.block(I(li), J(13)); }
      b.box(tx(I(10)), 0.2, tz(J(13)), 0.25, 0.4, 0.25, "#FDE68A", "glow"); // REAL-SUPPORT: fener yerde
      kettle(b, I(10), J(14));
      for (const [li, lj] of [[1, 5], [11, 5], [11, 11], [1, 15]] as [number, number][]) b.pine(I(li), J(lj));
      pebbles(x, 14, 6, ["#78716C", "#A8A29E", "#DC2626"], 0.1);
      x.sign = [tx(I(6)), 2.2, tz(J(7))];
    },
  };
  return {
    hq: "dist_camp_hq", trim: "#D9A441", under: "#4A3420",
    path: (li, lj) => ((li + lj * 3) % 5 ? "#6B4F35" : "#5E4630"),
    floor: (li, lj) => ((li * 3 + lj) % 4 ? "#355E2E" : "#305529"),
    work: (x) => {
      const { b, I, J } = x;
      outdoorBack(x, log, {
        read: (i, j) => bookBox(b, i, j, "#7A4E2A"),
        web: (i, j) => telescope(b, i, j),
        plan: (i, j) => board(b, i, j, "#C8A165", "#5D3A1A"),
      }, x.color, "#5D3A1A");
      fenceZ(b, I(1), J(2), J(15), [2, 7, 12].map(J), log);
      b.pine(I(11), J(1));
      teamCorner(x, (bb, i, j) => bench(bb, i, j, "#7A4E2A", "#5D3A1A"));
      pebbles(x, 16, 2, ["#78716C", "#A8A29E", "#DC2626", "#F5F5F4"], 0.1);
      b.hook("grass", I(6), J(9), 5);
    },
    seat: (b, i, j, face) => seat(b, i, j, face), pose: "sit_bench", device: "laptop", seatY: 0.38,
    aisle: (li, lj) => ((li + lj * 3) % 5 ? "#6B4F35" : "#5E4630"),
    sleeper: (b, i, j, k) => { b.mat(i, j, ["#2563EB", "#DC2626", "#16A34A", "#EAB308"][k % 4], "#F3E7C9"); b.sleep(i, j, DOWN, "mat", 0.06); },
    pod: (x, pi, pj) => {
      const cx = (tx(x.I(pi + 1)) + tx(x.I(pi + 2))) / 2, cz = (tz(x.J(pj + 1)) + tz(x.J(pj + 2))) / 2;
      fire(x.b, cx, cz);
    },
    spare: (x, pi, pj, slot) => {
      const { b } = x;
      const i = x.I(pi), j = x.J(pj);
      tent(b, i + 1, j + 1, slot % 2 ? "#D9A441" : x.color);
      b.box(tx(i + 3), 0.2, tz(j + 3), 0.25, 0.4, 0.25, "#FDE68A", "glow"); b.block(i + 3, j + 3); // REAL-SUPPORT: fener yerde
      b.rest.push([i + 1, j + 3]);
    },
    amenities: [bonfire, tents, clearing, lake],
    yard: {
      label: "dist_forest",
      floor: (li, lj) => ((li * 3 + lj) % 4 ? "#2F5228" : "#2A4A24"),
      build: (x) => {
        const { b, I, J } = x;
        for (const [li, lj] of [[2, 3], [5, 2], [9, 3], [3, 7], [8, 8], [5, 11], [10, 12], [2, 14], [10, 6], [7, 14]] as [number, number][]) b.pine(I(li), J(lj));
        // devrik kütükler, eğreltiotu, mantar ve taşlar; küçük dere
        for (const [li, lj] of [[6, 5], [4, 10]] as [number, number][]) { b.box(tx(I(li)) + 0.5, 0.2, tz(J(lj)), 1.8, 0.36, 0.4, "#6B4226", "solid", 0.06); b.block(I(li), J(lj)); b.block(I(li + 1), J(lj)); }
        pool(b, I(8), J(10), I(9), J(11), "#1E5F8A", -0.45); b.hook("pond", I(8), J(10), 1);
        scatter(b, x.i0, x.j0, 26, 8, (px, pz, k) => { b.box(px, 0.15, pz, 0.36, 0.3, 0.36, k % 3 ? "#2F6B2A" : "#3E7A34", "solid", 0.1); });
        pebbles(x, 18, 3, ["#DC2626", "#F5F5F4", "#78716C"], 0.12);
        x.sign = [tx(I(6)), 1.2, tz(J(6))];
      },
    },
  };
}

// ------------------------------------------------------------------ savaş sahası (oyuncak tatbikat, şiddetsiz)
function battlefieldTheme(): Theme {
  const seat = (b: Builder, i: number, j: number, face: "+z" | "-z") => {
    const { user, agentJ } = seatSide(j, face);
    const cx = tx(i) + 0.5, z = tz(j);
    b.box(cx, 0.74, z, 2, 0.1, 0.9, "#9C7A4A", "solid", 0.03);
    for (const dx of [-0.85, 0.85]) b.box(cx + dx, 0.35, z, 0.1, 0.7, 0.7, "#5D3A1A");
    b.block(i, j); b.block(i + 1, j);
    b.laptop(tx(i), 0.79, z, user);
    b.box(tx(i + 1), 0.86, z, 0.5, 0.06, 0.4, "#E8D5B5");
    b.crate(tx(i), 0, tz(agentJ), 0.5, "#9A7442");
    seatMark(b, i, agentJ);
  };
  const field = (li: number, lj: number) => ((li * 7 + lj * 3) % 11 === 0 ? "#6E8F33" : (li + lj) % 2 ? "#86A843" : "#7FA23A");
  const bigTent = (b: Builder, cx: number, cz: number, c1: string, c2: string, w = 5) => {
    [[w, 0.65], [w - 1, 0.6], [w - 2.2, 0.6], [w - 3.6, 0.6]].forEach(([ww, h], k) => b.box(cx, 0.33 + k * 0.62, cz, ww, h, 3, k % 2 ? c1 : c2, "solid", 0.04)); // REAL-SUPPORT: tepe katı 0,6
    b.box(cx, 0.55, cz + 1.51, 1.1, 1.1, 0.02, "#2A3320");
  };
  const hqTent: Amenity = {
    label: "dist_hqtent",
    floor: (li, lj) => (lj >= 7 && lj <= 9 ? ((li + lj) % 2 ? "#B39563" : "#A88B5C") : field(li, lj)),
    build: (x) => {
      const { b, I, J } = x;
      bigTent(b, tx(I(6)), tz(J(4)), "#5E7A3A", "#56703A", 6);
      for (let li = 3; li <= 9; li++) for (let lj = 3; lj <= 5; lj++) b.block(I(li), J(lj));
      b.flag(I(10), J(3), "#F2B33D", 3, "#FFFFFF");
      // harita masası (plan)
      b.box((tx(I(5)) + tx(I(7))) / 2, 0.72, tz(J(8)), 2.8, 0.1, 0.9, "#8A5A32", "solid", 0.03);
      for (const dx of [-1.25, 1.25]) b.box((tx(I(5)) + tx(I(7))) / 2 + dx, 0.335, tz(J(8)), 0.12, 0.67, 0.7, "#5D3A1A"); // REAL-SUPPORT: harita masası ayaklı
      b.box((tx(I(5)) + tx(I(7))) / 2, 0.78, tz(J(8)), 2.4, 0.02, 0.7, "#BFE0A0");
      for (let k = 0; k < 6; k++) b.box(tx(I(5)) + k * 0.4, 0.86, tz(J(8)) + (k % 2 ? 0.15 : -0.15), 0.12, 0.14, 0.12, k % 2 ? "#3B82F6" : "#EF4444");
      for (const li of [5, 6, 7]) b.block(I(li), J(8));
      b.spot("plan", I(6), J(7), UP); b.spot("plan", I(6), J(9), DOWN);
      // telsiz (web)
      b.box(tx(I(2)), 0.4, tz(J(8)), 0.8, 0.8, 0.6, "#4B5563", "solid", 0.03); b.box(tx(I(2)), 1.4, tz(J(8)), 0.06, 1.4, 0.06, "#9CA3AF");
      b.box(tx(I(2)), 0.55, tz(J(8)) + 0.31, 0.5, 0.2, 0.02, "#34D399", "glow"); b.block(I(2), J(8)); b.spot("web", I(3), J(8), LEFT);
      b.sandbags(I(2), I(4), J(14), 2); b.sandbags(I(8), I(10), J(14), 2);
      breakSpot(b, I(10), J(11)); b.box(tx(I(10)), 0.4, tz(J(11)), 0.6, 0.8, 0.6, "#9CA3AF", "solid", 0.03); b.box(tx(I(10)), 0.85, tz(J(11)), 0.3, 0.1, 0.3, "#4B5563"); b.block(I(10), J(11));
      bench(b, I(6), J(13), "#9A7442", "#5D3A1A");
      course(x, 12);
      for (const [li, lj] of [[9, 10], [3, 10], [2, 6]] as [number, number][]) bale(b, I(li), J(lj));
      pebbles(x, 12, 5, ["#6E8F33", "#5E7A3A"], 0.16);
      x.sign = [tx(I(6)), 3.0, tz(J(4))];
    },
  };
  const mess: Amenity = {
    label: "dist_mess",
    floor: field,
    build: (x) => {
      const { b, I, J } = x;
      for (const [li, lj] of [[3, 3], [9, 3], [3, 11], [9, 11]] as [number, number][]) { b.box(tx(I(li)), 1.25, tz(J(lj)), 0.12, 2.5, 0.12, "#5D3A1A"); b.block(I(li), J(lj)); }
      b.box(tx(I(6)), 2.55, tz(J(7)), 7.4, 0.12, 9.4, "#7A9450", "solid", 0.04);
      b.box(tx(I(6)), 2.7, tz(J(7)), 5, 0.2, 9.4, "#5E7A3A", "solid", 0.04);
      for (const lj of [5, 9]) {
        b.box(tx(I(6)), 0.72, tz(J(lj)), 5, 0.08, 0.9, "#9C7A4A", "solid", 0.03);
        for (let li = 4; li <= 8; li++) b.block(I(li), J(lj));
        for (const dx of [-2.3, 2.3]) b.box(tx(I(6)) + dx, 0.34, tz(J(lj)), 0.12, 0.68, 0.7, "#5D3A1A"); // REAL-SUPPORT: masa ve banklar ayaklı (eskiden havada)
        for (const s of [-1, 1]) {
          b.box(tx(I(6)), 0.36, tz(J(lj)) + s * 0.65, 5, 0.1, 0.32, "#8B5A2B");
          for (const dx of [-2.3, 0, 2.3]) b.box(tx(I(6)) + dx, 0.155, tz(J(lj)) + s * 0.65, 0.1, 0.31, 0.3, "#5D3A1A");
        }
        b.rest.push([I(4), J(lj - 1)], [I(8), J(lj + 1)]);
      }
      b.spot("plan", I(6), J(7), UP);
      counter(b, I(2), I(4), J(14), "#9C7A4A", "#E8D5B5"); b.coffeeMachine(I(3), J(14), "+z", true);
      for (const li of [8, 9, 10]) b.crate(tx(I(li)), 0, tz(J(14)), 0.8);
      for (const li of [8, 9, 10]) b.block(I(li), J(14));
      x.sign = [tx(I(6)), 3.2, tz(J(7))];
    },
  };
  const depot: Amenity = {
    label: "dist_depot",
    floor: (li, lj) => ((li + lj) % 2 ? "#B39563" : "#A88B5C"),
    build: (x) => {
      const { b, I, J } = x;
      for (const [li, lj, h] of [[3, 3, 2], [4, 3, 1], [3, 4, 1], [9, 3, 2], [10, 3, 1], [9, 4, 1]] as [number, number, number][]) {
        for (let k = 0; k < h; k++) b.crate(tx(I(li)), k * 0.8, tz(J(lj)), 0.8, k % 2 ? "#8A6A3C" : "#9A7442");
        b.block(I(li), J(lj));
      }
      b.spot("shell", I(5), J(3), LEFT);
      jeep(b, I(6), J(7), "#56703A");
      // gözetleme kulesi (web)
      const wx = tx(I(10)), wz = tz(J(10));
      for (const [dx, dz] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) b.box(wx + dx, 1.55, wz + dz, 0.1, 3.1, 0.1, "#6B4226"); // REAL-SUPPORT: direkler çatıya kadar
      b.box(wx, 2.6, wz, 1.2, 0.12, 1.2, "#8B5A2B"); b.box(wx, 3.1, wz, 1.3, 0.12, 1.3, "#56703A");
      b.block(I(10), J(10)); b.spot("web", I(9), J(10), RIGHT);
      b.sandbags(I(2), I(5), J(14), 2);
      breakSpot(b, I(8), J(14)); b.box(tx(I(8)), 0.4, tz(J(14)), 0.6, 0.8, 0.6, "#9CA3AF", "solid", 0.03); b.block(I(8), J(14));
      bench(b, I(3), J(11), "#9A7442", "#5D3A1A");
      // S41: yakıt varilleri, saman balyaları, ikinci cip, parkur
      for (const [li, lj] of [[2, 8], [2, 9], [3, 8]] as [number, number][]) { b.box(tx(I(li)), 0.4, tz(J(lj)), 0.6, 0.8, 0.6, (li + lj) % 2 ? "#4B5E33" : "#3F4F2A", "solid", 0.04); b.block(I(li), J(lj)); }
      jeep(b, I(4), J(7), "#7A9450");
      for (const [li, lj] of [[9, 6], [10, 6], [9, 13], [10, 13]] as [number, number][]) bale(b, I(li), J(lj));
      pebbles(x, 16, 2, ["#6E8F33", "#5E7A3A", "#78716C"], 0.16);
      b.canopy(I(4), I(7), J(6), J(9), "#56703A", 2.0, "#5D3A1A", "#4E6630");
      course(x, 12); course(x, 2);
      x.sign = [tx(I(6)), 1.6, tz(J(5))];
    },
  };
  /** S41 — koğuş (yatakhane): iki uzun kanvas tente altında portatif yatak sıraları; dolaplar, bayrak, ayakkabı rafı. */
  const barracks: Amenity = {
    label: "dist_barracks",
    floor: (li, lj) => (lj >= 3 && lj <= 5) || (lj >= 9 && lj <= 11) ? ((li + lj) % 2 ? "#B39563" : "#A88B5C") : field(li, lj),
    build: (x) => {
      const { b, I, J } = x;
      for (const lj of [4, 10]) {
        b.canopy(I(2), I(10), J(lj - 1), J(lj + 1), "#5E7A3A", 2.0, "#5D3A1A", "#56703A");
        for (let li = 2; li <= 10; li++) {
          if (li === 6) continue;
          b.cot(I(li), J(lj), li % 2 ? "#6E8F33" : "#5E7A3A", "#E8D5B5", "#3F4F2A"); b.sleep(I(li), J(lj), DOWN, "cot", 0.36);
          b.crate(tx(I(li)), 0, tz(J(lj - 1)), 0.5, "#9A7442"); b.block(I(li), J(lj - 1));
        }
        b.hook("roof", I(6), J(lj));
      }
      b.flag(I(11), J(14), "#F2B33D", 2.6, "#FFFFFF");
      for (const [li, lj] of [[2, 14], [3, 14]] as [number, number][]) { b.box(tx(I(li)), 0.45, tz(J(lj)), 0.62, 0.9, 0.62, "#4B5E33", "solid", 0.05); b.block(I(li), J(lj)); }
      breakSpot(b, I(8), J(14)); b.box(tx(I(8)), 0.4, tz(J(14)), 0.6, 0.8, 0.6, "#9CA3AF", "solid", 0.03); b.block(I(8), J(14));
      for (const [li, lj] of [[4, 7], [8, 7], [2, 13], [10, 13]] as [number, number][]) { b.box(tx(I(li)), 0.2, tz(J(lj)), 0.3, 0.4, 0.3, "#F97316"); b.box(tx(I(li)), 0.42, tz(J(lj)), 0.2, 0.06, 0.2, "#F8FAFC"); }
      x.sign = [tx(I(6)), 2.6, tz(J(4))];
    },
  };
  /** Oyuncak engel parkuru: lastikler (yürünebilir), koniler, saman balyaları. */
  const course = (x: Bay, lj: number) => {
    const { b, I, J } = x;
    for (let li = 2; li <= 10; li += 2) {
      const cx = tx(I(li)), cz = tz(J(lj));
      for (const [dx, dz, w, d] of [[0, -0.3, 0.7, 0.14], [0, 0.3, 0.7, 0.14], [-0.3, 0, 0.14, 0.46], [0.3, 0, 0.14, 0.46]]) b.box(cx + dx, 0.07, cz + dz, w, 0.14, d, "#1F2937");
    }
  };
  const bale = (b: Builder, i: number, j: number) => { b.box(tx(i), 0.3, tz(j), 0.9, 0.6, 0.6, "#E3C26B", "solid", 0.06); b.box(tx(i), 0.3, tz(j), 0.92, 0.06, 0.62, "#B8962E"); b.block(i, j); };
  return {
    hq: "dist_field_hq", trim: "#CDB287", under: "#6B4F35",
    path: (li, lj) => ((li + lj) % 2 ? "#B39563" : "#A88B5C"),
    floor: field,
    work: (x) => {
      const { b, I, J } = x;
      const bags = { c: "#CDB287", h: 0.5, t: 0.6, cap: "#BFA275" };
      outdoorBack(x, bags, {
        read: (i, j) => bookBox(b, i, j, "#9A7442"),
        web: (i, j) => telescope(b, i, j),
        plan: (i, j) => board(b, i, j, "#BFE0A0", "#5D3A1A", 1.2),
      }, x.color, "#5D3A1A");
      fenceZ(b, I(1), J(2), J(15), [2, 7, 12].map(J), bags);
      teamCorner(x, (bb, i, j) => bench(bb, i, j, "#9A7442", "#5D3A1A"));
      b.hook("grass", I(6), J(9), 5);
    },
    seat: (b, i, j, face) => seat(b, i, j, face), pose: "sit_chair", device: "laptop", seatY: 0.5,
    aisle: (li, lj) => ((li + lj) % 2 ? "#B39563" : "#A88B5C"),
    sleeper: (b, i, j, k) => { b.cot(i, j, k % 2 ? "#6E8F33" : "#5E7A3A", "#E8D5B5", "#3F4F2A"); b.sleep(i, j, DOWN, "cot", 0.36); },
    spare: (x, pi, pj, slot) => {
      const { b } = x;
      const i = x.I(pi), j = x.J(pj);
      if (slot % 2 === 0) { tent(b, i + 1, j + 1, x.color); b.rest.push([i + 1, j + 3]); }
      else {
        for (const [di, dj] of [[0, 0], [1, 0], [0, 1]] as [number, number][]) { b.crate(tx(i + di), 0, tz(j + dj), 0.8); b.block(i + di, j + dj); }
        b.sandbags(i + 1, i + 3, j + 3, 2);
      }
    },
    amenities: [hqTent, barracks, mess, depot],
    yard: {
      label: "dist_training",
      // koşu pisti halkası (kiremit rengi) + iç saha
      floor: (li, lj) => ((li === 2 || li === 10) && lj >= 3 && lj <= 13) || ((lj === 3 || lj === 13) && li >= 2 && li <= 10)
        ? ((li + lj) % 2 ? "#C2703D" : "#B5663A") : field(li, lj),
      build: (x) => {
        const { b, I, J } = x;
        for (const lj of [4, 8, 12]) b.sandbags(I(3), I(5), J(lj), 1);
        for (const [li, lj] of [[8, 4], [9, 6], [8, 8], [9, 10]] as [number, number][]) {
          b.box(tx(I(li)), 0.2, tz(J(lj)), 0.3, 0.4, 0.3, "#F97316"); b.box(tx(I(li)), 0.42, tz(J(lj)), 0.2, 0.06, 0.2, "#F8FAFC");
        }
        // S41: lastik parkuru, saman balyaları, tırmanma duvarı, ağaç
        course(x, 14); course(x, 2);
        for (const [li, lj] of [[7, 12], [10, 12], [2, 6], [2, 10]] as [number, number][]) bale(b, I(li), J(lj));
        b.box(tx(I(10)) + 0.5, 0.9, tz(J(8)), 1.9, 1.8, 0.3, "#8B5A2B", "solid", 0.04);
        for (let k = 0; k < 6; k++) b.box(tx(I(10)) + 0.1 + (k % 3) * 0.4, 0.4 + Math.floor(k / 3) * 0.6 + (k % 2) * 0.2, tz(J(8)) + 0.17, 0.12, 0.12, 0.06, ["#EF4444", "#3B82F6", "#F59E0B"][k % 3]);
        b.block(I(10), J(8)); b.block(I(11), J(8));
        b.tree(I(6), J(10), 3);
        pebbles(x, 14, 4, ["#6E8F33", "#5E7A3A"], 0.18);
        x.sign = [tx(I(6)), 1.2, tz(J(2))];
      },
    },
  };
}

// açık deniz ve yat: S41'de marina.ts'e taşındı (su üstünde iskeleler ve bağlı tekneler)

export function outdoorThemes(): Record<string, Theme> {
  return { park: parkTheme(), beach: beachTheme(), camp: campTheme(), battlefield: battlefieldTheme() };
}

