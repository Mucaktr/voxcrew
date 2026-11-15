/**
 * CITYLIFE (ürün sahibi 2026-10-28, B1) — **her geçiş belli olsun**: bütün girişlerin (sahne iç mekân kapıları, şehir haritası landmark
 * kapıları, iç mekân çıkış kapıları, merdiven/asansör bağları, ulaşım durağı turnikeleri, seyir/teras erişimleri) görünür geçit
 * efekti. Şehir kapısı ve "Ofise dön" karosu zaten `citymap/PortalRing.tsx` girdabını taşır; bu modül aynı dilde ama farklı görünen
 * küçük bir aile tanımlar:
 *
 * curtain iç mekâna giriş — parlayan kapı çerçevesi + ışık perdesi + zeminde paspas ışığı (turkuaz → mor; şehir geçidinin akrabası)
 * exit iç mekândan çıkış — aynı perde, sıcak gün ışığı (altın → turkuaz; "Ofise dön" halkasının akrabası)
 * lift asansör — kapı aralığında ince ışık yarığı + üstte "ding" lambası + paspas
 * stair merdiven — basamağa doğru akan ok şeritleri (zemin) + küçük yön lambası
 * turnstile durak — iki yanda yatay ışık çubukları (turnike) + paspas
 * terrace seyir/teras — ince ışık sütunu + zeminde yukarı ok şeritleri
 *
 * Saf modül (React/three yok): yalnız yerleşim ve renk/ölçü. Çizim `citylife/DoorFxLayer.tsx` (tek örneklenmiş dizi, toplamalı; hareket
 * azaltmada saat durur → durağan parıltı). Denetim: gerçekçilik kapısı REAL-PORTAL-002 (scripts/realism_check.mjs) her giriş türünde
 * efektin varlığını, yerini ve ölçüsünü; `scripts/citylife.test.mjs` aileyi sınar.
*/
import type { Tile } from "../scenes";

export const DOOR_FX_KINDS = ["curtain", "exit", "lift", "stair", "turnstile", "terrace"] as const;
export type DoorFxKind = (typeof DOOR_FX_KINDS)[number];

/** Giriş türü (denetim ve F istemi): hangi efekt ailesinden hangisinin beklendiği. */
export type EntranceKind = "interior" | "exit" | "stair" | "stop" | "lookout";
/** Giriş türü → kabul edilen efektler. */
export const ENTRANCE_FX: Readonly<Record<EntranceKind, readonly DoorFxKind[]>> = {
  interior: ["curtain"],
  exit: ["exit"],
  stair: ["stair", "lift"],
  stop: ["turnstile"],
  lookout: ["terrace"],
};

/** Efektin parçası (örnek): dikey perde, zemin paspası, lamba, turnike çubukları, ok şeritleri, ışık sütunu. */
export type FxPartShape = "curtain" | "mat" | "lamp" | "bars" | "chevrons" | "column";
export const FX_SHAPE_ID: Readonly<Record<FxPartShape, number>> = { curtain: 0, mat: 1, lamp: 2, bars: 3, chevrons: 4, column: 5 };

export interface FxStyle {
  /** iki renk (alt → üst ya da kenar → merkez) */
  a: string;
  b: string;
  /** perde/sütun boyu ve açıklık eni (dünya birimi; karo 1) */
  h: number;
  w: number;
  parts: readonly FxPartShape[];
}

export const FX_STYLE: Readonly<Record<DoorFxKind, FxStyle>> = {
  curtain: { a: "#38E1F5", b: "#A78BFA", h: 1.9, w: 0.86, parts: ["curtain", "mat"] },
  exit: { a: "#FFD36B", b: "#5EEAD4", h: 1.9, w: 0.86, parts: ["curtain", "mat"] },
  lift: { a: "#FDE68A", b: "#F59E0B", h: 1.8, w: 0.34, parts: ["curtain", "lamp", "mat"] },
  stair: { a: "#7DD3FC", b: "#E0F2FE", h: 0.5, w: 0.8, parts: ["chevrons", "lamp"] },
  turnstile: { a: "#34D399", b: "#A7F3D0", h: 1.0, w: 0.9, parts: ["bars", "mat"] },
  terrace: { a: "#FBBF24", b: "#FEF3C7", h: 1.6, w: 0.8, parts: ["column", "chevrons"] },
};

/** Bir girişin efekti (dünya koordinatı). `dir`: içeri/ileri yön (karo adımı; perde bu yöne dik durur). */
export interface DoorFx {
  id: string;
  kind: DoorFxKind;
  entrance: EntranceKind;
  x: number;
  z: number;
  /** zemin yüksekliği */
  y: number;
  dir: [number, number];
  /** girişin karosu (denetim) */
  tile: Tile;
  /** hedefin adı anahtarı (F istemi; çağıran çevirir) */
  target: string;
}

/** Örnek (çizim): biçim, merkez, ölçü (en, boy, derinlik — yerel), yön (rad, y ekseni), renkler. */
export interface FxPart { shape: FxPartShape; x: number; y: number; z: number; w: number; h: number; yaw: number; a: string; b: string; phase: number }

/** Perdenin kapı karosundaki ileri kayması (kapının yapı tarafı kenarına yakın; avatar perdeden geçerek girer). */
export const CURTAIN_PUSH = 0.42;

const yawOf = (d: readonly [number, number]) => Math.atan2(d[0], d[1]);

/** Efekti örneklere açar (saf; DoorFxLayer.tsx ve denetim aynı geometriyi kullanır). */
export function fxParts(f: DoorFx, out: FxPart[] = []): FxPart[] {
  const st = FX_STYLE[f.kind];
  const yaw = yawOf(f.dir);
  const ph = (Math.abs(Math.sin(f.x * 12.9898 + f.z * 78.233)) * 43758.5453) % 1;
  const push = (shape: FxPartShape, dx: number, dz: number, y: number, w: number, h: number, yw = yaw, a = st.a, b = st.b) =>
    out.push({ shape, x: f.x + dx, y: f.y + y, z: f.z + dz, w, h, yaw: yw, a, b, phase: ph });
  const fx = f.dir[0] * CURTAIN_PUSH, fz = f.dir[1] * CURTAIN_PUSH;
  for (const p of st.parts) {
    if (p === "curtain") push("curtain", fx, fz, st.h / 2, st.w, st.h);
    else if (p === "mat") push("mat", 0, 0, 0.04, 0.9, 0.9);
    else if (p === "lamp") {
      // lift: kapının üstünde "ding" lambası; stair: basamak ağzında küçük yön lambası
      if (f.kind === "lift") push("lamp", fx * 0.96, fz * 0.96, st.h + 0.18, 0.22, 0.22);
      else push("lamp", f.dir[1] * 0.4, -f.dir[0] * 0.4, 0.55, 0.16, 0.16);
    } else if (p === "bars") {
      // turnike: girişin iki yanında (dir'e dik eksende ±0,45) yatay ışık çubukları, yön boyunca uzanır
      const sx = f.dir[1], sz = -f.dir[0];
      for (const s of [-1, 1]) push("bars", sx * 0.45 * s, sz * 0.45 * s, st.h / 2, 0.8, st.h, yaw + Math.PI / 2);
    } else if (p === "chevrons") push("chevrons", 0, 0, 0.045, st.w, 0.9);
    else if (p === "column") push("column", 0, 0, st.h / 2, 0.34, st.h);
  }
  return out;
}

// ------------------------------------------------------------------------------------------ yerleşim üreticileri
const cx = (i: number) => i - 11.5;
const cz = (j: number) => j - 7.5;

/** Sahne iç mekân kapısı (scenePlaces doors; açık olanlar). `tile` taban koordinatı, `off` taban kayması. */
export function sceneDoorFx(doors: readonly { site: string; tile: Tile; dir: readonly [number, number]; open: boolean }[], off: Tile = [0, 0],
  yAt: (t: Tile) => number = () => 0): DoorFx[] {
  const out: DoorFx[] = [];
  for (const d of doors) {
    if (!d.open) continue;
    const t: Tile = [d.tile[0] + off[0], d.tile[1] + off[1]];
    out.push({ id: `door:${d.site}`, kind: "curtain", entrance: "interior", x: cx(t[0]), z: cz(t[1]), y: yAt(t), dir: [d.dir[0], d.dir[1]], tile: t, target: d.site });
  }
  return out;
}

/** Şehir haritası landmark kapısının içeri yönü (CityRig `onTile` ile aynı: kapıdan ayak izi merkezine). */
export function landmarkDoorDir(door: Tile, lm: { i0: number; j0: number; w: number; d: number }, plan: { i0: number; j0: number }): [number, number] {
  const cxL = plan.i0 + lm.i0 + (lm.w - 1) / 2, czL = plan.j0 + lm.j0 + (lm.d - 1) / 2;
  const ddx = door[0] - cxL, ddz = door[1] - czL;
  const out: [number, number] = Math.abs(ddx) > Math.abs(ddz) ? [Math.sign(ddx), 0] : [0, Math.sign(ddz) || 1];
  return [-out[0], -out[1]];
}

interface PlanLike {
  i0: number; j0: number; w: number; d: number;
  kind: Uint8Array; lift?: Float32Array;
  landmarks: readonly { id: string; i0: number; j0: number; w: number; d: number }[];
  doors: readonly { landmark: string; tile: Tile }[];
  stops: readonly { id: string; tile: Tile; board?: Tile }[];
  viewpoints: readonly Tile[];
}
interface DistrictLike { id: string; landmarks: readonly { id: string; interior?: string | null }[] }

/** Şehir haritası semti: iç mekânlı landmark kapıları (curtain), duraklar (turnstile), seyir noktaları (terrace). */
export function districtFx(cityId: string, dist: DistrictLike, plan: PlanLike): DoorFx[] {
  const out: DoorFx[] = [];
  const ground = (t: Tile) => {
    const li = t[0] - plan.i0, lj = t[1] - plan.j0;
    return plan.lift && li >= 0 && lj >= 0 && li < plan.w && lj < plan.d ? plan.lift[lj * plan.w + li] : 0;
  };
  for (const door of plan.doors) {
    const spec = dist.landmarks.find((l) => l.id === door.landmark);
    const lm = plan.landmarks.find((l) => l.id === door.landmark);
    if (!spec?.interior || !lm) continue;
    out.push({ id: `citylm:${cityId}:${dist.id}:${door.landmark}`, kind: "curtain", entrance: "interior", x: cx(door.tile[0]), z: cz(door.tile[1]), y: ground(door.tile),
      dir: landmarkDoorDir(door.tile, lm, plan), tile: door.tile, target: door.landmark });
  }
  for (const s of plan.stops) {
    const t = s.board ?? s.tile; // CABLEVP1: turnike biniş platformunda (teleferik uç durağı: halat ucundan ayrı)
    out.push({ id: `citystop:${cityId}:${s.id}`, kind: "turnstile", entrance: "stop", x: cx(t[0]), z: cz(t[1]), y: ground(t), dir: [0, 1], tile: t, target: s.id });
  }
  plan.viewpoints.forEach((v, k) => {
    out.push({ id: `cityvp:${cityId}:${dist.id}:${k + 1}`, kind: "terrace", entrance: "lookout", x: cx(v[0]), z: cz(v[1]), y: ground(v), dir: [0, 1], tile: v, target: dist.id });
  });
  return out;
}

interface LevelLike {
  site: string; kind: string; index: number;
  portals: readonly { id: string; tile: Tile; arrive: Tile }[];
  stairs: readonly { id: string; dir: "up" | "down"; tile: Tile; stand: Tile; run: readonly Tile[]; to: number }[];
  /** binilebilir asansör durakları (kapının önü → kapı)*/
  lifts?: readonly { id: string; tile: Tile; door: Tile; to: number }[];
  spots: readonly { id: string; kind: string; tile: Tile }[];
}
/**
 * İç kat: çıkış kapıları (exit), merdiven bağları (stair), asansör durakları (lift), seyir noktası (terrace). Katın kendi koordinatı (y 0).
 * (ürün sahibi 2026-10-31 "merdiven çıkma portalları yanlış yerde, asansöre binilmiyor"): eskiden kule/gökdelende merdiven bağı
 * "asansör" efektiyle (altın perde + "ding" lambası) merdivenin ayağında, aşağı bağ boşluğun ağzının üstünde havada duruyordu; gerçek
 * asansör kapısında efekt yoktu. Şimdi merdiven her yerde merdiven efekti: yukarı → ilk basamağın önü (ayak), aşağı → üst sahanlık
 * (merdivenin başı), ok şeritleri basamağa doğru; asansör efekti yalnız binilebilir asansör kapısının önünde, kapıya dönük.
*/
export function levelFx(lv: LevelLike): DoorFx[] {
  const out: DoorFx[] = [];
  for (const p of lv.portals) {
    // dışarı yön: varış karosundan (içeri komşu) kapı karosuna
    const d: [number, number] = [Math.sign(p.tile[0] - p.arrive[0]), Math.sign(p.tile[1] - p.arrive[1])];
    const dir: [number, number] = d[0] === 0 && d[1] === 0 ? [0, -1] : d;
    out.push({ id: `portal:${p.id}`, kind: "exit", entrance: "exit", x: cx(p.tile[0]), z: cz(p.tile[1]), y: 0, dir, tile: p.tile, target: lv.site });
  }
  for (const s of lv.stairs) {
    const at = s.stand;
    const n = s.run.length;
    const nxt = n ? (s.dir === "up" ? s.run[0] : s.run[Math.max(0, n - 2)]) : at;
    const d: [number, number] = [Math.sign(nxt[0] - at[0]), Math.sign(nxt[1] - at[1])];
    const dir: [number, number] = d[0] === 0 && d[1] === 0 ? [0, 1] : (d[0] !== 0 && d[1] !== 0 ? [d[0], 0] : d);
    out.push({ id: `stair:${s.id}`, kind: "stair", entrance: "stair", x: cx(at[0]), z: cz(at[1]), y: 0, dir, tile: at, target: `${s.to}` });
  }
  for (const l of lv.lifts ?? []) {
    const dir: [number, number] = [Math.sign(l.door[0] - l.tile[0]), Math.sign(l.door[1] - l.tile[1])];
    out.push({ id: `lift:${l.id}`, kind: "lift", entrance: "stair", x: cx(l.tile[0]), z: cz(l.tile[1]), y: 0, dir, tile: l.tile, target: `${l.to}` });
  }
  for (const s of lv.spots) if (s.kind === "vp") out.push({ id: `vp:${lv.site}`, kind: "terrace", entrance: "lookout", x: cx(s.tile[0]), z: cz(s.tile[1]), y: 0, dir: [0, 1], tile: s.tile, target: lv.site });
  return out;
}

// ------------------------------------------------------------------------------------------ denetim çekirdeği (REAL-PORTAL-002)
export interface EntranceRow { id: string; kind: EntranceKind; tile: Tile }
export interface FxIssue { id: string; kind: EntranceKind; tile: Tile; why: string }

/**
 * Her girişin efekti var mı: aynı karoda (≤ 0,6) kabul edilen türden bir efekt, en az bir görünür parça (perde/sütun ≥ 1,2 boy ya da
 * çubuk ≥ 0,8; paspas/ok ≥ 0,6 en) ve F istemi (`prompt(id)` boş değil, hedef adını taşır). Saf; self-test realism_check.test.mjs.
 */
export function entranceFxIssues(rows: readonly EntranceRow[], fx: readonly DoorFx[], prompt: (id: string) => string | null): FxIssue[] {
  const issues: FxIssue[] = [];
  for (const r of rows) {
    const want = ENTRANCE_FX[r.kind];
    const ex = cx(r.tile[0]), ez = cz(r.tile[1]);
    const hit = fx.find((f) => want.includes(f.kind) && Math.hypot(f.x - ex, f.z - ez) <= 0.6);
    if (!hit) { issues.push({ ...r, why: `efekt yok (beklenen: ${want.join("/")})` }); continue; }
    const parts = fxParts(hit);
    const tall = parts.some((p) => (p.shape === "curtain" || p.shape === "column") && p.h >= 1.2) || parts.some((p) => p.shape === "bars" && p.w >= 0.8);
    const floor = parts.some((p) => (p.shape === "mat" || p.shape === "chevrons") && p.w >= 0.6);
    if (!tall && !floor) issues.push({ ...r, why: "efekt görünmez (perde/sütun/çubuk ya da zemin ışığı yok)" });
    else if (r.kind !== "stair" && !tall) issues.push({ ...r, why: "efektin dikey parçası yok (yalnız zemin)" });
    const p = prompt(r.id);
    if (!p || !p.trim()) issues.push({ ...r, why: "F istemi yok" });
  }
  return issues;
}
