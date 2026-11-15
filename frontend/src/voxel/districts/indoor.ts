/**
 * S38 — iç mekân sahnelerinin büyüme temaları: ofis, ev, kafe, uzay üssü, karlı köy (kütük kulübe).
 * Paletler: her bölge türünün kendi zemin/duvar/vurgu renkleri; ekip rengi yalnızca çerçeve, tabela ve bayrakta.
 */
import { tx, tz, type Builder } from "../scenes";
import {
  armchair, bench, bookshelf, booth, cafeTable, counter, couch, DOWN, fenceX, fenceZ, flowerBed, fridge, LEFT, meetingRoom,
  anchorAt, parasolTable, planter, RIGHT, rug, scatter, UP, type Fence,
} from "./parts";
import {
  breakSpot, indoorBack, indoorSides, seatMark, seatSide, teamCorner, type Amenity, type Bay, type IndoorStyle, type Theme,
} from "./themes";
import { legs4, sleds } from "../city/furniture"; // CORE-WALK (REAL-SEAT): şezlong yere basar

const chk = (a: string, c: string) => (li: number, lj: number) => ((li + lj) % 2 ? a : c);
const chk2 = (a: string, c: string) => (li: number, lj: number) => (((li >> 1) + (lj >> 1)) % 2 ? a : c);

// ------------------------------------------------------------------ ortak iç mekân parçaları
/** Ekip/ortak çalışma bölgesi: arka duvar, sol bölme, ön saksılar, köşe. */
function indoorWork(s: IndoorStyle, rest: (b: Builder, i: number, j: number) => void) {
  return (x: Bay) => {
    indoorBack(x, s, { signColor: x.color });
    // S41: ön kenar süsü yerine ön şeritte uyku yerleri (core.ts SLEEP_ROW)
    indoorSides(x, { ...s, front: undefined });
    teamCorner(x, rest);
  };
}

/** S41 — yatakhane olanağı: arka duvar + kapı, iki sıra yatak (başlarında dolap sırası), önde oturma köşesi ve kahve.
 *  Yataklar engellemez (uyku karosu); koridorlar lj 2/7/12 ve li 6 açık kalır. */
function dorm(label: string, s: IndoorStyle, o: { floor: (li: number, lj: number) => string; locker: string; rug: string;
  bed: (b: Builder, i: number, j: number, k: number) => void; couch: [string, string]; lamp?: string }): Amenity {
  return {
    label, floor: o.floor,
    build: (x) => {
      const { b, I, J } = x;
      indoorBack(x, s, { shelves: false, board: false, window: true, signColor: s.base });
      indoorSides(x, { ...s, front: undefined });
      let k = 0;
      for (const lj of [4, 10]) {
        rug(b, I(2), J(lj + 1), 4, 1, o.rug); rug(b, I(7), J(lj + 1), 4, 1, o.rug);
        for (const li of [2, 3, 4, 5, 7, 8, 9, 10]) {
          b.box(tx(I(li)), 0.55, tz(J(lj - 1)), 0.9, 1.1, 0.7, o.locker, "solid", 0.03);
          b.box(tx(I(li)) + 0.3, 0.6, tz(J(lj - 1)) + 0.36, 0.05, 0.2, 0.02, "#94A3B8");
          b.block(I(li), J(lj - 1));
          o.bed(b, I(li), J(lj), k++);
        }
      }
      for (const li of [3, 9]) b.lamp(I(li), J(14), o.lamp ?? "#FDE68A");
      couch(b, I(4), J(15), o.couch[0], o.couch[1]);
      b.coffeeMachine(I(10), J(15), "-z");
      planter(b, I(2), J(14), "#9CA3AF");
      x.sign = [tx(I(6)), s.h + 0.55, tz(J(1)) + 0.6];
    },
  };
}

/** Boş pod yuvası: çift → toplantı adası (yuvarlak masa, tabureler; plan noktası), tek → oturma köşesi (berjerler, sehpa). */
function huddleOrLounge(o: { table: string; stool: string; rug: string; chair: string; chairBack: string; lamp?: string }) {
  return (x: Bay, pi: number, pj: number, slot: number) => {
    const { b } = x;
    const i = x.I(pi), j = x.J(pj);
    rug(b, i, j, 4, 4, o.rug);
    if (slot % 2 === 0) {
      const cx = (tx(i + 1) + tx(i + 2)) / 2, cz = (tz(j + 1) + tz(j + 2)) / 2;
      b.box(cx, 0.36, cz, 0.3, 0.72, 0.3, "#4B5563");
      b.box(cx, 0.74, cz, 1.8, 0.08, 1.8, o.table, "solid", 0.03);
      b.box(cx - 0.4, 0.8, cz + 0.2, 0.5, 0.03, 0.34, "#F8FAFC");
      for (const [dx, dz] of [[-0.5, -1.25], [0.5, -1.25], [-0.5, 1.25], [0.5, 1.25], [-1.25, 0], [1.25, 0]]) {
        b.box(cx + dx, 0.24, cz + dz, 0.4, 0.48, 0.4, o.stool, "solid", 0.04);
      }
      for (const di of [1, 2]) for (const dj of [1, 2]) b.block(i + di, j + dj);
      b.spot("plan", i + 1, j, UP); b.spot("plan", i + 2, j + 3, DOWN);
    } else {
      armchair(b, i + 1, j + 3, o.chair, o.chairBack);
      armchair(b, i + 2, j + 3, o.chair, o.chairBack);
      b.box((tx(i + 1) + tx(i + 2)) / 2, 0.22, tz(j + 1), 1.6, 0.44, 0.7, o.table, "solid", 0.03);
      b.block(i + 1, j + 1); b.block(i + 2, j + 1);
      planter(b, i + 3, j + 3, "#9CA3AF");
      b.lamp(i, j + 3, o.lamp ?? "#FDE68A");
    }
  };
}

/** Avlu (iç bahçe): çimen, taş patika, saksı ağaçları, banklar, küçük havuz, kahve büfesi. */
function atrium(label: string, grass: [string, string], stone: string, kiosk: (x: Bay) => void): Amenity {
  return {
    label,
    floor: (li, lj) => (li === 6 || lj === 8 ? stone : (li * 3 + lj) % 5 ? grass[0] : grass[1]),
    build: (x) => {
      const { b, I, J } = x;
      for (const [li, lj] of [[3, 4], [9, 4], [3, 12], [9, 12]] as [number, number][]) b.tree(I(li), J(lj), 2);
      bench(b, I(2), J(7)); bench(b, I(9), J(7));
      for (let li = 5; li <= 7; li++) for (let lj = 10; lj <= 11; lj++) {
        b.box(tx(I(li)), -0.15, tz(J(lj)), 1, 0.3, 1, "#7DD3FC", "water"); b.block(I(li), J(lj));
      }
      flowerBed(b, I(4), J(14), 2, 1, ["#F472B6", "#FDE047", "#FFFFFF"]);
      kiosk(x);
      // S46 (DIST-DENSITY-001): çimde süs otları ve çiçek kümeleri (taş yollar hariç; engellemez)
      scatter(b, x.i0, x.j0, 22, 5 + x.variant, (px, pz, k) => {
        b.box(px, 0.11, pz, 0.26, 0.22, 0.26, k % 3 ? grass[1] : "#3F8F4E", "solid", 0.06);
        if (k % 2) b.box(px, 0.26, pz, 0.14, 0.1, 0.14, ["#F472B6", "#FDE047", "#FFFFFF"][k % 3]);
      }, (li, lj) => li === 6 || lj === 8 || anchorAt(b, I(li), J(lj)));
      x.sign = [tx(I(6)), 2.1, tz(J(8))];
    },
  };
}

/** S41 — uzay modülünde zemin ışık şeritleri (engellemez; boş zemin kalmasın). */
function floorLights(x: Bay, n: number, seed: number, c = "#5EEAD4") {
  scatter(x.b, x.i0, x.j0, n, seed, (px, pz, k) => x.b.box(px, 0.025, pz, k % 2 ? 0.7 : 0.18, 0.03, k % 2 ? 0.12 : 0.7, c, "glow"));
}
/** S41 — okuma masası (tek karo, engeller) + iki tabure + açık kitap. */
function readingTable(b: Builder, i: number, j: number, top: string, stool: string) {
  cafeTable(b, i, j, top, stool);
  b.box(tx(i) - 0.15, 0.79, tz(j) + 0.05, 0.36, 0.03, 0.26, "#F8FAFC");
}

// ------------------------------------------------------------------ ofis
const OFFICE: IndoorStyle = {
  wall: "#ECE6DA", base: "#C9BBA5", h: 2.4, shelf: "#7B5236",
  side: { c: "#CFEFFF", h: 1.3, t: 0.08, g: "glass", cap: "#64748B" },
  front: (b, i, j) => planter(b, i, j, "#B8AFA3", "#3E8E3E"),
};
const officeSeat = (b: Builder, i: number, j: number, face: "+z" | "-z") => {
  const front = face === "-z";
  b.desk(i, j, 2, "#E7D7C1", "#6B7280", true);
  b.monitor(i, j, front ? "+z" : "-z", 0, front ? -0.14 : 0.14);
  b.deskLamp(i + 1, j, "#FDE68A", 0.25, front ? 0.25 : -0.25);
  b.chair(i, seatSide(j, face).agentJ, face);
};

function officeTheme(): Theme {
  const glassWall: Fence = { c: "#CFEFFF", h: 2.1, t: 0.08, g: "glass", cap: "#475569" };
  const plain = (x: Bay, door = true, window = true) => indoorBack(x, OFFICE, { shelves: false, board: false, door, window, signColor: "#64748B" });
  const kitchen: Amenity = {
    label: "dist_kitchen",
    floor: (li, lj) => (lj === 8 ? "#C9785A" : (li + lj) % 2 ? "#EFE6D8" : "#E2D3BD"),
    build: (x) => {
      const { b, I, J } = x;
      plain(x); indoorSides(x, { ...OFFICE, front: undefined });
      counter(b, I(2), I(5), J(2), "#F5F5F4", "#57534E");
      b.coffeeMachine(I(3), J(2), "+z", true);
      b.box(tx(I(5)), 0.97, tz(J(2)), 0.6, 0.03, 0.5, "#94A3B8");
      counter(b, I(9), I(9), J(2), "#F5F5F4", "#57534E"); fridge(b, I(10), J(2));
      b.box(tx(I(9)), 1.05, tz(J(2)), 0.4, 0.14, 0.4, "#F59E0B"); b.box(tx(I(9)), 1.14, tz(J(2)), 0.18, 0.1, 0.18, "#EF4444");
      for (const li of [3, 5, 8, 10]) cafeTable(b, I(li), J(5), "#F8FAFC", "#C9785A");
      meetingRoom(b, I(2), J(8), I(10), J(13), I(6), { table: "#C8A97E", chair: "#475569", floor: "#D8C3A0" });
      couch(b, I(8), J(15), "#C9785A", "#A85F44");
      planter(b, I(2), J(15)); planter(b, I(3), J(15));
    },
  };
  const meeting: Amenity = {
    label: "dist_meeting",
    floor: (_li, lj) => (lj % 2 ? "#D2B48C" : "#C8A97E"),
    build: (x) => {
      const { b, I, J } = x;
      plain(x, false, false); indoorSides(x, { ...OFFICE, front: undefined });
      meetingRoom(b, I(2), J(1), I(10), J(6), I(6), { table: "#8B5E3C", chair: "#334155", back: false, floor: "#B9C7D6" });
      meetingRoom(b, I(2), J(8), I(10), J(13), I(6), { table: "#8B5E3C", chair: "#7C2D12", floor: "#D6C3A8" });
      b.coffeeMachine(I(2), J(14), "+z");
      booth(b, I(9), J(14)); booth(b, I(10), J(14));
      couch(b, I(4), J(15), "#5B7DB1", "#4A6A9C");
    },
  };
  const library: Amenity = {
    label: "dist_library",
    floor: chk("#3F6E5A", "#467A63"),
    build: (x) => {
      const { b, I, J } = x;
      fenceX(b, J(1), I(1), I(11), [2, 3, 4, 5, 6, 7, 8, 9, 10].map(I), { c: OFFICE.wall, h: 2.4, t: 1 });
      for (const li of [2, 3, 4, 5, 7, 8, 9, 10]) bookshelf(b, I(li), J(1), "#6B4423", 2.2);
      b.box(tx(I(6)), 2.1, tz(J(1)), 1, 0.6, 1, OFFICE.wall);
      for (const li of [3, 4, 8, 9]) b.spot("read", I(li), J(2), DOWN);
      x.sign = [tx(I(6)), 2.95, tz(J(1)) + 0.6];
      indoorSides(x, { ...OFFICE, front: undefined });
      for (const li of [2, 3, 4, 8, 9, 10]) bookshelf(b, I(li), J(5), "#8B5E3C", 1.3);
      b.spot("read", I(3), J(6), DOWN); b.spot("read", I(9), J(6), DOWN);
      for (const li of [3, 4, 8, 9]) armchair(b, I(li), J(10), "#B45309", "#92400E");
      b.lamp(I(5), J(10), "#FDE68A"); b.lamp(I(7), J(10), "#FDE68A");
      booth(b, I(2), J(14)); booth(b, I(3), J(14));
      b.coffeeMachine(I(10), J(13), "+z");
      couch(b, I(8), J(15), "#3F6E5A", "#2F5A48");
      // S41: okuma masaları ve halılar
      rug(b, I(2), J(7), 9, 3, "#B45309"); rug(b, I(2), J(11), 9, 2, "#2F5A48");
      for (const li of [3, 9]) readingTable(b, I(li), J(8), "#8B5E3C", "#3F6E5A");
      planter(b, I(5), J(8), "#9CA3AF"); planter(b, I(7), J(8), "#9CA3AF");
    },
  };
  const server: Amenity = {
    label: "dist_server",
    floor: (li, lj) => (li >= 2 && li <= 10 && lj >= 2 && lj <= 8 ? ((li + lj) % 2 ? "#7B8594" : "#828C9A") : (li + lj) % 2 ? "#9AA3AE" : "#8F98A4"),
    build: (x) => {
      const { b, I, J } = x;
      plain(x, false); indoorSides(x, { ...OFFICE, front: undefined });
      fenceX(b, J(8), I(2), I(10), [I(6)], glassWall);
      fenceZ(b, I(2), J(2), J(7), [], glassWall); fenceZ(b, I(10), J(2), J(7), [], glassWall);
      for (const li of [3, 4, 5, 7, 8, 9]) b.serverRack(I(li), J(3), "+z");
      for (const li of [3, 4, 8, 9]) b.serverRack(I(li), J(6), "-z");
      for (const li of [4, 8]) { b.spot("shell", I(li), J(4), DOWN); b.spot("shell", I(li), J(5), UP); }
      for (let li = 3; li <= 9; li++) b.box(tx(I(li)), 0.012, tz(J(4)) + 0.5, 0.9, 0.02, 0.06, "#38BDF8", "glow");
      b.terminal(I(3), J(10), "+z"); b.terminal(I(4), J(10), "+z");
      b.spot("shell", I(3), J(11), DOWN); b.spot("shell", I(4), J(11), DOWN);
      for (const li of [8, 9, 10]) booth(b, I(li), J(13));
      b.coffeeMachine(I(7), J(10), "+z");
      couch(b, I(3), J(15), "#475569", "#334155");
    },
  };
  return {
    hq: "dist_hq", trim: "#8C6A48", under: "#7A5230",
    path: (li, lj) => ((li + lj) % 2 ? "#D9D4CB" : "#CFC9BE"),
    floor: chk2("#97A3B4", "#A0ACBD"),
    work: indoorWork(OFFICE, (b, i, j) => couch(b, i, j, "#5B7DB1", "#4A6A9C")),
    seat: (b, i, j, face) => officeSeat(b, i, j, face), pose: "sit_chair", device: "desktop",
    aisle: (li, lj) => ((li + lj) % 2 ? "#B9C3D0" : "#B1BCCA"),
    sleeper: (b, i, j, k) => { b.napPod(i, j, "#E2E8F0", k % 2 ? "#93C5FD" : "#A7F3D0"); b.sleep(i, j, DOWN, "bunk", 0.34); },
    spare: huddleOrLounge({ table: "#E7D7C1", stool: "#7C6CF0", rug: "#C7CEDB", chair: "#5E8C6A", chairBack: "#4E7A5A" }),
    amenities: [kitchen, dorm("dist_quietroom", OFFICE, { floor: chk("#A9B7C6", "#B3C0CE"), locker: "#CBD5E1", rug: "#7C6CF0",
      bed: (b, i, j, k) => { b.napPod(i, j, "#E2E8F0", k % 2 ? "#93C5FD" : "#C4B5FD"); b.sleep(i, j, DOWN, "bunk", 0.34); }, couch: ["#5B7DB1", "#4A6A9C"] }),
    meeting, library, server],
    yard: atrium("dist_atrium", ["#7FB069", "#76A660"], "#D6CCBC", (x) => x.b.coffeeMachine(x.I(10), x.J(13), "+z")),
    row0: (x) => {
      const { b, I, J } = x;
      fenceX(b, J(0), I(0), I(11), [], { c: "#ECE6DA", h: 4, t: 1 });
      for (const li of [2, 3, 8, 9]) b.box(tx(I(li)), 2.2, tz(J(0)) + 0.51, 0.9, 1.4, 0.04, "#A8D8F0", "glass");
      b.box((tx(I(0)) + tx(I(11))) / 2, 0.5, tz(J(0)) + 0.505, 12, 1, 0.02, "#C9BBA5");
    },
  };
}

// ------------------------------------------------------------------ ev
const HOME: IndoorStyle = {
  wall: "#B7C9A8", base: "#8B6B4A", h: 2.4, shelf: "#7B5236", books: ["#E07A5F", "#3F6E5A", "#F2CC8F", "#6C8EBF"],
  side: { c: "#E9DFD0", h: 0.95, t: 0.2, cap: "#8B6B4A" },
  front: (b, i, j) => planter(b, i, j, "#C2410C", "#2F855A"),
};
function homeTheme(): Theme {
  /** S41 — evde masa sırası yok: pod = mutfak adası (tezgâh + tabureler), dizüstü adada. */
  const seat = (b: Builder, i: number, j: number, face: "+z" | "-z") => {
    const { user, dz, agentJ } = seatSide(j, face);
    const x = tx(i) + 0.5, z = tz(j);
    b.box(x, 0.45, z, 2, 0.9, 0.8, "#3F6E5A", "solid", 0.03);
    b.box(x, 0.93, z, 2.04, 0.06, 0.9, "#F8FAFC", "solid", 0.02);
    b.block(i, j); b.block(i + 1, j);
    b.laptop(tx(i), 0.97, z, user);
    b.box(tx(i + 1) - 0.2, 1.02, z + dz * 0.1, 0.14, 0.12, 0.14, ["#E07A5F", "#6C8EBF", "#F2CC8F"][(i + j) % 3]);
    b.box(tx(i + 1) + 0.2, 1.0, z - dz * 0.15, 0.3, 0.08, 0.3, "#F59E0B");
    b.stool(i, agentJ, "#E07A5F");
    seatMark(b, i, agentJ, face);
  };
  const terrace: Amenity = {
    label: "dist_terrace",
    floor: (li, lj) => (lj >= 3 && lj <= 12 && li >= 2 ? ((li + lj) % 2 ? "#A9825A" : "#9C7650") : (li * 3 + lj) % 4 ? "#6DBE45" : "#62B03E"),
    build: (x) => {
      const { b, I, J } = x;
      fenceX(b, J(1), I(1), I(11), [I(6)], { c: "#E9DFD0", h: 0.9, t: 0.2, cap: "#8B6B4A" });
      fenceZ(b, I(1), J(2), J(15), [2, 7, 12].map(J), { c: "#E9DFD0", h: 0.9, t: 0.2, cap: "#8B6B4A" });
      for (const [li, lj, c] of [[3, 5, "#E07A5F"], [8, 5, "#3F6E5A"], [3, 10, "#F2B33D"]] as [number, number, string][]) parasolTable(b, I(li), J(lj), c);
      for (const li of [8, 9, 10]) { b.box(tx(I(li)), 0.2, tz(J(10)), 0.8, 0.12, 1.6, "#F8FAFC"); sleds(b.box.bind(b), tx(I(li)), tz(J(10)), 0.8, 1.6, 0.14, "z"); b.box(tx(I(li)), 0.45, tz(J(10)) + 0.7, 0.8, 0.5, 0.12, "#F8FAFC"); b.block(I(li), J(10)); b.rest.push([I(li), J(9)]); }
      counter(b, I(2), I(4), J(14), "#8B6B4A", "#E7E5E4");
      b.coffeeMachine(I(3), J(14), "+z", true);
      b.box(tx(I(9)), 0.45, tz(J(14)), 0.9, 0.9, 0.7, "#1F2937"); b.box(tx(I(9)), 0.93, tz(J(14)), 0.8, 0.06, 0.6, "#F97316", "glow"); b.block(I(9), J(14));
      flowerBed(b, I(9), J(2), 2, 1, ["#F472B6", "#FDE047", "#A78BFA"]);
      b.spot("plan", I(3), J(9), UP);
      x.sign = [tx(I(6)), 1.6, tz(J(1))];
    },
  };
  const workshop: Amenity = {
    label: "dist_workshop",
    floor: (li, lj) => ((li * 7 + lj * 3) % 9 === 0 ? "#8F96A0" : (li + lj) % 2 ? "#A3A9B2" : "#9AA0A9"),
    build: (x) => {
      const { b, I, J } = x;
      indoorBack(x, { ...HOME, wall: "#C8BBA8" }, { shelves: false, board: false, window: true, signColor: "#8B6B4A" });
      indoorSides(x, { ...HOME, front: undefined });
      counter(b, I(2), I(4), J(2), "#8B5A2B", "#C08457");
      b.box(tx(I(3)), 1.65, tz(J(1)) + 0.53, 2.6, 1.1, 0.05, "#6B7280");
      for (let k = 0; k < 6; k++) b.box(tx(I(2)) + k * 0.42, 1.65 + (k % 2) * 0.2, tz(J(1)) + 0.57, 0.08, 0.5, 0.03, ["#EF4444", "#F59E0B", "#3B82F6"][k % 3]);
      b.spot("shell", I(3), J(3), DOWN); b.spot("shell", I(4), J(3), DOWN);
      for (const li of [9, 10]) bookshelf(b, I(li), J(2), "#6B7280", 1.8, "+z", ["#F59E0B", "#94A3B8", "#EF4444", "#22C55E"]);
      b.spot("read", I(9), J(3), DOWN);
      // garaj: araba (z boyunca 2 karo), kapı çizgisi
      const car = (li: number, lj: number, c: string) => {
        const cx = tx(I(li)), cz = tz(J(lj)) + 0.5;
        b.box(cx, 0.42, cz, 0.95, 0.5, 1.8, c, "solid", 0.03); b.box(cx, 0.86, cz - 0.1, 0.85, 0.4, 1.0, "#1E3A5F");
        for (const dx of [-0.48, 0.48]) for (const dz of [-0.6, 0.6]) b.box(cx + dx, 0.18, cz + dz, 0.12, 0.34, 0.34, "#111827");
        b.block(I(li), J(lj)); b.block(I(li), J(lj + 1));
      };
      car(4, 8, "#3F6E5A"); car(8, 8, "#E07A5F");
      rug(b, I(3), J(7), 7, 4, "#8F96A0");
      b.coffeeMachine(I(10), J(13), "+z");
      couch(b, I(3), J(15), "#6C8EBF", "#5878A8");
    },
  };
  const living: Amenity = {
    label: "dist_living",
    floor: (li, lj) => ((li + lj) % 4 < 2 ? "#C99A6B" : "#B98A5C"),
    build: (x) => {
      const { b, I, J } = x;
      indoorBack(x, HOME, { board: false, signColor: "#8B6B4A" });
      indoorSides(x, { ...HOME, front: undefined });
      rug(b, I(2), J(4), 5, 5, "#E07A5F");
      b.box((tx(I(3)) + tx(I(5))) / 2, 0.3, tz(J(4)), 3, 0.6, 0.7, "#6B4F3A"); for (const li of [3, 4, 5]) b.block(I(li), J(4));
      b.box((tx(I(3)) + tx(I(5))) / 2, 1.1, tz(J(4)), 2, 1, 0.1, "#111827"); b.box((tx(I(3)) + tx(I(5))) / 2, 1.1, tz(J(4)) + 0.06, 1.8, 0.8, 0.02, "#60A5FA", "glow");
      couch(b, I(3), J(8), "#6C8EBF", "#5878A8");
      counter(b, I(8), I(10), J(5), "#3F6E5A", "#F8FAFC");
      b.coffeeMachine(I(9), J(5), "+z", true);
      b.box((tx(I(8)) + tx(I(10))) / 2, 0.74, tz(J(10)), 3, 0.1, 1, "#8B5E3C", "solid", 0.03);
      legs4(b.box.bind(b), (tx(I(8)) + tx(I(10))) / 2, tz(J(10)), 3, 1, 0.69, "#5E3E24", 0, 0.08); // CORE-WALK: yemek masası yere basar
      for (const li of [8, 9, 10]) b.block(I(li), J(10));
      b.spot("plan", I(8), J(9), UP); b.spot("plan", I(10), J(11), DOWN);
      b.lamp(I(2), J(14), "#FFD38A");
      armchair(b, I(4), J(14), "#D97706", "#B45309"); armchair(b, I(5), J(14), "#D97706", "#B45309");
      // S41: yemek alanı halısı, kitaplık, bitkiler, puflar
      rug(b, I(7), J(9), 4, 3, "#3F6E5A"); rug(b, I(2), J(12), 5, 2, "#F2CC8F");
      for (const li of [9, 10]) bookshelf(b, I(li), J(14), "#7B5236", 1.6, "+z", HOME.books);
      planter(b, I(8), J(14), "#C2410C"); planter(b, I(10), J(7), "#C2410C");
      for (const [li, c] of [[7, "#E07A5F"], [2, "#6C8EBF"]] as [number, string][]) { b.box(tx(I(li)), 0.2, tz(J(8)), 0.7, 0.4, 0.7, c, "solid", 0.06); b.block(I(li), J(8)); }
    },
  };
  return {
    hq: "dist_home", trim: "#7FA36B", under: "#8B6B4A",
    path: (li, lj) => ((li + lj) % 2 ? "#A57A50" : "#9C7149"),
    floor: chk("#D8C8B0", "#CFBFA6"),
    work: indoorWork(HOME, (b, i, j) => couch(b, i, j, "#6C8EBF", "#5878A8")),
    seat: (b, i, j, face) => seat(b, i, j, face), pose: "sit_chair", device: "laptop", seatY: 0.62,
    aisle: (li, lj) => ((li + lj) % 2 ? "#D8B48A" : "#CFA97E"),
    sleeper: (b, i, j, k) => { b.mat(i, j, ["#E07A5F", "#6C8EBF", "#F2CC8F", "#3F6E5A"][k % 4], "#F8FAFC"); b.sleep(i, j, DOWN, "mat", 0.06); },
    spare: huddleOrLounge({ table: "#A47148", stool: "#E07A5F", rug: "#F2CC8F", chair: "#D97706", chairBack: "#B45309", lamp: "#FFD38A" }),
    amenities: [terrace, dorm("dist_bedrooms", HOME, { floor: (li, lj) => ((li + lj) % 4 < 2 ? "#C99A6B" : "#B98A5C"), locker: "#A47148", rug: "#F2CC8F",
      bed: (b, i, j, k) => { b.bed(i, j, ["#7C3AED", "#E07A5F", "#3F6E5A", "#6C8EBF"][k % 4], "#8B5E3C"); b.sleep(i, j, DOWN, "bed", 0.5); },
      couch: ["#6C8EBF", "#5878A8"], lamp: "#FFD38A" }), workshop, living],
    yard: {
      label: "dist_vegpatch",
      floor: (li, lj) => (li === 6 ? "#C9A36B" : (li * 3 + lj) % 5 ? "#6DBE45" : "#62B03E"),
      build: (x) => {
        const { b, I, J } = x;
        for (const [li, lj] of [[2, 3], [8, 3], [2, 9], [8, 9]] as [number, number][]) flowerBed(b, I(li), J(lj), 3, 3, ["#16A34A", "#EF4444", "#F59E0B", "#22C55E"], "#5B3A1F");
        b.tree(I(10), J(14), 3); bench(b, I(3), J(15));
        breakSpot(b, I(7), J(14)); b.box(tx(I(7)), 0.4, tz(J(14)), 0.7, 0.8, 0.6, "#B07D48"); b.box(tx(I(7)), 0.9, tz(J(14)), 0.3, 0.3, 0.3, "#FDE68A"); b.block(I(7), J(14));
        // S46 (DIST-DENSITY-001): fide saksıları, sulama kovaları, kompost kasaları (yol sütunu hariç; engellemez)
        scatter(b, x.i0, x.j0, 22, 9 + x.variant, (px, pz, k) => {
          if (k % 3 === 0) { b.box(px, 0.14, pz, 0.34, 0.28, 0.34, "#B45309", "solid", 0.05); b.box(px, 0.33, pz, 0.26, 0.12, 0.26, "#22C55E"); }
          else if (k % 3 === 1) b.box(px, 0.12, pz, 0.24, 0.24, 0.24, ["#60A5FA", "#9CA3AF"][k % 2], "solid", 0.04);
          else b.box(px, 0.16, pz, 0.3, 0.32, 0.3, "#16A34A", "solid", 0.08);
        }, (li, lj) => li === 6 || anchorAt(b, I(li), J(lj)));
        x.sign = [tx(I(6)), 1.6, tz(J(2))];
      },
    },
    row0: (x) => {
      const { b, I, J } = x;
      fenceX(b, J(0), I(0), I(11), [], { c: "#B7C9A8", h: 4, t: 1 });
      b.box((tx(I(0)) + tx(I(11))) / 2, 3.6, tz(J(0)) + 0.505, 12, 0.8, 0.02, "#F3E9DC");
      for (const li of [3, 8]) b.box(tx(I(li)) + 0.5, 2.0, tz(J(0)) + 0.51, 1.6, 1.2, 0.04, "#A8D8F0", "glass");
    },
  };
}

// ------------------------------------------------------------------ kafe
const CAFE: IndoorStyle = {
  wall: "#B5543C", base: "#5B3A29", h: 2.4, shelf: "#5B3A29", books: ["#F2CC8F", "#B45309", "#FDE68A", "#7C2D12"],
  side: { c: "#5B3A29", h: 0.95, t: 0.2, cap: "#8B5E3C" },
  front: (b, i, j) => planter(b, i, j, "#7C2D12", "#3E8E3E"),
};
function cafeTheme(): Theme {
  const seat = (b: Builder, i: number, j: number, face: "+z" | "-z") => {
    const { user, dz } = seatSide(j, face);
    const x = tx(i) + 0.5, z = tz(j);
    b.box(x, 0.36, z, 0.16, 0.72, 0.16, "#3F3F46");
    b.box(x, 0.74, z, 1.9, 0.08, 0.85, "#8B5E3C", "solid", 0.03);
    b.block(i, j); b.block(i + 1, j);
    b.laptop(tx(i), 0.78, z, user);
    b.box(tx(i + 1), 0.86, z - dz * 0.1, 0.14, 0.16, 0.14, "#FFFFFF");
    b.box(tx(i + 1) + 0.25, 0.83, z + dz * 0.15, 0.3, 0.06, 0.2, ["#F59E0B", "#FCA5A5", "#FDE68A"][(i + j) % 3]);
  };
  const terrace: Amenity = {
    label: "dist_cafe_terrace",
    floor: (li, lj) => ((li * 2 + lj) % 3 ? "#D6C3A8" : "#CDB898"),
    build: (x) => {
      const { b, I, J } = x;
      fenceX(b, J(1), I(1), I(11), [I(6)], { c: "#3F3F46", h: 0.9, t: 0.1, cap: "#5B3A29", block: true });
      fenceZ(b, I(1), J(2), J(15), [2, 7, 12].map(J), { c: "#3F3F46", h: 0.9, t: 0.1, cap: "#5B3A29" });
      for (const [li, lj, c] of [[3, 4, "#B5543C"], [8, 4, "#3F6E5A"], [3, 9, "#F2B33D"], [8, 9, "#B5543C"]] as [number, number, string][]) parasolTable(b, I(li), J(lj), c, "#FFF7E0");
      for (let li = 2; li <= 10; li += 2) b.box(tx(I(li)), 2.6, tz(J(7)), 0.16, 0.16, 0.16, "#FFE3A3", "glow");
      b.box((tx(I(2)) + tx(I(10))) / 2, 2.68, tz(J(7)), 8.6, 0.02, 0.02, "#1F2937");
      // REAL-SUPPORT: ışık teli iki ucunda direğe bağlı (direkler koridor kenarında; eskiden tel havada asılıydı)
      for (const ex of [tx(I(2)) - 0.3, tx(I(10)) + 0.3]) {
        b.box(ex, 1.35, tz(J(7)) + 0.46, 0.08, 2.7, 0.08, "#1F2937");
        b.box(ex, 2.68, tz(J(7)) + 0.23, 0.02, 0.02, 0.5, "#1F2937");
      }
      b.coffeeMachine(I(10), J(13), "+z");
      for (const li of [2, 3, 4]) planter(b, I(li), J(14), "#7C2D12");
      bench(b, I(6), J(15), "#8B5E3C", "#3F3F46");
      b.spot("plan", I(4), J(4), LEFT);
      x.sign = [tx(I(6)), 1.6, tz(J(1))];
    },
  };
  const roastery: Amenity = {
    label: "dist_roastery",
    floor: (li, lj) => ((li + lj) % 2 ? "#6E5140" : "#7A5A44"),
    build: (x) => {
      const { b, I, J } = x;
      indoorBack(x, CAFE, { shelves: false, board: true, signColor: "#5B3A29" });
      indoorSides(x, { ...CAFE, front: undefined });
      // kavurma makinesi: tambur + baca + soğutma tepsisi
      const rx = (tx(I(3)) + tx(I(4))) / 2, rz = (tz(J(4)) + tz(J(5))) / 2;
      b.box(rx, 0.5, rz, 1.6, 1.0, 1.4, "#374151", "solid", 0.03);
      b.box(rx, 1.3, rz, 1.0, 0.8, 1.0, "#B45309", "solid", 0.03);
      b.box(rx, 2.3, rz, 0.3, 1.4, 0.3, "#6B7280");
      b.box(rx + 0.85, 0.55, rz + 0.5, 0.9, 0.1, 0.9, "#9CA3AF"); b.box(rx + 0.85, 0.62, rz + 0.5, 0.7, 0.06, 0.7, "#7C2D12");
      b.box(rx - 0.5, 1.0, rz + 0.71, 0.2, 0.2, 0.02, "#F97316", "glow");
      for (const li of [3, 4]) for (const lj of [4, 5]) b.block(I(li), J(lj));
      b.spot("shell", I(5), J(4), LEFT);
      // çuvallar
      for (const [li, lj] of [[9, 3], [10, 3], [9, 4], [10, 5]] as [number, number][]) {
        b.box(tx(I(li)), 0.3, tz(J(lj)), 0.8, 0.6, 0.7, "#C8A165", "solid", 0.06); b.box(tx(I(li)), 0.62, tz(J(lj)), 0.5, 0.1, 0.4, "#A47148"); b.block(I(li), J(lj));
      }
      counter(b, I(3), I(9), J(9), "#5B3A29", "#2F2F2F");
      b.coffeeMachine(I(5), J(9), "+z", true); b.coffeeMachine(I(8), J(9), "+z", true);
      for (const li of [3, 9]) cafeTable(b, I(li), J(12), "#8B5E3C", "#B45309");
      couch(b, I(5), J(15), "#7C2D12", "#6B260F");
      // S41: tadım halısı, çuval yığınları, bitkiler
      rug(b, I(2), J(11), 9, 3, "#C9A27E"); rug(b, I(6), J(3), 3, 4, "#5B3A29");
      for (const [li, lj] of [[2, 6], [10, 7], [2, 14]] as [number, number][]) { b.box(tx(I(li)), 0.3, tz(J(lj)), 0.8, 0.6, 0.7, "#C8A165", "solid", 0.06); b.block(I(li), J(lj)); }
      planter(b, I(5), J(12), "#7C2D12"); planter(b, I(7), J(12), "#7C2D12");
    },
  };
  const bookshop: Amenity = {
    label: "dist_bookshop",
    floor: chk("#E8DCC8", "#DCCDB5"),
    build: (x) => {
      const { b, I, J } = x;
      fenceX(b, J(1), I(1), I(11), [2, 3, 4, 5, 7, 8, 9, 10].map(I), { c: CAFE.wall, h: 2.4, t: 1 });
      for (const li of [2, 3, 4, 5, 7, 8, 9, 10]) bookshelf(b, I(li), J(1), "#5B3A29", 2.2, "+z", CAFE.books);
      b.box(tx(I(6)), 2.1, tz(J(1)), 1, 0.6, 1, CAFE.wall);
      for (const li of [3, 4, 8, 9]) b.spot("read", I(li), J(2), DOWN);
      x.sign = [tx(I(6)), 2.95, tz(J(1)) + 0.6];
      indoorSides(x, { ...CAFE, front: undefined });
      for (const li of [3, 4, 8, 9]) bookshelf(b, I(li), J(6), "#8B5E3C", 1.3, "+z", CAFE.books);
      b.spot("read", I(5), J(7), LEFT);
      for (const li of [3, 9]) armchair(b, I(li), J(11), "#B45309", "#7C2D12");
      b.lamp(I(4), J(11), "#FFC56B"); b.lamp(I(8), J(11), "#FFC56B");
      b.coffeeMachine(I(10), J(14), "+z");
      couch(b, I(4), J(15), "#7C2D12", "#6B260F");
      // S41: okuma masaları, halılar, kitap yığınları
      rug(b, I(2), J(8), 9, 2, "#C9A27E"); rug(b, I(2), J(12), 9, 2, "#7C2D12");
      for (const li of [3, 9]) readingTable(b, I(li), J(9), "#8B5E3C", "#B45309");
      for (const [li, lj] of [[2, 13], [10, 12]] as [number, number][]) { for (let k = 0; k < 3; k++) b.box(tx(I(li)), 0.08 + k * 0.12, tz(J(lj)), 0.5 - k * 0.06, 0.1, 0.36, CAFE.books![k]); b.block(I(li), J(lj)); }
      // S46 (DIST-DENSITY-001): yerde kitap yığınları ve minderler (yürünebilir; koridor li 6 ve lj 7 hariç)
      scatter(b, x.i0, x.j0, 14, 3 + x.variant, (px, pz, k) => {
        if (k % 2) b.box(px, 0.06, pz, 0.6, 0.12, 0.6, ["#C9A27E", "#B45309"][k % 4 === 1 ? 0 : 1], "solid", 0.04);
        else for (let h = 0; h < 2; h++) b.box(px, 0.06 + h * 0.11, pz, 0.36 - h * 0.05, 0.1, 0.26, CAFE.books![(k + h) % 4]);
      }, (li, lj) => li === 6 || lj === 7 || lj <= 2 || anchorAt(b, I(li), J(lj)));
    },
  };
  return {
    hq: "dist_cafe_hq", trim: "#B5543C", under: "#5B4636",
    path: (li, lj) => ((li + lj) % 2 ? "#7A5A44" : "#6E5140"),
    floor: chk("#EADBC8", "#5A4434"),
    work: indoorWork(CAFE, (b, i, j) => couch(b, i, j, "#7C2D12", "#6B260F")),
    seat: (b, i, j, face) => seat(b, i, j, face), pose: "sit_chair", device: "laptop",
    aisle: (li, lj) => ((li + lj) % 2 ? "#C9A27E" : "#BC946F"),
    sleeper: (b, i, j, k) => { b.daybed(i, j, k % 2 ? "#B45309" : "#9A3412", "#6B260F", "-z"); b.sleep(i, j, DOWN, "sofa", 0.36); },
    spare: huddleOrLounge({ table: "#8B5E3C", stool: "#B45309", rug: "#C9A27E", chair: "#7C2D12", chairBack: "#6B260F", lamp: "#FFC56B" }),
    amenities: [terrace, dorm("dist_backroom", CAFE, { floor: chk("#6E5140", "#7A5A44"), locker: "#5B3A29", rug: "#C9A27E",
      bed: (b, i, j, k) => { b.daybed(i, j, ["#B45309", "#9A3412", "#C2410C"][k % 3], "#6B260F", "-z"); b.sleep(i, j, DOWN, "sofa", 0.36); },
      couch: ["#7C2D12", "#6B260F"], lamp: "#FFC56B" }), roastery, bookshop],
    yard: atrium("dist_courtyard", ["#6DBE45", "#62B03E"], "#C9A27E", (x) => {
      const { b, I, J } = x;
      breakSpot(b, I(10), J(13)); b.box(tx(I(10)), 0.5, tz(J(13)), 0.9, 1.0, 0.8, "#B5543C", "solid", 0.03);
      b.box(tx(I(10)), 1.6, tz(J(13)), 1.1, 0.1, 1.1, "#FFF7E0"); b.box(tx(I(10)), 1.05, tz(J(13)), 0.06, 1.1, 0.06, "#5B3A29"); b.block(I(10), J(13));
    }),
    row0: (x) => {
      const { b, I, J } = x;
      fenceX(b, J(0), I(0), I(11), [], { c: "#B5543C", h: 4, t: 1 });
      for (let li = 0; li < 12; li += 3) b.box(tx(I(li)) + 1, 2.2, tz(J(0)) + 0.51, 1.4, 1.2, 0.04, "#FFE3A3", "glass");
    },
  };
}

// ------------------------------------------------------------------ uzay üssü
const SPACE: IndoorStyle = {
  wall: "#334155", base: "#5EEAD4", h: 2.4, shelf: "#1F2937", books: ["#5EEAD4", "#C084FC", "#FDE68A", "#60A5FA"],
  side: { c: "#BFE3F5", h: 1.4, t: 0.08, g: "glass", cap: "#5EEAD4" },
  glass: "#7DD3FC",
};
function spaceTheme(): Theme {
  const seat = (b: Builder, i: number, j: number, face: "+z" | "-z") => {
    const { dz } = seatSide(j, face);
    b.desk(i, j, 2, "#64748B", "#94A3B8", true);
    b.box(tx(i) + 0.5, 0.7, tz(j) + dz * 0.46, 1.9, 0.04, 0.03, "#5EEAD4", "glow");
    b.monitor(i, j, face === "-z" ? "+z" : "-z", 0, -dz * 0.14);
  };
  const dome = (x: Bay, li0: number, lj0: number, w: number, d: number, c: string) => {
    const cx = (tx(x.I(li0)) + tx(x.I(li0 + w - 1))) / 2, cz = (tz(x.J(lj0)) + tz(x.J(lj0 + d - 1))) / 2;
    [[w, 0.9, 0.45], [w - 1, 0.8, 1.3], [w - 2.4, 0.6, 2.0]].forEach(([ww, h, y]) => x.b.box(cx, y, cz, ww, h, d - (w - ww), c, "glass"));
  };
  const greenhouse: Amenity = {
    label: "dist_greenhouse",
    floor: (li, lj) => (li >= 2 && li <= 10 && lj >= 3 && lj <= 9 ? ((li + lj) % 2 ? "#3F6E4A" : "#477A53") : (li + lj) % 2 ? "#3C4561" : "#46506E"),
    build: (x) => {
      const { b, I, J } = x;
      indoorBack(x, SPACE, { shelves: false, board: false, door: false, signColor: "#22C55E" });
      indoorSides(x, SPACE);
      for (let li = 3; li <= 9; li += 2) for (const lj of [4, 7]) {
        b.box(tx(I(li)), 0.3, tz(J(lj)), 0.8, 0.6, 1.8, "#E2E8F0", "solid", 0.02);
        b.box(tx(I(li)), 0.75, tz(J(lj)), 0.7, 0.4, 1.7, "#22C55E", "solid", 0.12);
        b.box(tx(I(li)), 1.35, tz(J(lj)), 0.5, 0.05, 1.5, "#E879F9", "glow");
        b.block(I(li), J(lj)); b.block(I(li), J(lj + 1));
      }
      dome(x, 2, 3, 9, 7, "#BFE3F5");
      b.spot("read", I(4), J(4), LEFT); b.spot("read", I(8), J(7), LEFT);
      b.coffeeMachine(I(10), J(13), "+z");
      for (const li of [3, 4, 5]) { b.box(tx(I(li)), 0.25, tz(J(15)), 0.9, 0.5, 0.95, "#E2E8F0", "solid", 0.02); b.box(tx(I(li)), 0.6, tz(J(15)), 0.8, 0.3, 0.85, "#BFE3F5", "glass"); b.block(I(li), J(15)); b.rest.push([I(li), J(14)]); }
    },
  };
  const mess: Amenity = {
    label: "dist_messhall",
    floor: chk("#4A5066", "#555C74"),
    build: (x) => {
      const { b, I, J } = x;
      indoorBack(x, SPACE, { shelves: false, board: true, window: true, signColor: "#F2B33D" });
      indoorSides(x, SPACE);
      counter(b, I(2), I(5), J(2), "#475569", "#94A3B8");
      b.coffeeMachine(I(3), J(2), "+z", true);
      for (const lj of [6, 10]) {
        b.box((tx(I(3)) + tx(I(9))) / 2, 0.72, tz(J(lj)), 7, 0.08, 0.9, "#CBD5E1", "solid", 0.02);
        b.box((tx(I(3)) + tx(I(9))) / 2, 0.69, tz(J(lj)) + 0.46, 7, 0.03, 0.03, "#5EEAD4", "glow");
        for (const dx of [-3.3, 0, 3.3]) b.box((tx(I(3)) + tx(I(9))) / 2 + dx, 0.34, tz(J(lj)), 0.12, 0.68, 0.7, "#475569"); // REAL-SUPPORT: masa ayaklı
        for (let li = 3; li <= 9; li++) b.block(I(li), J(lj));
      }
      for (const li of [4, 7]) { b.spot("plan", I(li), J(5), UP); }
      floorLights(x, 18, 3); rug(b, I(2), J(8), 9, 1, "#5A6690");
      // S45 (CORE-ACCESS-001): saksı (10,2)'deki plan noktasını kapatıyordu → (10,4)
      for (const [li, lj] of [[10, 4], [2, 12], [10, 12]] as [number, number][]) { b.box(tx(I(li)), 0.3, tz(J(lj)), 0.7, 0.6, 0.7, "#E2E8F0", "solid", 0.02); b.box(tx(I(li)), 0.75, tz(J(lj)), 0.6, 0.4, 0.6, "#22C55E", "solid", 0.12); b.block(I(li), J(lj)); }
      for (const li of [3, 4, 5]) { b.box(tx(I(li)), 0.25, tz(J(14)), 0.9, 0.5, 0.95, "#E2E8F0", "solid", 0.02); b.box(tx(I(li)), 0.6, tz(J(14)), 0.8, 0.3, 0.85, "#BFE3F5", "glass"); b.block(I(li), J(14)); b.rest.push([I(li), J(13)]); }
    },
  };
  const pad: Amenity = {
    label: "dist_launchpad",
    floor: (li, lj) => (Math.hypot(li - 6, lj - 7) < 3.6 ? ((li + lj) % 2 ? "#4A5066" : "#555C74") : (li + lj) % 2 ? "#3C4561" : "#46506E"),
    build: (x) => {
      const { b, I, J } = x;
      const cx = tx(I(6)), cz = tz(J(7));
      for (let a = 0; a < 14; a++) b.box(cx + Math.cos(a * 0.449) * 3, 0.012, cz + Math.sin(a * 0.449) * 3, 0.32, 0.02, 0.32, "#F2B33D", "glow");
      // gezgin (rover) ve küçük roket
      b.box(cx - 1, 0.45, cz, 1.6, 0.5, 1.0, "#E2E8F0", "solid", 0.02); b.box(cx - 1, 0.9, cz - 0.2, 0.6, 0.4, 0.5, "#94A3B8");
      for (const dx of [-0.6, 0.6]) for (const dz of [-0.5, 0.5]) b.box(cx - 1 + dx, 0.2, cz + dz, 0.3, 0.4, 0.2, "#1F2937");
      b.box(cx - 0.75, 1.35, cz - 0.2, 0.08, 0.5, 0.08, "#94A3B8"); b.box(cx - 0.75, 1.62, cz - 0.2, 0.5, 0.05, 0.5, "#E2E8F0"); // REAL-SUPPORT: anten kabine oturur
      b.box(cx + 1.5, 1.6, cz, 0.8, 3.2, 0.8, "#F1F5F9", "solid", 0.02); b.box(cx + 1.5, 3.5, cz, 0.5, 0.6, 0.5, "#E5584E");
      b.box(cx + 1.5, 2.2, cz + 0.41, 0.3, 0.3, 0.02, "#7DD3FC", "glow");
      for (const li of [5, 6, 7]) for (const lj of [6, 7, 8]) b.block(I(li), J(lj));
      b.terminal(I(2), J(3), "+z"); b.spot("shell", I(2), J(4), DOWN);
      b.terminal(I(10), J(3), "+z"); b.spot("web", I(10), J(4), DOWN);
      b.coffeeMachine(I(2), J(13), "+z");
      floorLights(x, 40, 6, "#F2B33D");
      for (const [li, lj] of [[3, 10], [4, 11], [9, 3], [10, 10]] as [number, number][]) { b.crate(tx(I(li)), 0, tz(J(lj)), 0.8, (li + lj) % 2 ? "#64748B" : "#475569"); b.block(I(li), J(lj)); }
      for (const li of [8, 9, 10]) { b.box(tx(I(li)), 0.25, tz(J(14)), 0.9, 0.5, 0.95, "#E2E8F0", "solid", 0.02); b.box(tx(I(li)), 0.6, tz(J(14)), 0.8, 0.3, 0.85, "#BFE3F5", "glass"); b.block(I(li), J(14)); b.rest.push([I(li), J(13)]); }
      x.sign = [cx, 1.2, tz(J(3))];
    },
  };
  return {
    hq: "dist_station", trim: "#5EEAD4", under: "#1B1F2E",
    path: (li, lj) => (li === 0 || lj === 0 ? "#5A6690" : "#535F86"),
    floor: chk("#3C4561", "#46506E"),
    work: indoorWork(SPACE, (b, i, j) => {
      for (let k = 0; k < 3; k++) {
        b.box(tx(i + k), 0.25, tz(j), 0.9, 0.5, 0.95, "#E2E8F0", "solid", 0.02);
        b.box(tx(i + k), 0.6, tz(j), 0.8, 0.3, 0.85, "#BFE3F5", "glass");
        b.box(tx(i + k), 0.52, tz(j) - 0.48, 0.6, 0.05, 0.02, "#93C5FD", "glow");
        b.block(i + k, j); b.rest.push([i + k, j - 1]);
      }
    }),
    seat: (b, i, j, face) => seat(b, i, j, face), pose: "sit_chair", device: "console",
    aisle: (_li, lj) => (lj % 2 ? "#535F86" : "#5A6690"),
    sleeper: (b, i, j, k) => { b.napPod(i, j, "#CBD5E1", k % 2 ? "#5EEAD4" : "#C084FC", "#5EEAD4"); b.sleep(i, j, DOWN, "bunk", 0.34); },
    spare: (x, pi, pj, slot) => {
      const { b } = x;
      const i = x.I(pi), j = x.J(pj);
      if (slot % 2 === 0) {
        // holo masa (plan)
        const cx = (tx(i + 1) + tx(i + 2)) / 2, cz = (tz(j + 1) + tz(j + 2)) / 2;
        b.box(cx, 0.4, cz, 1.8, 0.8, 1.8, "#334155", "solid", 0.03);
        b.box(cx, 0.82, cz, 1.6, 0.04, 1.6, "#5EEAD4", "glow");
        b.box(cx, 0.97, cz, 0.08, 0.28, 0.08, "#5EEAD4", "glow"); // REAL-SUPPORT: hologram ışını masadan yükselir
        b.box(cx, 1.4, cz, 0.6, 0.6, 0.6, "#5EEAD4", "glass");
        for (const di of [1, 2]) for (const dj of [1, 2]) b.block(i + di, j + dj);
        b.spot("plan", i + 1, j, UP); b.spot("plan", i + 2, j + 3, DOWN);
      } else {
        for (const [di, dj] of [[0, 0], [3, 0], [0, 3], [3, 3]] as [number, number][]) {
          b.box(tx(i + di), 0.3, tz(j + dj), 0.7, 0.6, 0.7, "#E2E8F0", "solid", 0.02);
          b.box(tx(i + di), 0.75, tz(j + dj), 0.6, 0.4, 0.6, "#22C55E", "solid", 0.12);
          b.box(tx(i + di), 1.1, tz(j + dj), 0.05, 0.3, 0.05, "#94A3B8"); // REAL-SUPPORT: büyütme lambası çubukta
          b.box(tx(i + di), 1.25, tz(j + dj), 0.5, 0.05, 0.5, "#E879F9", "glow");
          b.block(i + di, j + dj);
        }
        rug(b, i + 1, j + 1, 2, 2, "#5A6690");
      }
    },
    amenities: [greenhouse, dorm("dist_crewquarters", SPACE, { floor: chk("#3C4561", "#46506E"), locker: "#64748B", rug: "#5A6690",
      bed: (b, i, j, k) => { b.napPod(i, j, "#CBD5E1", k % 2 ? "#5EEAD4" : "#C084FC", "#5EEAD4"); b.sleep(i, j, DOWN, "bunk", 0.34); },
      couch: ["#475569", "#334155"], lamp: "#5EEAD4" }), mess, pad],
    yard: {
      label: "dist_cargo",
      floor: (li, lj) => ((li + lj) % 2 ? "#3C4561" : "#46506E"),
      build: (x) => {
        const { b, I, J } = x;
        for (const [li, lj] of [[3, 3], [4, 3], [3, 4], [8, 4], [9, 4], [8, 10], [3, 10], [4, 11]] as [number, number][]) {
          b.crate(tx(I(li)), 0, tz(J(lj)), 0.85, (li + lj) % 2 ? "#64748B" : "#475569"); b.block(I(li), J(lj));
        }
        b.box(tx(I(6)), 0.012, tz(J(8)), 0.4, 0.02, 14, "#F2B33D", "glow");
        // S41: istif rafları, yük arabası, zemin ışıkları
        for (const li of [9, 10]) for (const lj of [12, 13]) { b.crate(tx(I(li)), 0, tz(J(lj)), 0.85, "#64748B"); b.crate(tx(I(li)), 0.85, tz(J(lj)), 0.7, "#475569"); b.block(I(li), J(lj)); }
        for (const lj of [6, 7]) { b.box(tx(I(2)), 1.0, tz(J(lj)), 0.8, 2.0, 0.9, "#334155", "solid", 0.03); b.block(I(2), J(lj)); }
        b.box(tx(I(4)), 0.35, tz(J(14)), 0.9, 0.4, 1.4, "#F2B33D", "solid", 0.03); b.box(tx(I(4)), 0.9, tz(J(14)) - 0.5, 0.7, 0.8, 0.1, "#1F2937"); b.block(I(4), J(14));
        for (const dx of [-0.35, 0.35]) for (const dz of [-0.5, 0.5]) b.box(tx(I(4)) + dx, 0.15, tz(J(14)) + dz, 0.12, 0.3, 0.24, "#1F2937"); // REAL-SUPPORT: yük arabası tekerlekli
        floorLights(x, 44, 8);
        x.sign = [tx(I(6)), 1.4, tz(J(3))];
      },
    },
  };
}

// ------------------------------------------------------------------ karlı köy: kütük kulübeler
const CABIN: IndoorStyle = {
  wall: "#7A4E25", base: "#5D3A1A", h: 2.2, shelf: "#5D3A1A", books: ["#2F7FC4", "#C2410C", "#F2CC8F", "#15803D"],
  side: { c: "#8B5A2B", h: 0.9, t: 0.24, cap: "#F8FAFC" },
  front: (b, i, j) => { b.box(tx(i), 0.3, tz(j), 0.9, 0.6, 0.9, "#F4F7FB", "solid", 0.03); b.block(i, j); },
  glass: "#FFE3A3",
};
function snowTheme(): Theme {
  /** S41 — kulübe içi: kalın ahşap masa + kütük bank (ajan bankta, dizüstü masada), masada mum ve kupa. */
  const seat = (b: Builder, i: number, j: number, face: "+z" | "-z") => {
    const { user, dz, agentJ } = seatSide(j, face);
    const x = tx(i) + 0.5, z = tz(j);
    b.box(x, 0.72, z, 2, 0.12, 0.86, "#8B5A2B", "solid", 0.04);
    for (const dx of [-0.8, 0.8]) b.box(x + dx, 0.33, z, 0.16, 0.66, 0.6, "#5D3A1A");
    b.block(i, j); b.block(i + 1, j);
    b.laptop(tx(i), 0.78, z, user);
    b.box(tx(i + 1), 0.86, z - dz * 0.1, 0.12, 0.18, 0.12, "#F8FAFC");
    b.box(tx(i + 1), 1.0, z - dz * 0.1, 0.05, 0.1, 0.05, "#FFD27A", "glow");
    b.box(tx(i + 1) + 0.3, 0.84, z + dz * 0.15, 0.14, 0.14, 0.14, "#C2410C");
    b.box(tx(i) + 0.5, 0.22, tz(agentJ) + dz * 0.1, 1.9, 0.4, 0.4, "#7A4E2A", "solid", 0.05);
    seatMark(b, i, agentJ, face);
  };
  const snowFloor = (li: number, lj: number) => ((li * 5 + lj * 7) % 9 === 0 ? "#E4ECF5" : (li + lj) % 2 ? "#F4F7FB" : "#EDF2F8");
  const skating: Amenity = {
    label: "dist_skating",
    floor: (li, lj) => (li >= 3 && li <= 9 && lj >= 3 && lj <= 9 ? ((li + lj) % 2 ? "#BFE6F5" : "#B3DDF0") : snowFloor(li, lj)),
    build: (x) => {
      const { b, I, J } = x;
      for (let li = 3; li <= 9; li++) for (let lj = 3; lj <= 9; lj++) {
        if ((li + lj) % 3 === 0) b.box(tx(I(li)) + 0.2, 0.01, tz(J(lj)) - 0.2, 0.3, 0.02, 0.06, "#FFFFFF", "glow");
      }
      fenceX(b, J(2), I(2), I(10), [I(6)], { c: "#8B5A2B", h: 0.5, t: 0.12, cap: "#F8FAFC", block: false });
      fenceX(b, J(10), I(2), I(10), [I(6)], { c: "#8B5A2B", h: 0.5, t: 0.12, cap: "#F8FAFC", block: false });
      for (const [li, lj] of [[2, 12], [10, 12]] as [number, number][]) {
        b.box(tx(I(li)), 0.35, tz(J(lj)), 0.8, 0.7, 0.8, "#FFFFFF", "solid", 0.02); b.box(tx(I(li)), 0.95, tz(J(lj)), 0.55, 0.5, 0.55, "#FFFFFF", "solid", 0.02);
        b.box(tx(I(li)), 1.35, tz(J(lj)), 0.4, 0.35, 0.4, "#FFFFFF"); b.box(tx(I(li)), 1.38, tz(J(lj)) + 0.22, 0.08, 0.06, 0.16, "#F97316"); b.block(I(li), J(lj));
      }
      bench(b, I(4), J(13), "#8B5A2B"); bench(b, I(7), J(13), "#8B5A2B");
      b.spot("web", I(6), J(11), DOWN);
      x.sign = [tx(I(6)), 1.4, tz(J(2))];
      breakSpot(b, I(10), J(14)); b.box(tx(I(10)), 0.45, tz(J(14)), 0.9, 0.9, 0.8, "#C2410C", "solid", 0.03); b.box(tx(I(10)), 1.0, tz(J(14)), 0.4, 0.2, 0.4, "#F8FAFC"); b.block(I(10), J(14));
    },
  };
  const cocoa: Amenity = {
    label: "dist_cocoa",
    floor: snowFloor,
    build: (x) => {
      const { b, I, J } = x;
      indoorBack(x, CABIN, { shelves: true, board: false, window: true, signColor: "#C2410C" });
      fenceZ(b, I(1), J(2), J(6), [J(2)], { c: CABIN.wall, h: 2.2, t: 1 });
      fenceZ(b, I(11), J(2), J(6), [], { c: CABIN.wall, h: 2.2, t: 1 });
      rug(b, I(2), J(2), 9, 5, "#A47148");
      counter(b, I(3), I(9), J(5), "#8B5A2B", "#F8FAFC");
      b.coffeeMachine(I(5), J(5), "+z", true); b.coffeeMachine(I(8), J(5), "+z", true);
      for (const li of [3, 9]) cafeTable(b, I(li), J(9), "#A47148", "#C2410C");
      // ateş çukuru + kütükler
      const fx = tx(I(6)), fz = tz(J(12));
      for (let a = 0; a < 8; a++) b.box(fx + Math.cos(a * 0.785) * 0.55, 0.1, fz + Math.sin(a * 0.785) * 0.55, 0.25, 0.2, 0.25, "#78716C");
      b.box(fx, 0.08, fz, 0.5, 0.16, 0.5, "#5D3A1A"); // REAL-SUPPORT: alev kütük tabanda (eskiden 0,17 havada)
      b.box(fx, 0.4, fz, 0.4, 0.45, 0.4, "#FF7A1A", "flame"); b.box(fx, 0.72, fz, 0.24, 0.3, 0.24, "#FFD34D", "flame"); b.block(I(6), J(12));
      bench(b, I(3), J(14), "#7A4E2A"); bench(b, I(8), J(14), "#7A4E2A");
      b.spot("plan", I(5), J(12), RIGHT);
    },
  };
  const sled: Amenity = {
    label: "dist_sledhill",
    floor: snowFloor,
    build: (x) => {
      const { b, I, J } = x;
      [[7, 0.6, 0], [5, 0.6, 0.6], [3, 0.6, 1.2]].forEach(([w, h, y], k) =>
        b.box(tx(I(6)), y + h / 2, (tz(J(3)) + tz(J(6))) / 2 - k * 0.3, w, h, 4 - k, "#FFFFFF", "solid", 0.02));
      for (let li = 3; li <= 9; li++) for (let lj = 3; lj <= 6; lj++) b.block(I(li), J(lj));
      for (const [li, c] of [[4, "#EF4444"], [8, "#2F7FC4"]] as [number, string][]) {
        b.box(tx(I(li)), 0.12, tz(J(8)), 0.6, 0.08, 1.2, c); b.box(tx(I(li)), 0.06, tz(J(8)) - 0.6, 0.6, 0.12, 0.08, "#94A3B8");
      }
      for (const [li, lj] of [[2, 10], [10, 10], [2, 14], [10, 14]] as [number, number][]) b.snowyPine(I(li), J(lj));
      bench(b, I(5), J(13), "#8B5A2B");
      breakSpot(b, I(7), J(10)); b.box(tx(I(7)), 0.45, tz(J(10)), 0.9, 0.9, 0.8, "#8B5A2B", "solid", 0.03); b.box(tx(I(7)), 1.0, tz(J(10)), 0.3, 0.3, 0.3, "#FDE68A"); b.block(I(7), J(10));
      b.spot("web", I(6), J(8), DOWN);
      x.sign = [tx(I(6)), 2.6, tz(J(4))];
    },
  };
  return {
    hq: "dist_village", trim: "#2F7FC4", under: "#A8B4C4",
    path: (li, lj) => ((li + lj) % 2 ? "#D9CBB4" : "#CFC0A8"),
    floor: chk("#A47148", "#996A42"),
    work: (x) => {
      indoorBack(x, CABIN, { signColor: x.color });
      // kar kapağı arka duvarın üstünde
      x.b.box((tx(x.I(1)) + tx(x.I(11))) / 2, CABIN.h + 0.08, tz(x.J(1)), 11.2, 0.16, 1.2, "#F8FAFC");
      indoorSides(x, { ...CABIN, front: undefined });
      teamCorner(x, (b, i, j) => couch(b, i, j, "#C2410C", "#9A3412"));
    },
    seat: (b, i, j, face) => seat(b, i, j, face), pose: "sit_chair", device: "laptop", seatY: 0.42,
    aisle: (li, lj) => ((li + lj) % 2 ? "#B5835A" : "#A87A52"),
    sleeper: (b, i, j, k) => { b.cot(i, j, k % 2 ? "#C2410C" : "#2F7FC4", "#F8FAFC", "#5D3A1A"); b.sleep(i, j, DOWN, "cot", 0.36); },
    spare: (x, pi, pj, slot) => {
      const { b } = x;
      const i = x.I(pi), j = x.J(pj);
      rug(b, i, j, 4, 4, slot % 2 ? "#2F7FC4" : "#C2410C");
      if (slot % 2 === 0) {
        // soba + berjerler
        b.box(tx(i + 1), 0.45, tz(j + 1), 0.8, 0.9, 0.8, "#1F2937", "solid", 0.02); b.box(tx(i + 1), 0.4, tz(j + 1) + 0.41, 0.4, 0.3, 0.02, "#FF7A1A", "flame");
        b.box(tx(i + 1), 1.8, tz(j + 1), 0.2, 1.8, 0.2, "#374151"); b.block(i + 1, j + 1);
        armchair(b, i + 2, j + 3, "#C2410C", "#9A3412"); armchair(b, i + 1, j + 3, "#C2410C", "#9A3412");
        b.spot("plan", i + 2, j + 1, LEFT);
      } else {
        for (let k = 0; k < 3; k++) { b.box(tx(i + k), 0.9, tz(j + 3) + 0.3, 0.08, 1.8, 0.08, ["#EF4444", "#2F7FC4", "#F2B33D"][k]); b.box(tx(i + k), 0.05, tz(j + 3) + 0.1, 0.18, 0.1, 0.4, "#1F2937"); }
        b.box((tx(i) + tx(i + 2)) / 2, 0.9, tz(j + 3) + 0.4, 3, 0.1, 0.1, "#8B5A2B");
        for (let k = 0; k < 3; k++) b.block(i + k, j + 3);
        bench(b, i + 1, j + 1, "#8B5A2B");
      }
    },
    amenities: [skating, dorm("dist_bunkhouse", CABIN, { floor: chk("#A47148", "#996A42"), locker: "#7A4E25", rug: "#C2410C",
      bed: (b, i, j, k) => { b.cot(i, j, k % 2 ? "#C2410C" : "#2F7FC4", "#F8FAFC", "#5D3A1A"); b.sleep(i, j, DOWN, "cot", 0.36); },
      couch: ["#C2410C", "#9A3412"], lamp: "#FFD27A" }), cocoa, sled],
    yard: {
      label: "dist_pines",
      floor: snowFloor,
      build: (x) => {
        const { b, I, J } = x;
        for (const [li, lj] of [[3, 3], [8, 4], [5, 8], [10, 9], [3, 12], [8, 13]] as [number, number][]) b.snowyPine(I(li), J(lj));
        x.sign = [tx(I(6)), 1.4, tz(J(2))];
      },
    },
  };
}

export function indoorThemes(): Record<string, Theme> {
  return { office: officeTheme(), home: homeTheme(), cafe: cafeTheme(), space: spaceTheme(), snow: snowTheme() };
}

