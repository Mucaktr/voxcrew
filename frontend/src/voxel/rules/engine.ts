/**
 * S45 — kural motoru: `WorldFacts` + Rule Registry → doğrulama raporu (rehber §8.4 biçimi). Belirlenimci, yerel, LLM yok.
 * Her `Check.op` burada sabit bir fonksiyondur (sonlu işlem listesi); kurallar veri olarak registry.ts'tedir.
 * Sert (error) ihlal varsa `hard_valid=false`: dünya üreticisi bu durumu CI'da (frontend/scripts/rules.mjs) kırmızıya çevirir.
 */
import { districtRole, POD_SEATS, rolesCompatible } from "../districts/core";
import { HOTEL_LABEL } from "../districts/hotel";
// WORK-ZONES (plan §5 C2): şehir ofis binası bölgeleri (görev bölgesi; kalıcı koltuk/uyku talebi doğurmaz)
import { ZONE_LABEL_PREFIX } from "../workzones/registry";
const isOfficeMod = (m: { label?: string }) => !!m.label?.startsWith(ZONE_LABEL_PREFIX);
const OFFICE_FURNITURE: ReadonlySet<string> = new Set(["desk", "office_chair", "desk_lamp"]);
/** yalnız ofis binası için büyümüş dünya (ekip/misafir bölgesi yok): taban kapasitesi aynen geçerli */
const officeOnly = (f: WorldFacts) => !!f.demand.offices?.length && f.modules.some(isOfficeMod) && !f.modules.some((m) => m.kind === "team" || m.kind === "guest");
import { hasTheme, theme as districtTheme } from "../districts/themes";
import { STOREY } from "../buildings";
import { isInSacredBuffer, sacredZones, zoneDistance } from "../city/sacred";
import { moverBoxes } from "../props/movers";
import { detachedBackdrop, GROUND_GAP } from "../city/horizonGround";
import { boardSpot, components, coverGrid, inside, navGrid, reservedTiles, shiftTiles, souvenirSpots, spawnTile, walkable } from "../walk/controller";
import { D, SCENES, tileOf, tx, tz, W, type Built, type Station, type Tile } from "../scenes";
import { ACTIVITIES, BED_POSE, BEDS, canPerform, DEVICES, POSES, stationAffordances } from "./affordances";
import { adjacency, SCENE_PROFILES } from "./catalog";
import type { ModuleFacts, ObjectFacts, WorldFacts } from "./facts";
import { activeRules, type Check, type Rule, RULES } from "./registry";

export const REPORT_SCHEMA = "1.0.0";

export interface Issue {
  rule_id: string;
  severity: "error" | "warning";
  reason_code: string;
  message: string;
  tile?: Tile;
  /** bölge dizini ve köken şablonu (provenance) */
  module?: number;
  template?: string;
  suggested_repairs: string[];
}

export interface ValidationReport {
  schema_version: string;
  scene_id: string;
  case: string;
  tier: string;
  hard_valid: boolean;
  commit_allowed: boolean;
  errors: Issue[];
  warnings: Issue[];
  /** ALLOWS ile geçersiz kılınan kurallar (izlenebilir istisna) */
  overridden: { rule: string; by: string }[];
  checked: string[];
  /** GATEFIX: `external` kurallar burada DENETLENMEZ — sahibi betik (`script`) koşmadıkça UNVERIFIED; asla `checked`/PASS sayılmaz */
  unverified: { rule: string; script: string }[];
}

type Emit = (code: string, message: string, at?: { tile?: Tile; module?: number }) => void;

const inBox = (t: Tile, m: { i0: number; j0: number; w: number; d: number }) =>
  t[0] >= m.i0 && t[0] < m.i0 + m.w && t[1] >= m.j0 && t[1] < m.j0 + m.d;
const fin = (n: unknown) => typeof n === "number" && Number.isFinite(n);
const workMods = (f: WorldFacts) => f.modules.filter((m) => m.kind === "team" || m.kind === "guest");
const MAX_PER_RULE = 6;
/** CITY-BIG — çekirdekli sahnenin tabanı 24×16'dan büyük (ör. 36×32 = 3×2 bölge): taban/ufuk bütçesi büyük tavanı kullanır. */
const bigCity = (f: WorldFacts) => !!SCENES[f.scene]?.core && f.base.width * f.base.depth > W * D;
/** Kırmızı tonlu renk mi (uçak ikaz ışığı: R baskın). */
const isRed = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return /^#[0-9A-Fa-f]{6}$/.test(hex) && r >= 150 && g <= 90 && b <= 90;
};

function footprint(o: ObjectFacts): Tile[] {
  const w = o.info?.w ?? 1, d = o.info?.d ?? 1, out: Tile[] = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) out.push([o.tile[0] + i, o.tile[1] + j]);
  return out;
}

/** Bağlantının (merdiven/rampa/asansör/kule) ayak izine komşu, MERKEZ'den erişilen bir karo var mı? */
function footReachable(f: WorldFacts, o: ObjectFacts): boolean {
  for (const [i, j] of footprint(o)) for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const ni = i + di, nj = j + dj;
    if (f.inside(ni, nj) && f.reach[f.idx(ni, nj)]) return true;
  }
  return false;
}


/** S46 — iki bölge kenar paylaşıyor mu (dikdörtgen; köşe teması sayılmaz)? */
function touching(a: { i0: number; j0: number; w: number; d: number }, b: { i0: number; j0: number; w: number; d: number }): boolean {
  const ox = Math.min(a.i0 + a.w, b.i0 + b.w) - Math.max(a.i0, b.i0), oz = Math.min(a.j0 + a.d, b.j0 + b.d) - Math.max(a.j0, b.j0);
  return (ox > 0 && oz === 0) || (oz > 0 && ox === 0);
}
function modulePairs(f: WorldFacts): [ModuleFacts, ModuleFacts][] {
  const out: [ModuleFacts, ModuleFacts][] = [];
  for (let a = 0; a < f.modules.length; a++) for (let b = a + 1; b < f.modules.length; b++) if (touching(f.modules[a], f.modules[b])) out.push([f.modules[a], f.modules[b]]);
  return out;
}
/** S46 — bölgenin göreli blok imzası (kopya-yapıştır denetimi): bölge kutusundaki blokların konum/boyut/renk/grubu, bölgenin
 *  sol-arka köşesine göre. Aynı imza = aynı görünüm. */
function moduleSignature(f: WorldFacts, m: ModuleFacts): string {
  const x0 = tx(m.i0) - 0.5, z0 = tz(m.j0) - 0.5, x1 = x0 + m.w, z1 = z0 + m.d;
  const r = (v: number) => Math.round(v * 100);
  const keys: string[] = [];
  for (const b of f.built.blocks) {
    if (b.p[0] < x0 || b.p[0] >= x1 || b.p[2] < z0 || b.p[2] >= z1) continue;
    keys.push(`${r(b.p[0] - x0)},${r(b.p[1])},${r(b.p[2] - z0)},${r(b.s[0])},${r(b.s[1])},${r(b.s[2])},${b.c},${b.g}`);
  }
  return keys.sort().join("|");
}

const CHECKS: Record<Check["op"], (f: WorldFacts, c: never, emit: Emit) => void> = {
  finite_geometry: (f, _c, emit) => {
    let bad = 0;
    for (const b of f.built.blocks) if (![...b.p, ...b.s, b.j].every(fin)) bad++;
    if (bad) emit("NONFINITE_BLOCK", `${bad} blokta sonlu olmayan konum/boyut`);
    for (const a of f.anchors) if (a.station && a.station.y !== undefined && !fin(a.station.y)) emit("NONFINITE_Y", `${a.kind}#${a.index} y sonlu değil`, { tile: a.tile });
  },
  anchors_in_bounds: (f, _c, emit) => {
    for (const a of f.anchors) if (!a.tile.every(Number.isInteger) || !f.inside(a.tile[0], a.tile[1])) emit("ANCHOR_OUT_OF_BOUNDS", `${a.kind}#${a.index} dünya dışında`, { tile: a.tile });
  },
  anchors_free: (f, _c, emit) => {
    for (const a of f.anchors) if (f.inside(a.tile[0], a.tile[1]) && f.blocked[f.idx(a.tile[0], a.tile[1])]) emit("ANCHOR_BLOCKED", `${a.kind}#${a.index} engelli karoda`, { tile: a.tile });
  },
  anchors_supported: (f, _c, emit) => {
    for (const a of f.anchors) {
      if (!f.inside(a.tile[0], a.tile[1])) continue;
      const k = f.idx(a.tile[0], a.tile[1]);
      if (!f.deck[k]) emit(f.water[k] ? "ANCHOR_ON_WATER" : "ANCHOR_UNSUPPORTED", `${a.kind}#${a.index} altında zemin/güverte yok`, { tile: a.tile });
    }
  },
  anchors_reachable: (f, _c, emit) => {
    for (const a of f.anchors) if (f.inside(a.tile[0], a.tile[1]) && !f.reach[f.idx(a.tile[0], a.tile[1])]) emit("ANCHOR_UNREACHABLE", `${a.kind}#${a.index} MERKEZ'den erişilemiyor`, { tile: a.tile });
  },
  exclusive_slots: (f, _c, emit) => {
    const k = (t: Tile) => `${t[0]},${t[1]}`;
    const seen = new Set<string>();
    for (const s of f.built.stations) { if (seen.has(k(s.tile))) emit("DUPLICATE_STATION", "aynı karoda iki istasyon", { tile: s.tile }); seen.add(k(s.tile)); }
    const busy = new Set([...f.built.stations.map((s) => k(s.tile)), ...f.built.rest.map(k)]);
    for (const [kind, list] of Object.entries(f.built.spots)) if (kind !== "sleep") for (const s of list ?? []) busy.add(k(s.tile));
    const sl = new Set<string>();
    for (const s of f.built.spots.sleep ?? []) {
      if (sl.has(k(s.tile))) emit("DUPLICATE_SLEEP", "aynı karoda iki uyku noktası", { tile: s.tile });
      if (busy.has(k(s.tile))) emit("SLEEP_OVERLAPS_ANCHOR", "uyku noktası istasyon/dinlenme/araç karosunda", { tile: s.tile });
      sl.add(k(s.tile));
    }
  },
  vocabulary: (f, _c, emit) => {
    for (const s of f.built.stations) {
      if (s.pose && !POSES.includes(s.pose)) emit("UNKNOWN_POSE", `bilinmeyen duruş ${s.pose}`, { tile: s.tile });
      if (s.device && !DEVICES.includes(s.device)) emit("UNKNOWN_DEVICE", `bilinmeyen cihaz ${s.device}`, { tile: s.tile });
      if (s.pose === "lie") emit("STATION_LIE", "istasyon 'lie' duruşunda", { tile: s.tile });
      if (s.device === "none") emit("STATION_NO_DEVICE", "istasyonda cihaz yok", { tile: s.tile });
    }
    for (const s of f.built.spots.sleep ?? []) {
      if (!s.bed || !BEDS.includes(s.bed)) { emit("SLEEP_NO_BED", "uyku noktasında yatak türü yok", { tile: s.tile }); continue; }
      if (s.pose !== BED_POSE[s.bed]) emit("SLEEP_POSE_MISMATCH", `${s.bed} için duruş ${s.pose}`, { tile: s.tile });
      if (s.device && s.device !== "none") emit("SLEEP_WITH_DEVICE", "uyku noktasında cihaz", { tile: s.tile });
    }
  },
  provenance_complete: (f, _c, emit) => {
    for (const m of f.modules) if (m.provenance.rule === "?" || (!m.base && !m.kind)) emit("NO_PROVENANCE", `bölge #${m.index} kökensiz`, { module: m.index });
    const out = f.objects.filter((o) => o.module < 0).length;
    if (out) emit("OBJECT_OUTSIDE_MODULES", `${out} nesne hiçbir bölgede değil`);
  },
  block_budget: (f, c: Extract<Check, { op: "block_budget" }>, emit) => {
    const cap = bigCity(f) && c.bigBase !== undefined ? c.bigBase : c.base;
    if (f.base.blocks.length > cap) emit("BASE_OVER_BUDGET", `taban ${f.base.blocks.length} > ${cap} blok`);
    const bays = f.modules.length - 1;
    if (bays > 0) {
      const per = (f.built.blocks.length - f.base.blocks.length) / bays;
      if (per > c.perBay) emit("BAY_OVER_BUDGET", `bölge başına ${per.toFixed(0)} > ${c.perBay} blok`);
    }
  },
  district_connected: (f, _c, emit) => {
    for (const m of f.modules) {
      if (m.base) continue;
      let ok = false;
      for (let i = m.i0; i < m.i0 + m.w && !ok; i++) for (let j = m.j0; j < m.j0 + m.d && !ok; j++) ok = !!f.reach[f.idx(i, j)];
      if (!ok) emit("ORPHAN_DISTRICT", `bölge #${m.index} (${m.kind}) dünyaya bağlı değil`, { module: m.index, tile: [m.i0, m.j0] });
    }
  },
  roads_walkable: (f, _c, emit) => {
    for (const m of f.modules) {
      if (m.base) continue;
      const bad: Tile[] = [];
      for (let li = 0; li < m.w; li++) if (m.j0 > 0 && f.blocked[f.idx(m.i0 + li, m.j0)]) bad.push([m.i0 + li, m.j0]);
      for (let lj = 1; lj < m.d; lj++) if (f.blocked[f.idx(m.i0, m.j0 + lj)]) bad.push([m.i0, m.j0 + lj]);
      if (bad.length) emit("ROAD_BLOCKED", `bölge #${m.index} sokağında ${bad.length} engelli karo`, { module: m.index, tile: bad[0] });
    }
  },
  growth_matches_demand: (f, _c, emit) => {
    const baseSeats = f.base.stations.length;
    if (!f.theme) return;
    // WORK-ZONES: yalnız kullanılan ofis binaları için büyüme (talep `offices`) gerçek bir taleptir
    if (f.agents <= baseSeats) { if (f.plan && !officeOnly(f)) emit("GROWTH_WITHOUT_DEMAND", `${f.agents} ajan MERKEZ'e (${baseSeats}) sığıyor ama dünya büyüdü`); return; }
    if (!f.plan) { emit("DEMAND_UNMET", `${f.agents} ajan > ${baseSeats} koltuk ama büyüme yok`); return; }
    const seatsOf = (ms: ModuleFacts[]) => ms.reduce((s, m) => s + (m.slots[1] - m.slots[0]), 0);
    for (const t of f.demand.teams) {
      const ms = f.modules.filter((m) => m.kind === "team" && m.team === t.slug);
      const seats = seatsOf(ms);
      if (ms.length !== Math.ceil(t.n / 16)) emit("TEAM_BAYS_MISMATCH", `${t.slug}: ${ms.length} bölge, beklenen ${Math.ceil(t.n / 16)}`);
      if (seats < t.n) emit("TEAM_SEATS_SHORT", `${t.slug}: ${seats} koltuk < ${t.n} ajan`);
      if (seats - t.n >= POD_SEATS) emit("TEAM_SEATS_SURPLUS", `${t.slug}: ${seats - t.n} boş koltuk ≥ 1 pod`);
    }
    const over = Math.max(0, f.demand.guests - baseSeats);
    const gs = seatsOf(f.modules.filter((m) => m.kind === "guest"));
    if (gs < over) emit("GUEST_SEATS_SHORT", `misafir ${gs} koltuk < ${over}`);
    if (gs - over >= POD_SEATS) emit("GUEST_SEATS_SURPLUS", `misafir bölgesinde ${gs - over} boş koltuk ≥ 1 pod (MERKEZ önce kullanılmalı)`);
  },
  service_ratio: (f, _c, emit) => {
    const work = workMods(f).length, am = f.modules.filter((m) => m.kind === "amenity");
    // planlayıcı: bölge dizisinde her 3. konum olanak → ilk çalışma çiftinden sonra her 2 çalışma bölgesine bir olanak
    const need = Math.floor(Math.max(0, work - 1) / 2);
    if (am.length < need) emit("SERVICE_SHORT", `${work} çalışma bölgesine ${am.length} olanak (< ${need})`);
    for (const m of am) {
      const rest = f.built.rest.some((t) => inBox(t, m)) || (f.built.props ?? []).some((p) => p.k === "coffee" && p.tile && inBox(p.tile, m))
        || (f.built.spots.sleep ?? []).some((s) => inBox(s.tile, m));
      if (!rest) emit("AMENITY_NO_REST", `olanak #${m.index} (${m.label}) mola/dinlenme noktası yok`, { module: m.index });
    }
  },
  role_separation: (f, _c, emit) => {
    if (!f.built.seats) return;
    for (const [team, idx] of Object.entries(f.built.seats.teams)) for (const k of idx) {
      const s = f.built.stations[k];
      const m = f.modules.find((q) => inBox(s.tile, q));
      if (!m || m.kind !== "team" || m.team !== team) emit("TEAM_SEAT_ELSEWHERE", `${team} koltuğu #${k} kendi bölgesinde değil`, { tile: s.tile });
    }
    for (const k of f.built.seats.guests) {
      const s = f.built.stations[k];
      const m = f.modules.find((q) => inBox(s.tile, q));
      if (!m || !(m.base || m.kind === "guest" || m.kind === "hq")) emit("GUEST_SEAT_IN_TEAM", `misafir koltuğu #${k} ekip bölgesinde`, { tile: s.tile });
    }
  },
  no_objects: (f, c: Extract<Check, { op: "no_objects" }>, emit) => {
    // WORK-ZONES: şehir ofis binasının İÇİNDEKİ masa/sandalye/lamba yasak "sokakta ofis mobilyası" değildir (bina içi çalışma salonu)
    const inOffice = (o: ObjectFacts) => OFFICE_FURNITURE.has(o.type) && o.module >= 0 && isOfficeMod(f.modules[o.module] ?? {});
    for (const o of f.objects) if (c.types.includes(o.type) && !inOffice(o)) emit("FORBIDDEN_OBJECT", `${o.type} (${o.provenance.template})`, { tile: o.tile, module: o.module });
  },
  has_objects: (f, c: Extract<Check, { op: "has_objects" }>, emit) => {
    const count = (pred: (o: ObjectFacts) => boolean) => f.objects.filter((o) => c.types.includes(o.type) && pred(o)).length;
    if (c.where === "world") { const n = count(() => true); if (n < c.min) emit("MISSING_OBJECT", `${c.types.join("/")} ${n} < ${c.min}`); return; }
    if (c.where === "base") { const n = count((o) => o.module === 0); if (n < c.min) emit("MISSING_OBJECT", `tabanda ${c.types.join("/")} ${n} < ${c.min}`, { module: 0 }); return; }
    for (const m of workMods(f)) { const n = count((o) => o.module === m.index); if (n < c.min) emit("MISSING_OBJECT", `bölge #${m.index}: ${c.types.join("/")} ${n} < ${c.min}`, { module: m.index }); }
  },
  station_poses: (f, c: Extract<Check, { op: "station_poses" }>, emit) => {
    for (const s of f.built.stations) if (!c.allow.includes(s.pose ?? "sit_chair")) emit("POSE_NOT_ALLOWED", `duruş ${s.pose}`, { tile: s.tile });
  },
  station_devices: (f, c: Extract<Check, { op: "station_devices" }>, emit) => {
    for (const s of f.built.stations) if (c.deny.includes(s.device ?? "desktop")) emit("DEVICE_NOT_ALLOWED", `cihaz ${s.device ?? "desktop"}`, { tile: s.tile });
  },
  laptop_work: (f, c: Extract<Check, { op: "laptop_work" }>, emit) => {
    const ok = (s: Station) => c.poses.includes(s.pose ?? "sit_chair") && canPerform(ACTIVITIES.work_with_laptop, stationAffordances(s));
    const bad = f.built.stations.filter((s) => !ok(s));
    const share = f.built.stations.length ? 1 - bad.length / f.built.stations.length : 1;
    if (share + 1e-9 < c.minShare) for (const s of bad) emit("NO_LAPTOP_ANCHOR", `istasyon ${s.pose ?? "sit_chair"}/${s.device ?? "desktop"} dizüstü işine uygun değil`, { tile: s.tile });
  },
  sleep_capacity: (f, c: Extract<Check, { op: "sleep_capacity" }>, emit) => {
    // HOTEL-SYS (E1): otel kapısı geçidi (`bed: "hotel"`) sanal kapasitedir (ajan sayısıyla ölçeklenir) — görünür yatak sayılmaz
    const portal = (b: Built) => (b.spots.sleep ?? []).some((s) => s.bed === "hotel");
    if (portal(f.built) && (portal(f.base) || !!f.plan)) return;
    const baseN = f.base.spots.sleep?.length ?? 0;
    if (baseN < c.base) emit("SLEEP_BASE_SHORT", `tabanda ${baseN} uyku yeri < ${c.base}`, { module: 0 });
    if (!f.plan || officeOnly(f)) return;
    // WORK-ZONES: ofis binası masaları görev süresince kullanılır (ajanın kalıcı koltuğu tabanda/ekip bölgesinde) → sayılmaz
    const office = f.modules.filter(isOfficeMod).reduce((k, m) => k + (m.slots[1] - m.slots[0]), 0);
    const n = f.built.spots.sleep?.length ?? 0, need = Math.ceil(c.ratio * (f.built.stations.length - office));
    if (n < need) emit("SLEEP_SHORT", `${n} uyku yeri < ${need} (istasyonların %${c.ratio * 100})`);
    // GROWTH (2026-10-28): otel temalı dünyada (şehirler) çalışma bölgesinin uyku kapasitesi bölgenin ön şeridinde değil OTELDE:
    // otellerdeki yatak sayısı ≥ perWorkBay × çalışma bölgesi (otel yeri ve kapalılığı: SLEEP-HOTEL-001)
    const hotels = f.modules.filter((m) => m.label === HOTEL_LABEL);
    if (hotels.length) {
      const hb = (f.built.spots.sleep ?? []).filter((s) => hotels.some((m) => inBox(s.tile, m))).length, work = workMods(f).length;
      if (hb < c.perWorkBay * work) emit("HOTEL_BEDS_SHORT", `otellerde ${hb} yatak < ${c.perWorkBay} × ${work} çalışma bölgesi`);
      return;
    }
    for (const m of workMods(f)) {
      const k = (f.built.spots.sleep ?? []).filter((s) => inBox(s.tile, m)).length;
      if (k < c.perWorkBay) emit("SLEEP_BAY_SHORT", `bölge #${m.index}: ${k} uyku yeri < ${c.perWorkBay}`, { module: m.index });
    }
  },
  sleep_beds: (f, c: Extract<Check, { op: "sleep_beds" }>, emit) => {
    const allow = c.allow.length ? c.allow : SCENE_PROFILES[f.scene].beds;
    for (const s of f.built.spots.sleep ?? []) if (s.bed && s.bed !== "hotel" && !allow.includes(s.bed)) /* HOTEL-SYS: geçit her sahnede */ emit("BED_NOT_TYPICAL", `${s.bed} bu sahnede tipik değil`, { tile: s.tile });
  },
  objects_on: (f, c: Extract<Check, { op: "objects_on" }>, emit) => {
    for (const o of f.objects) {
      if (!c.types.includes(o.type)) continue;
      const fp = footprint(o).filter(([i, j]) => f.inside(i, j));
      const wet = fp.filter(([i, j]) => f.water[f.idx(i, j)] && (c.surface === "water" || !f.deck[f.idx(i, j)])).length;
      const share = c.surface === "water" ? wet / Math.max(1, fp.length) : 1 - wet / Math.max(1, fp.length);
      if (share + 1e-9 < c.minShare) emit(c.surface === "water" ? "VESSEL_NOT_ON_WATER" : "LAND_OBJECT_IN_WATER", `${o.type} (${o.provenance.template}) ${c.surface === "water" ? "suda değil" : "suda"}`, { tile: o.tile, module: o.module });
    }
  },
  team_contiguous: (f, _c, emit) => {
    // S46: her ekibin (ve ortak çalışmanın) bölgeleri kenar komşuluğuyla tek parça
    const groups = new Map<string, ModuleFacts[]>();
    for (const m of workMods(f)) { const k = m.kind === "team" ? `team:${m.team}` : "guest"; (groups.get(k) ?? groups.set(k, []).get(k)!).push(m); }
    for (const [k, ms] of groups) {
      if (ms.length < 2) continue;
      const seen = new Set([ms[0]]), q = [ms[0]];
      while (q.length) { const a = q.pop()!; for (const b of ms) if (!seen.has(b) && touching(a, b)) { seen.add(b); q.push(b); } }
      if (seen.size < ms.length) {
        const lost = ms.filter((m) => !seen.has(m));
        emit("TEAM_SPLIT", `${k}: ${ms.length} bölgeden ${lost.length} tanesi ekibin geri kalanından kopuk (ekip okunmuyor)`, { module: lost[0].index, tile: [lost[0].i0, lost[0].j0] });
      }
    }
  },
  district_clone: (f, _c, emit) => {
    const sig = new Map<number, string>();
    const of = (m: ModuleFacts) => sig.get(m.index) ?? (sig.set(m.index, moduleSignature(f, m)).get(m.index)!);
    for (const [a, b] of modulePairs(f)) {
      if (a.base || b.base || a.kind === "team" || a.kind === "guest" || b.kind === "team" || b.kind === "guest") continue;
      if (a.label !== b.label) continue;
      if (of(a) === of(b)) emit("DISTRICT_CLONE", `#${a.index} ve #${b.index} (${a.label}) yan yana birebir kopya`, { module: b.index, tile: [b.i0, b.j0] });
    }
  },
  district_adjacency: (f, _c, emit) => {
    for (const [a, b] of modulePairs(f)) {
      const ra = districtRole(a.kind, a.label), rb = districtRole(b.kind, b.label);
      if (!rolesCompatible(ra, rb)) emit("SLEEP_BY_NOISE", `uyku bölgesi gürültülü bölgeye komşu: #${a.index} ${a.label} ↔ #${b.index} ${b.label}`, { module: b.index, tile: [b.i0, b.j0] });
    }
  },
  seam_water: (f, _c, emit) => {
    // bölge sınırında açık su ile kuru kara düz bir çizgide karşılaşıyorsa (≥ 3 karo) kıyı kesik: deniz/gölet sınırda bitiyor.
    // Okyanus sahnelerinde (deniz, yat) iskele/güverte suyun üstündedir — atlanır.
    if (f.ocean) return;
    const wet = (i: number, j: number) => !!f.water[f.idx(i, j)] && !f.deck[f.idx(i, j)];
    const dry = (i: number, j: number) => !f.water[f.idx(i, j)];
    for (const [a, b] of modulePairs(f)) {
      const vertical = a.i0 + a.w === b.i0 || b.i0 + b.w === a.i0;
      const [L, R] = vertical ? (a.i0 < b.i0 ? [a, b] : [b, a]) : (a.j0 < b.j0 ? [a, b] : [b, a]);
      const from = vertical ? Math.max(L.j0, R.j0) : Math.max(L.i0, R.i0);
      const len = vertical ? Math.min(L.j0 + L.d, R.j0 + R.d) - from : Math.min(L.i0 + L.w, R.i0 + R.w) - from;
      let run = 0, worst = 0, at: Tile | undefined;
      for (let k = 0; k < len; k++) {
        const p: Tile = vertical ? [R.i0 - 1, from + k] : [from + k, R.j0 - 1];
        const q: Tile = vertical ? [R.i0, from + k] : [from + k, R.j0];
        const cut = (wet(p[0], p[1]) && dry(q[0], q[1])) || (dry(p[0], p[1]) && wet(q[0], q[1]));
        run = cut ? run + 1 : 0;
        if (run > worst) { worst = run; at = q; }
      }
      if (worst >= 3) emit("SEAM_WATER_CUT", `#${a.index} ↔ #${b.index}: su ${worst} karo boyunca bölge sınırında kesiliyor`, { tile: at, module: b.index });
    }
  },
  district_density: (f, c: Extract<Check, { op: "district_density" }>, emit) => {
    // bölgede "boş düz zemin" payı: üstünde hiçbir şey olmayan, engelsiz, su olmayan karolar (yol satırı/sütunu hariç)
    const { width: W0, depth: D0 } = f.built;
    const deco = new Uint8Array(W0 * D0);
    const i0 = tx(0), j0 = tz(0);
    for (const b of f.built.blocks) {
      if (b.p[1] + b.s[1] / 2 < 0.03 || b.g === "cloud" || b.g === "water") continue;
      const xa = b.p[0] - b.s[0] / 2, xb = b.p[0] + b.s[0] / 2, za = b.p[2] - b.s[2] / 2, zb = b.p[2] + b.s[2] / 2;
      for (let i = Math.max(0, Math.floor(xa - i0 + 0.5)); i <= Math.min(W0 - 1, Math.floor(xb - i0 + 0.5 - 1e-6)); i++)
        for (let j = Math.max(0, Math.floor(za - j0 + 0.5)); j <= Math.min(D0 - 1, Math.floor(zb - j0 + 0.5 - 1e-6)); j++) deco[j * W0 + i] = 1;
    }
    for (const m of f.modules) {
      if (m.base || (m.label && c.open.includes(m.label))) continue;
      let plain = 0, tot = 0;
      for (let i = m.i0 + 1; i < m.i0 + m.w; i++) for (let j = m.j0 + 1; j < m.j0 + m.d; j++) {
        const k = f.idx(i, j); tot++;
        if (!deco[k] && !f.blocked[k] && !f.water[k]) plain++;
      }
      if (plain / tot > c.maxPlain) emit("DISTRICT_EMPTY", `#${m.index} ${m.kind}${m.label ? `/${m.label}` : ""}: düz boş zemin %${Math.round((100 * plain) / tot)} > %${Math.round(c.maxPlain * 100)}`, { module: m.index, tile: [m.i0, m.j0] });
    }
  },
  station_faces_furniture: (f, _c, emit) => {
    // masada/tezgâhta çalışan (sit_chair, stand) istasyonun baktığı karoda mobilya var (boşluğa bakan sandalye yok)
    f.built.stations.forEach((s, k) => {
      const pose = s.pose ?? "sit_chair";
      if (pose !== "sit_chair" && pose !== "stand") return;
      const t: Tile = [s.tile[0] + Math.round(Math.sin(s.face)), s.tile[1] + Math.round(Math.cos(s.face))];
      if (!f.inside(t[0], t[1]) || !f.blocked[f.idx(t[0], t[1])]) emit("SEAT_FACES_NOTHING", `istasyon #${k} (${pose}) önünde masa/tezgâh yok`, { tile: s.tile });
    });
  },
  sleep_in_hotel: (f, c: Extract<Check, { op: "sleep_in_hotel" }>, emit) => {
    // GROWTH (ürün sahibi 2026-10-28): otel temalı sahnede büyüme bölgelerinde açık hava yatağı yok — her uyku noktası bir otel bölgesinde
    // ve üstü kapalı (binanın içinde); her `every` çalışma bölgesine en az bir otel
    if (!f.theme || !hasTheme(f.theme) || !districtTheme(f.theme).hotel) return;
    // HOTEL-SYS (E1): şehir başına TEK otel (taban ya da büyüme); uyku yalnız otel kapısı geçidinde (görünür yatak yok)
    const baseHotel = (f.base.zones ?? []).some((z) => z.kind === "hotel");
    const hotels = f.modules.filter((m) => m.label === HOTEL_LABEL), work = workMods(f).length;
    if (work && !baseHotel && hotels.length < 1) emit("HOTEL_MISSING", `${work} çalışma bölgesine otel yok (taban da otelsiz)`);
    if (hotels.length + (baseHotel ? 1 : 0) > 1) emit("HOTEL_NOT_SINGLE", `şehirde ${hotels.length + (baseHotel ? 1 : 0)} otel (tek otel)`);
    if ((f.built.spots.sleep ?? []).some((s) => s.bed === "hotel")) {
      for (const s of f.built.spots.sleep ?? []) {
        const m = f.modules.find((q) => inBox(s.tile, q));
        if (s.bed !== "hotel" && m && !m.base) emit("OPEN_AIR_BED", `uyku noktası (${s.bed}) otel geçidi dışında: #${m.index} ${m.label ?? m.kind}`, { tile: s.tile, module: m.index });
      }
      return;
    }
    const cover = coverGrid(f.built);
    for (const s of f.built.spots.sleep ?? []) {
      const m = f.modules.find((q) => inBox(s.tile, q));
      if (!m || m.base) continue;
      if (m.label !== HOTEL_LABEL) { emit("OPEN_AIR_BED", `uyku noktası (${s.bed}) otel dışında: #${m.index} ${m.label ?? m.kind}`, { tile: s.tile, module: m.index }); continue; }
      const y = cover.roofY[s.tile[1] * f.built.width + s.tile[0]];
      if (!(y >= c.minY && y < Infinity)) emit("HOTEL_BED_OUTSIDE", "otel yatağının üstü kapalı değil (bina içinde değil)", { tile: s.tile, module: m.index });
    }
  },
  sleep_apart_from_work: (f, _c, emit) => {
    // uyku noktası bir çalışma istasyonuna bitişik değil (yatak çalışma sırasının içinde değil)
    const st = new Set(f.built.stations.map((s) => `${s.tile[0]},${s.tile[1]}`));
    for (const s of f.built.spots.sleep ?? []) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!st.has(`${s.tile[0] + dx},${s.tile[1] + dz}`)) continue;
      emit("SLEEP_IN_WORK_ROW", `uyku noktası (${s.bed}) çalışma istasyonuna bitişik`, { tile: s.tile });
      break;
    }
  },
  ambient_habitat: (f, _c, emit) => {
    for (const h of f.built.ambient ?? []) {
      const [i, j] = h.tile;
      if (!f.inside(i, j)) { emit("HOOK_OUT_OF_BOUNDS", `${h.kind} kancası dünya dışında`, { tile: h.tile }); continue; }
      if (h.kind === "pond" || h.kind === "sea") {
        const r = Math.ceil(h.r ?? 1) + 1;
        let wet = h.kind === "sea" && f.ocean;
        for (let di = -r; di <= r && !wet; di++) for (let dj = -r; dj <= r && !wet; dj++) {
          const k = f.idx(i + di, j + dj);
          wet = f.inside(i + di, j + dj) && !!(f.water[k] || (h.kind === "pond" && f.ice[k]));
        }
        if (!wet) emit("HOOK_NO_WATER", `${h.kind} kancası (balık/ördek/yunus) suya uzak`, { tile: h.tile });
      } else if ((h.kind === "sand" || h.kind === "grass") && f.water[f.idx(i, j)] && !f.deck[f.idx(i, j)]) {
        emit("HOOK_IN_WATER", `${h.kind} kancası suda`, { tile: h.tile });
      } else if (h.kind === "fish") {
        // S46/S48: balık tutma yeri yürünebilir ve erişilebilir; baktığı komşu açık su (okyanus sahnesinde dünya dışı da olur)
        const [dx, dz] = [[0, 1], [0, -1], [1, 0], [-1, 0]][Math.max(0, Math.min(7, Math.round(h.r ?? 0))) % 4]; // W2-INT: r ≥ 4 yalnız besleme
        const ni = i + dx, nj = j + dz;
        const water = f.inside(ni, nj) ? !!f.water[f.idx(ni, nj)] && !f.deck[f.idx(ni, nj)] : f.ocean;
        const why = f.blocked[f.idx(i, j)] ? "engelli" : !f.reach[f.idx(i, j)] ? "erişilemez" : !water ? "suya bakmıyor" : "";
        if (why) emit("FISH_SPOT_INVALID", `balık tutma yeri ${why}`, { tile: h.tile });
      } else if (h.kind === "play") {
        // S46/S48: oyun masası karosu engelli (masa), iki ucu x ya da z boyunca yürünebilir ve erişilebilir
        const free = (a: number, c: number) => f.inside(a, c) && !f.blocked[f.idx(a, c)] && !!f.reach[f.idx(a, c)];
        if (!f.blocked[f.idx(i, j)] || !((free(i - 1, j) && free(i + 1, j)) || (free(i, j - 1) && free(i, j + 1))))
          emit("PLAY_SPOT_INVALID", "oyun masası karosu engelli değil ya da iki ucu yürünebilir değil", { tile: h.tile });
      }
    }
  },
  water_districts: (f, c: Extract<Check, { op: "water_districts" }>, emit) => {
    for (const m of workMods(f)) {
      let wet = 0;
      for (let i = m.i0; i < m.i0 + m.w; i++) for (let j = m.j0; j < m.j0 + m.d; j++) wet += f.water[f.idx(i, j)];
      if (wet / (m.w * m.d) < c.minShare) emit("DISTRICT_NOT_MARINA", `bölge #${m.index}: su %${Math.round((100 * wet) / (m.w * m.d))}`, { module: m.index });
    }
  },
  level_access: (f, _c, emit) => {
    const LINK = new Set(["stairs", "escalator", "elevator", "ramp", "tower"]);
    const levels = new Set<number>([0]);
    for (const o of f.objects) {
      if (o.type !== "floor_slab" && o.type !== "upper_storey") continue;
      const y = o.info?.y ?? 0, area = (o.info?.w ?? 1) * (o.info?.d ?? 1);
      if (y < 2 || area < 6) continue; // gölgelik/tente: kat değil
      levels.add(Math.round(y / STOREY));
      if (o.info?.enclosed) continue; // kapalı kat: iç merdiven varsayılır
      const links = f.objects.filter((l) => LINK.has(l.type) && l.module === o.module && (l.info?.y ?? 0) >= y - 0.6);
      if (!links.length) { emit("FLOOR_WITHOUT_ACCESS", `kat (y=${y}) için bağlantı yok (${o.provenance.template})`, { tile: o.tile, module: o.module }); continue; }
      if (!links.some((l) => footReachable(f, l))) emit("FLOOR_ACCESS_UNREACHABLE", `kat (y=${y}) bağlantılarının ayağına erişilemiyor`, { tile: o.tile, module: o.module });
    }
    const max = SCENE_PROFILES[f.scene].maxLevels;
    if (levels.size > max) emit("TOO_MANY_LEVELS", `${levels.size} kat > profil üst sınırı ${max}`);
  },
  anchors_ground_level: (f, _c, emit) => {
    for (const a of f.anchors) if (a.station?.y !== undefined && a.station.y >= STOREY / 2) emit("ANCHOR_ABOVE_GROUND", `${a.kind}#${a.index} y=${a.station.y} (üst kat yürünemez — karar a)`, { tile: a.tile });
  },
  no_flame: (f, _c, emit) => {
    const fl = f.built.blocks.filter((b) => b.g === "flame");
    if (fl.length) emit("OPEN_FLAME", `${fl.length} ateş bloğu`, { tile: [Math.round(fl[0].p[0] - tx(0)), 0] });
  },
  water_not_walkable: (f, _c, emit) => {
    let first: Tile | null = null, n = 0;
    for (let j = 0; j < f.built.depth; j++) for (let i = 0; i < f.built.width; i++) {
      const k = f.idx(i, j);
      if (f.water[k] && !f.blocked[k] && !f.deck[k]) { n++; first ??= [i, j]; }
    }
    if (n) emit("WALKABLE_WATER", `${n} su karosu yürünebilir (iskele yok)`, { tile: first! });
  },
  sleep_body_clearance: (f, _c, emit) => {
    const lie = (f.built.spots.sleep ?? []).filter((s) => s.pose === "lie" && s.bed !== "hotel"); // HOTEL-SYS: geçitte gövde yok
    const at = new Set(lie.map((s) => `${s.tile[0]},${s.tile[1]}`));
    for (const s of lie) {
      const alongZ = Math.abs(Math.cos(s.face)) > 0.5;
      const [i, j] = s.tile, n = alongZ ? `${i},${j + 1}` : `${i + 1},${j}`;
      if (at.has(n)) emit("SLEEPERS_OVERLAP", `${s.bed} uyku noktası gövde ekseninde bir başkasına bitişik`, { tile: s.tile });
    }
  },
  has_hooks: (f, c: Extract<Check, { op: "has_hooks" }>, emit) => {
    const n = (f.built.ambient ?? []).filter((h) => c.kinds.includes(h.kind)).length;
    if (n < c.min) emit("MISSING_HOOK", `${c.kinds.join("/")} kancası ${n} < ${c.min}`);
  },
  tool_spots: (f, c: Extract<Check, { op: "tool_spots" }>, emit) => {
    const areas: { m?: ModuleFacts; box: { i0: number; j0: number; w: number; d: number } }[] = [{ box: f.modules.find((m) => m.base) ?? { i0: 0, j0: 0, w: f.base.width, d: f.base.depth } }]; // RING-INT: taban ortada olabilir
    for (const m of workMods(f)) areas.push({ m, box: m });
    for (const a of areas) for (const k of c.kinds) {
      if (!(f.built.spots[k] ?? []).some((s) => inBox(s.tile, a.box))) emit("MISSING_TOOL_SPOT", `${a.m ? `bölge #${a.m.index}` : "taban"}: '${k}' noktası yok`, { module: a.m?.index ?? 0 });
    }
  },
  // ---- SP-W0 sahne paketleri
  sacred_anchors: (f, _c, emit) => {
    for (const z of sacredZones(f.built)) {
      if (![z.i0, z.j0, z.w, z.d].every(Number.isInteger) || z.w < 1 || z.d < 1 || !f.inside(z.i0, z.j0) || !f.inside(z.i0 + z.w - 1, z.j0 + z.d - 1))
        emit("ZONE_OUT_OF_BOUNDS", `sacred bölge (${z.i0},${z.j0} ${z.w}×${z.d}) dünya dışında`, { tile: [z.i0, z.j0] });
    }
    for (const a of f.anchors) if (isInSacredBuffer(a.tile, f.built, "anchor")) emit("ANCHOR_IN_SACRED", `${a.kind}#${a.index} sacred bölgede`, { tile: a.tile });
    for (const p of f.built.props ?? []) if (p.k === "coffee" && p.tile && isInSacredBuffer(p.tile, f.built, "anchor")) emit("COFFEE_IN_SACRED", "kahve/mola noktası sacred bölgede", { tile: p.tile });
  },
  sacred_fun: (f, c: Extract<Check, { op: "sacred_fun" }>, emit) => {
    for (const h of f.built.ambient ?? []) if (c.kinds.includes(h.kind) && isInSacredBuffer(h.tile, f.built, c.margin))
      emit("FUN_NEAR_SACRED", `${h.kind} eğlence yeri sacred bölgeye ≤ ${c.margin} karo`, { tile: h.tile });
  },
  sacred_ambient: (f, _c, emit) => {
    for (const h of f.built.ambient ?? []) if (isInSacredBuffer(h.tile, f.built, "anchor")) emit("HOOK_IN_SACRED", `${h.kind} kancası sacred bölgede`, { tile: h.tile });
  },
  mover_budget: (f, c: Extract<Check, { op: "mover_budget" }>, emit) => {
    const ms = f.built.movers ?? [];
    if (ms.length > c.max) emit("TOO_MANY_MOVERS", `${ms.length} hareketli > ${c.max}`);
    const boxes = ms.reduce((s, m) => s + moverBoxes(m), 0);
    if (boxes > c.boxes) emit("MOVER_BOXES_OVER", `${boxes} kutu > ${c.boxes}`);
    ms.forEach((m, k) => {
      if (!m.path?.length || !m.path.every((p) => p.length === 3 && p.every(fin)) || !fin(m.period) || m.period <= 0 || !moverBoxes(m))
        emit("BAD_MOVER", `hareketli #${k} (${m.shape}) yolu/süresi/şekli geçersiz`);
    });
  },
  glow_budget: (f, c: Extract<Check, { op: "glow_budget" }>, emit) => {
    const glow = (bs: readonly { g: string }[] | undefined) => (bs ?? []).reduce((n, b) => n + (b.g === "glow" ? 1 : 0), 0);
    const bd = glow(f.built.backdrop), base = glow(f.base.blocks) + bd;
    if (c.base !== undefined && base > c.base) emit("GLOW_OVER_BUDGET", `taban + ufuk ${base} > ${c.base} parlayan blok`);
    if (c.backdrop !== undefined && bd > c.backdrop) emit("GLOW_OVER_BUDGET", `ufuk ${bd} > ${c.backdrop} parlayan blok`);
    const bays = f.modules.length - 1;
    if (c.perBay !== undefined && bays > 0) {
      const per = (glow(f.built.blocks) - glow(f.base.blocks)) / bays;
      if (per > c.perBay) emit("GLOW_OVER_BUDGET", `bölge başına ${per.toFixed(0)} > ${c.perBay} parlayan blok`);
    }
    const leds = (f.built.props ?? []).filter((m) => m.k === "led").length;
    if (c.led !== undefined && leds > c.led) emit("LED_OVER_BUDGET", `${leds} led > ${c.led}`);
    if (c.lights !== undefined && f.built.lights.length > c.lights) emit("LIGHTS_OVER_BUDGET", `${f.built.lights.length} nokta ışık > ${c.lights}`);
  },
  backdrop_budget: (f, c: Extract<Check, { op: "backdrop_budget" }>, emit) => {
    const bd = f.built.backdrop ?? [];
    const max = bigCity(f) && c.bigMax !== undefined ? c.bigMax : c.max;
    if (bd.length > max) emit("BACKDROP_OVER_BUDGET", `ufuk ${bd.length} > ${max} blok`);
    const x0 = tx(0) - 0.5, x1 = tx(f.built.width - 1) + 0.5, z0 = tz(0) - 0.5, z1 = tz(f.built.depth - 1) + 0.5;
    let on = 0, at: Tile | undefined;
    for (const b of bd) {
      if (![...b.p, ...b.s].every(fin)) { on++; continue; }
      const overlaps = b.p[0] + b.s[0] / 2 > x0 && b.p[0] - b.s[0] / 2 < x1 && b.p[2] + b.s[2] / 2 > z0 && b.p[2] - b.s[2] / 2 < z1;
      if (overlaps) { on++; at ??= [Math.floor(b.p[0] - x0), Math.floor(b.p[2] - z0)]; }
    }
    if (on) emit("BACKDROP_ON_GRID", `${on} ufuk bloğu dünya ızgarasının üstünde (yürünmez arka plan ızgara dışında olmalı)`, at ? { tile: at } : {});
  },
  // HORIZON — SCENE-BACKDROP-002: ufuk blokları zemine bağlı (taban kenarı, sahne okyanusu ya da bunlara dayanan blok zinciri)
  backdrop_ground: (f, c: Extract<Check, { op: "backdrop_ground" }>, emit) => {
    // taban dünya (genel bakışta görülen sahne). Büyümüş dünyada bant parçaları büyüme kuralıyla kayar/esner (districts/core.ts);
    // orada su ve yan dekor tabandan ayrı taşınır — ayrı iş ( kalanlar)
    if (!f.built.backdrop?.length || f.modules.length > 1) return;
    const ocean = SCENES[f.scene]?.ocean?.y ?? null;
    for (const k of detachedBackdrop(f.built, ocean).slice(0, c.report)) {
      const h = k.y1 - k.y0;
      emit("BACKDROP_DETACHED", `${k.n} ufuk bloğu zeminsiz (x ${k.rect.x0.toFixed(1)}…${k.rect.x1.toFixed(1)}, z ${k.rect.z0.toFixed(1)}…${k.rect.z1.toFixed(1)}, `
        + `y ${k.y0.toFixed(1)}…${k.y1.toFixed(1)}; yükseklik ${h.toFixed(1)}, tabana ${k.gap.toFixed(1)} birim > ${GROUND_GAP}; örnek ${k.sample})`,
        { tile: tileOf((k.rect.x0 + k.rect.x1) / 2, (k.rect.z0 + k.rect.z1) / 2) });
    }
  },
  scene_risk: (f, c: Extract<Check, { op: "scene_risk" }>, emit) => {
    const def = SCENES[f.scene];
    if (!def || (def.tier ?? "core") === "core") return;
    for (const k of ["ip_risk", "culture_risk"] as const) {
      const v = def[k];
      if (v === undefined) emit("RISK_UNSCORED", `${f.scene}: ${k} yok (şehir/premium sahnede zorunlu)`);
      else if (v > c.max) emit("RISK_REJECTED", `${f.scene}: ${k} ${v} > ${c.max} (yayınlanmaz)`);
    }
  },
  landmark_night: (f, c: Extract<Check, { op: "landmark_night" }>, emit) => {
    const marks = (f.built.zones ?? []).filter((z) => z.kind === "landmark" && z.tag === c.tag);
    if (!marks.length) return;
    const near = (t: Tile) => marks.some((z) => zoneDistance(t, z) <= c.margin);
    for (const p of f.built.props ?? []) if ((p.k === "lamp" || p.k === "led") && near(tileOf(p.p[0], p.p[2])))
      emit("LANDMARK_LIGHT_PROP", `${c.tag} simgesine ≤ ${c.margin} karo '${p.k}' ışık işareti`, { tile: tileOf(p.p[0], p.p[2]) });
    for (const l of f.built.lights) if (near(tileOf(l.pos[0], l.pos[2])))
      emit("LANDMARK_POINT_LIGHT", `${c.tag} simgesine ≤ ${c.margin} karo nokta ışık`, { tile: tileOf(l.pos[0], l.pos[2]) });
    let beacons = 0;
    for (const b of [...f.built.blocks, ...(f.built.backdrop ?? [])]) {
      if (b.g !== "glow" || !near(tileOf(b.p[0], b.p[2]))) continue;
      if (isRed(b.c) && b.s.every((v) => v <= c.beaconSize + 1e-9)) { beacons++; continue; }
      emit("LANDMARK_GLOW", `${c.tag} simgesine ≤ ${c.margin} karo parlayan blok ${b.c} (yalnız küçük kırmızı ikaz ışığı izinli)`, { tile: tileOf(b.p[0], b.p[2]) });
    }
    if (beacons > c.beacons * marks.length) emit("LANDMARK_BEACONS", `${beacons} ikaz ışığı > ${c.beacons} (ışık gösterisi)`);
  },
  // RING-INT — simge çekirdeği (SceneDef.core): taban modülünün konumuyla mutlak karoya çevrilir
  city_core: (f, c: Extract<Check, { op: "city_core" }>, emit) => {
    const core = SCENES[f.scene]?.core, m0 = f.modules.find((m) => m.base);
    if (!core || !m0) return;
    if (![core.i0, core.j0, core.w, core.d].every(Number.isInteger) || core.w < 1 || core.d < 1 || core.i0 < 0 || core.j0 < 0
      || core.i0 + core.w > f.base.width || core.j0 + core.d > f.base.depth) { emit("CORE_BAD", `çekirdek (${core.i0},${core.j0} ${core.w}×${core.d}) taban ızgarasında değil`); return; }
    // CITY-BIG: çok bölgeli taban (ör. 36×32 = 3×2) bölge ızgarasına oturur — taban boyutu bölge katı (12×16), konumu bölge sınırında
    if ((f.base.width !== W || f.base.depth !== D) && (f.base.width % 12 || f.base.depth % D || f.base.width < W || f.base.depth < D))
      emit("CORE_BASE_NOT_BAYS", `taban ${f.base.width}×${f.base.depth} bölge katı değil (12×16 birimli, en az 24×16)`);
    if (m0.i0 % 12 || m0.j0 % D) emit("CORE_BASE_NOT_BAYS", `taban (${m0.i0},${m0.j0}) bölge ızgarasına oturmuyor`, { tile: [m0.i0, m0.j0] });
    const box = { i0: m0.i0 + core.i0, j0: m0.j0 + core.j0, w: core.w, d: core.d };
    const ox = Math.abs(box.i0 + box.w / 2 - f.built.width / 2) / f.built.width, oz = Math.abs(box.j0 + box.d / 2 - f.built.depth / 2) / f.built.depth;
    // CITY-B kıyı halkası (`plan.shore`, <city>): deniz dünyanın arkasındaki ufuktur → çekirdek x'te ortalı, z'de arka kıyıya (j 0) dayalı
    if (f.plan?.shore) {
      if (ox > c.maxOffset || m0.j0 !== 0)
        emit("CORE_OFF_CENTRE", `kıyı çekirdeği: x %${Math.round(ox * 100)} (> %${Math.round(c.maxOffset * 100)}) ya da taban arka kıyıda değil (j ${m0.j0})`, { tile: [box.i0, box.j0] });
    } else if (ox > c.maxOffset || oz > c.maxOffset)
      emit("CORE_OFF_CENTRE", `çekirdek merkezi dünya merkezinden x %${Math.round(ox * 100)}, z %${Math.round(oz * 100)} uzakta (> %${Math.round(c.maxOffset * 100)})`, { tile: [box.i0, box.j0] });
    for (const m of f.modules) {
      if (m.base) continue;
      const ix = Math.min(m.i0 + m.w, box.i0 + box.w) - Math.max(m.i0, box.i0), iz = Math.min(m.j0 + m.d, box.j0 + box.d) - Math.max(m.j0, box.j0);
      if (ix > 0 && iz > 0) emit("CORE_INTRUDED", `bölge #${m.index} (${m.kind}) çekirdeğe giriyor`, { module: m.index, tile: [m.i0, m.j0] });
    }
    // kenar payı 0,4: bölge kenarındaki tente/saçak/ağaç tacı taşmaları (≤ 0,4 birim) bölge sayılmaz; daha derin giren blok sayılır
    const E = 0.4, x0 = tx(box.i0) - 0.5 + E, x1 = tx(box.i0 + box.w - 1) + 0.5 - E, z0 = tz(box.j0) - 0.5 + E, z1 = tz(box.j0 + box.d - 1) + 0.5 - E;
    let n = 0, at: Tile | undefined;
    for (let k = f.base.blocks.length; k < f.built.blocks.length; k++) {
      const b = f.built.blocks[k];
      if (b.p[0] + b.s[0] / 2 > x0 && b.p[0] - b.s[0] / 2 < x1 && b.p[2] + b.s[2] / 2 > z0 && b.p[2] - b.s[2] / 2 < z1) { n++; at ??= tileOf(b.p[0], b.p[2]); }
    }
    if (n) emit("CORE_BLOCK_INTRUDED", `${n} büyüme bloğu çekirdeğin üstünde`, at ? { tile: at } : {});
  },
  city_landmark: (f, _c, emit) => {
    const core = SCENES[f.scene]?.core, m0 = f.modules.find((m) => m.base);
    if (!core || !m0) return;
    const i0 = m0.i0 + core.i0, j0 = m0.j0 + core.j0;
    const inside = (f.built.zones ?? []).filter((z) => z.kind === "landmark" && z.i0 >= i0 && z.j0 >= j0 && z.i0 + z.w <= i0 + core.w && z.j0 + z.d <= j0 + core.d);
    if (!inside.length) emit("NO_LANDMARK_IN_CORE", `${f.scene}: çekirdekte simge (landmark) bölgesi yok`, { tile: [i0, j0] });
  },
  // W2 (WALK-INT) — yürüme modu kuralları; mantık scripts/walk_check.mjs ile aynı işlevlerden (voxel/walk/controller.ts)
  walk_spawn: (f, _c, emit) => {
    const sp = spawnTile(f.built, { core: SCENES[f.scene]?.core ?? null });
    if (!sp) { emit("WALK_NO_SPAWN", "yürüme doğma karosu bulunamadı"); return; }
    const nav = navGrid(f.built), { labels } = components(f.built);
    const lab = (t: Tile) => (inside(nav, t[0], t[1]) ? labels[t[1] * nav.width + t[0]] : -1);
    const sl = lab(sp.tile);
    if (!walkable(nav, sp.tile[0], sp.tile[1])) emit("WALK_SPAWN_BLOCKED", `doğma karosu yürünemez`, { tile: sp.tile });
    if (f.built.stations.some((s) => s.tile[0] === sp.tile[0] && s.tile[1] === sp.tile[1])) emit("WALK_SPAWN_STATION", "doğma karosu bir istasyon", { tile: sp.tile });
    const reach = (t: Tile) => lab(t) === sl || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => lab([t[0] + a, t[1] + b]) === sl);
    for (const s of f.built.stations) if (!reach(s.tile)) emit("WALK_STATION_UNREACHABLE", "istasyon doğmadan ulaşılamıyor", { tile: s.tile });
  },
  walk_board: (f, _c, emit) => {
    const core = SCENES[f.scene]?.core ?? null;
    const bs = boardSpot(f.built, core), sp = spawnTile(f.built, { core });
    if (!bs) { emit("WALK_NO_BOARD", "çıktı panosu ya da eşdeğeri yok"); return; }
    const { labels } = components(f.built), w = f.built.width;
    if (sp && labels[bs.tile[1] * w + bs.tile[0]] !== labels[sp.tile[1] * w + sp.tile[0]])
      emit("WALK_BOARD_UNREACHABLE", `pano noktası (${bs.source}) doğmadan ulaşılamıyor`, { tile: bs.tile });
  },
  walk_sacred: (f, c: Extract<Check, { op: "walk_sacred" }>, emit) => {
    const souv = shiftTiles(f.built, souvenirSpots(f.base, f.scene, c.n));
    if (souv.length !== c.n) emit("WALK_SOUVENIR_COUNT", `hatıra adayı ${souv.length}/${c.n}`);
    const nav = navGrid(f.built), { labels, main } = components(f.built), reserved = reservedTiles(f.built), seen = new Set<string>();
    for (const t of souv) {
      const k = `${t[0]},${t[1]}`;
      if (seen.has(k)) emit("WALK_SOUVENIR_DUP", "hatıra yinelenmiş", { tile: t });
      seen.add(k);
      if (!walkable(nav, t[0], t[1]) || labels[t[1] * nav.width + t[0]] !== main) emit("WALK_SOUVENIR_UNREACHABLE", "hatıra yürünemez ya da ulaşılamaz karoda", { tile: t });
      if (reserved.has(k)) emit("WALK_SOUVENIR_ANCHOR", "hatıra çapa/kanca karosunda", { tile: t });
      if (isInSacredBuffer(t, f.built)) emit("WALK_SOUVENIR_SACRED", "hatıra kutsal bölge payında", { tile: t });
    }
  },
  // EXP (E1c): çevre arazisi kuralları `scripts/expanse_check.mjs`'te denetlenir; `evaluate` bunları `unverified`e yazar (çağrılmaz)
  external: () => { throw new Error("external kural motorda değerlendirilmez (unverified)"); },
  walk_cover: (f, c: Extract<Check, { op: "walk_cover" }>, emit) => {
    const cover = coverGrid(f.built);
    for (let k = 0; k < cover.roofY.length; k++) {
      const y = cover.roofY[k];
      if (y !== Infinity && y < c.minY) emit("WALK_COVER_LOW", `örtü ${y.toFixed(2)} < ${c.minY}`, { tile: [k % f.built.width, Math.floor(k / f.built.width)] });
    }
  },
  annex_adjacency: (f, _c, emit) => {
    if (!f.theme || f.theme === f.scene || !(f.theme in SCENE_PROFILES)) return;
    const a = adjacency(f.scene, f.theme as typeof f.scene);
    if (a === "incompatible" || a === "weak") emit("ANNEX_ADJACENCY", `${f.scene} ↔ ${f.theme}: ${a} (geçiş bölgesi ya da uyumlu tema önerilir)`);
  },
};

/** Olgulara etkin kuralları uygular. `rules` verilmezse Registry v1.0. */
export function evaluate(f: WorldFacts, caseName: string, rules: Rule[] = RULES): ValidationReport {
  const { active, overridden } = activeRules(f.scene, rules);
  const errors: Issue[] = [], warnings: Issue[] = [], checked: string[] = [], unverified: { rule: string; script: string }[] = [];
  for (const r of active) {
    if (!r.check || (r.scope.grownOnly && !f.plan)) continue;
    if (r.check.op === "external") { unverified.push({ rule: r.id, script: r.check.script }); continue; }
    checked.push(r.id);
    let n = 0;
    const emit: Emit = (code, message, at = {}) => {
      n++;
      if (n > MAX_PER_RULE) return;
      const mod = at.module ?? (at.tile ? f.modules.findIndex((m) => inBox(at.tile!, m)) : undefined);
      const issue: Issue = { rule_id: r.id, severity: r.severity, reason_code: code, message, suggested_repairs: r.repair };
      if (at.tile) issue.tile = at.tile;
      if (mod !== undefined && mod >= 0) { issue.module = mod; issue.template = f.modules[mod].provenance.template; }
      (r.severity === "error" ? errors : warnings).push(issue);
    };
    (CHECKS[r.check.op] as (f: WorldFacts, c: Check, e: Emit) => void)(f, r.check, emit);
    if (n > MAX_PER_RULE) (r.severity === "error" ? errors : warnings).push({ rule_id: r.id, severity: r.severity, reason_code: "MORE", message: `+${n - MAX_PER_RULE} benzer`, suggested_repairs: [] });
  }
  return { schema_version: REPORT_SCHEMA, scene_id: f.scene, case: caseName, tier: f.tier, hard_valid: errors.length === 0,
    commit_allowed: errors.length === 0, errors, warnings, overridden, checked, unverified };
}

