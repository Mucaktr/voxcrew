/**
 * S48 — eğlenceli hareketler ve şakşak (kalabalığın tek useFrame döngüsünden çağrılır; Crowd.tsx).
 *
 * Boştaki ajanlar (koşu arası, "✓ bitti" sonrası) ara sıra sahneye uygun bir eğlence seçer: dans (tek/ikili), olta (gölet
 * kıyısı, iskele, kumsal, deniz kenarı), masa tenisi (alçak masa, iki oyuncu), tavla/dama (W2-INT: oturarak, sessiz), kâğıt uçak, hokkabazlık, top sektirme ya da pas
 * (park/sahil/okul bahçesi/kamp), frizbi (sahil/park), kartopu (karlı köy), sandalyede dönme, yoga. Bir koşu başarıyla bitince
 * ekip arkadaşıyla çak bir beşlik; ekipten üç kişi kısa sürede bitirirse zafer dansı + konfeti.
 * Yoğun koşularda (görünenlerin ≥ %30'u çalışırken, yakında yürüyenler karşılaşınca) ara sıra iki yürüyen çarpışır: sendeleme ya da popo üstü düşme, toz bulutu ve
 * yıldızlar, sonra kalkıp yoluna devam eder (yolu korunur, kimseyi engellemez).
 *
 * Kurallar: gerçek iş her zaman kazanır (ruh hâli değişince eğlence o karede biter); onay bekleyen el sallamaya devam eder,
 * çarpışmaya katılmaz ve yanında (3 birim) çarpışma olmaz; konuşmadaki (balonlu) ajan eğlenceye/şakşağa katılmaz. Aynı anda en çok 3
 * ("Az": 1) eğlence, en çok bir çarpışma. Ajan başına seyrek ve rastgele. Hareket azaltmada eğlence ve şakşak yok.
 */
import type * as THREE from "three";
import type { FunLevel } from "../../components/world/viewSettings";
import type { Motion } from "../Character";
import type { Pose } from "../parts";
import { HOOP_RIM_Y, key, tileOf, type Built, type Station, type Tile, tx, tz } from "../scenes";
import type { WorldAgent } from "../World";
import { box, burst, C, seg, type FxState } from "./fx";
import { pairSpots, sites, type FishSpot, type PlayTable } from "./sites";
import { rainLevel } from "../props/weather";
import { domeY, headTopOf, UMB_DOME } from "../umbrella";
import { FULL_SNOWBALL_KITS } from "../../full/funBrain";

export type FunKind = "dance" | "duoDance" | "fish" | "pingpong" | "board" | "toss" | "hoop" | "volley" | "umbrella" | "feed" | "plane" | "planeToss" | "juggle" | "kickups" | "pass" | "snowball" | "frisbee"
  | "spin" | "yoga" | "highfive";

export interface Fun {
  kind: FunKind;
  a: FunCh; b: FunCh | null;
  spotA: Tile; spotB: Tile | null; faceA: number; faceB: number;
  phase: "go" | "play";
  born: number; t0: number; until: number; period: number;
  claims: string[];
  motA: Motion; motB: Motion;
  fish: FishSpot | null; table: PlayTable | null;
  /** olta: sonraki yakalama anı ve evresi (0 bekle · 1 çek · 2 balık uçuyor · 3 sevinç · 4 bırak) */
  catchAt: number; cp: number; cpT: number;
  lastPh: number; emitAt: number; spun: boolean;
}

export interface Bump { t0: number; until: number; fall: boolean; dizzy: boolean }

/** Eğlencenin kalabalıktan okuduğu/yazdığı alanlar (Crowd.tsx `Ch` bunları taşır). */
export interface FunCh {
  slug: string; index: number; wa: WorldAgent; pos: THREE.Vector3; facing: number; path: Tile[]; goal: Tile | null;
  meet: unknown; errand: unknown; lod: "near" | "far" | "off"; seed: number; scale: number; pose: Pose;
  /** WALK-SCALE: çizim ölçek çarpanı ve kaldırması (yürüme modunda; Crowd writeChar yazar) */
  hs?: number; lift?: number;
  idleSince: number; doneUntil: number;
  fun: Fun | null; nextFun: number; bump: Bump | null; victoryUntil: number; fmood: string;
  /** W3 (WALK-FUN): hediye gösterisi / ekip yemeği sürerken yeni eğlence başlamaz (gifts.ts) */
  gift?: unknown; feast?: unknown;
}

/** Eğlencenin plan alanları (Crowd.tsx `AgentPlan`). */
export interface FunPlan { station: Station; shared: boolean; idle: Tile }

export interface FunWorld {
  funs: Set<Fun>;
  scanAt: number; bumpAt: number; nextBump: number; bumpUntil: number;
  done: { ch: FunCh; t: number }[];
  victoryAt: Map<string, number>;
  wasOff: boolean;
  /** dünya değişince (yeniden pişirme) süren eğlenceler bırakılır: talepler yeni dünyaya taşınmaz */
  built: Built | null;
  /** ölçüm/inceleme: toplam çarpışma ve sonuncusunun yeri */
  bumps: number; lastBump: { x: number; z: number; t: number } | null; walkers: number; minGap: number;
}

export function createFunWorld(): FunWorld {
  return { funs: new Set(), scanAt: 0, bumpAt: 0, nextBump: 20, bumpUntil: 0, done: [], victoryAt: new Map(), wasOff: false, built: null, bumps: 0, lastBump: null, walkers: 0, minGap: 99 };
}

/**
 * Sakin bölge süzgeci (SP-W0 ibadet yerleri için `isInSacredBuffer(tile)` bağlanacak): true dönen karoda ya da 3 karo yakınında
 * eğlence, şakşak ve ortam şakası yok. Varsayılan: hiçbir yer kapalı değil. Ortam tepkileri (Ambient.tsx) de bunu okur.
 */
let quietZone: (tile: Tile) => boolean = () => false;
export function setQuietZone(fn: ((tile: Tile) => boolean) | null) { quietZone = fn ?? (() => false); }
export function inQuietZone(x: number, z: number): boolean { return quietZone(tileOf(x, z)); }

const INDOOR = new Set(["office", "home", "cafe", "mall", "school", "space"]);
const BALL_KITS = new Set(["park", "beach", "school", "camp", "battlefield", "sea"]);
const FRISBEE_KITS = new Set(["beach", "park", "camp", "sea"]);
const PLANE_KITS = new Set(["office", "home", "cafe", "mall", "school", "space", "park", "camp"]);
const R = Math.random;
const rr = (a: number, b: number) => a + R() * (b - a);
const TAU = Math.PI * 2;

const funMood = (m: string) => m === "idle" || m === "done";
const needsYou = (c: FunCh) => c.wa.mood === "waiting" || !!c.wa.work?.awaiting;
const capOf = (level: FunLevel) => (level === "few" ? 1 : 3);
const gapOf = (level: FunLevel) => (level === "few" ? rr(120, 300) : rr(45, 120));

/** Ajanın elinin dünya konumu (duruştan; kemik matrisi kurmadan). */
const HAND = { x: 0, y: 0, z: 0 };
export function handPos(ch: FunCh, right: boolean, out = HAND) {
  // WALK-SCALE: el konumu çizim ölçeğini izler (yürüme modunda karakterler küçülür; eldeki eşya elde kalır)
  const p = ch.pose, k = (ch.scale * (ch.hs ?? 1)) / 16;
  const a = right ? p.ra : p.la, az = right ? p.raz : p.laz;
  let x = 7 * Math.sin(az), y = -7 * Math.cos(az), z = 0;
  const y2 = y * Math.cos(a) - z * Math.sin(a), z2 = y * Math.sin(a) + z * Math.cos(a);
  x += right ? 5.25 : -5.25; y = y2 + 13.5 + p.by; z = z2;
  const y3 = y * Math.cos(p.rx) - z * Math.sin(p.rx), z3 = y * Math.sin(p.rx) + z * Math.cos(p.rx);
  y = y3 + p.ry; z = z3 + p.fz;
  const c = Math.cos(ch.facing), s = Math.sin(ch.facing);
  out.x = ch.pos.x + (x * c + z * s) * k; out.y = ch.pos.y + (ch.lift ?? 0) + y * k; out.z = ch.pos.z + (-x * s + z * c) * k;
  return out;
}

const tileD = (a: Tile, b: Tile) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
const tileOfPos = (c: FunCh): Tile => tileOf(c.pos.x, c.pos.z);

// ------------------------------------------------------------------ yaşam döngüsü
export function endFun(fw: FunWorld, f: Fun, t: number, claims: Set<string>, level: FunLevel) {
  for (const c of [f.a, f.b]) {
    if (!c || c.fun !== f) continue;
    c.fun = null; c.nextFun = t + gapOf(level); c.idleSince = t; c.path = []; c.goal = null;
  }
  for (const k of f.claims) claims.delete(k);
  f.claims.length = 0;
  fw.funs.delete(f);
}

/** Kalabalıktan çıkan ajan (silinme/yeniden kurulum). */
export function dropFunChar(fw: FunWorld, ch: FunCh, claims: Set<string>) {
  if (ch.fun) endFun(fw, ch.fun, 0, claims, "on");
  ch.bump = null;
}

function newFun(kind: FunKind, a: FunCh, b: FunCh | null, spotA: Tile, spotB: Tile | null, faceA: number, faceB: number, t: number, dur: number,
  period: number, claims: Set<string>, claimList: string[]): Fun {
  for (const k of claimList) claims.add(k);
  return { kind, a, b, spotA, spotB, faceA, faceB, phase: "go", born: t, t0: 0, until: dur, period, claims: claimList, motA: "idle", motB: "idle",
    fish: null, table: null, catchAt: 0, cp: 0, cpT: 0, lastPh: 0, emitAt: 0, spun: false };
}

/** Yerel evre (0–1): A 0'da vurur/atar, B 0,5 kayıklıkla. */
export function funPhase(ch: FunCh, t: number): number {
  const f = ch.fun;
  if (!f || f.phase !== "play") return 0;
  const ph = (((t - f.t0) / f.period) % 1 + 1) % 1;
  return f.b === ch ? (ph + 0.5) % 1 : ph;
}

/** Çarpışma duruşu: önce sendeler, düşen popo üstü oturur, sonunda kalkar. */
export function bumpMotion(b: Bump, t: number): Motion {
  const u = t - b.t0;
  if (!b.fall) return "stagger";
  if (u < 0.22) return "stagger";
  return t < b.until - 0.4 ? "fall" : "idle";
}

// ------------------------------------------------------------------ kare adımı
export interface FunEnv {
  list: FunCh[]; plans: FunPlan[]; built: Built; kit: string; oceanY: number | null; claims: Set<string>;
  t: number; dt: number; fx: FxState; level: FunLevel; calm: boolean; camX: number; camZ: number;
  /** W2-INT: sahnede yağmur yağıyor (hava durumu açık ve `def.weather` yağmur) — şemsiye anı */
  rain?: boolean;
  /** W2-INT: sahne saati (SceneFx ile aynı `clock.elapsedTime`; aralıklı yağmur evresi) */
  clock?: number;
}

export function stepFun(fw: FunWorld, env: FunEnv): number {
  const { list, claims, t, level, calm } = env;
  const off = level === "off" || calm;
  if (fw.built !== env.built) {
    for (const f of fw.funs) { if (f.a.fun === f) f.a.fun = null; if (f.b?.fun === f) f.b.fun = null; }
    fw.funs.clear();
    fw.built = env.built;
  }
  if (off) {
    if (!fw.wasOff) {
      for (const f of fw.funs) endFun(fw, f, t, claims, level);
      if (calm) for (const c of list) c.bump = null;
      fw.wasOff = true;
    }
  } else fw.wasOff = false;

  // ruh hâli geçişleri: iş gelince eğlence biter; "✓ bitti" çak bir beşlik / zafer dansını tetikler
  for (const c of list) {
    const m = c.wa.mood;
    if (m !== c.fmood) {
      const was = c.fmood;
      c.fmood = m;
      if (c.fun && !funMood(m)) endFun(fw, c.fun, t, claims, level);
      if (c.bump && (m === "waiting" || m === "offline")) c.bump = null;
      if (!off && m === "done" && (was === "working" || was === "thinking" || was === "waiting")) onDone(fw, env, c);
    }
    if (c.fun && c.meet) endFun(fw, c.fun, t, claims, level);
    if (c.bump && t > c.bump.until) c.bump = null;
  }
  if (off) return 0;

  for (const f of fw.funs) updateFun(fw, env, f);

  // yeni eğlence: ≈ 2 Hz tarama, tavan altında
  const bumping = fw.bumpUntil > t ? 1 : 0;
  if (t > fw.scanAt) {
    fw.scanAt = t + 0.5;
    if (fw.funs.size + bumping < capOf(level)) tryStart(fw, env);
  }
  // şakşak: ≈ 3 Hz
  if (t > fw.bumpAt) { fw.bumpAt = t + 0.3; tryBump(fw, env); }
  return fw.funs.size + (fw.bumpUntil > t ? 1 : 0);
}

function idleReady(c: FunCh, t: number) {
  return c.lod === "near" && funMood(c.wa.mood) && t > c.doneUntil && t > c.victoryUntil && !c.fun && !c.meet && !c.errand && !c.bump && !c.path.length
    && !c.gift && !c.feast;
}

function onDone(fw: FunWorld, env: FunEnv, c: FunCh) {
  const { t, fx, level } = env;
  fw.done = fw.done.filter((d) => t - d.t < 10 && d.ch !== c);
  fw.done.push({ ch: c, t });
  if (c.lod !== "near" || c.meet || inQuietZone(c.pos.x, c.pos.z)) return;
  const team = c.wa.agent.team ?? "";
  const mates = fw.done.filter((d) => (d.ch.wa.agent.team ?? "") === team && d.ch.lod === "near" && !d.ch.meet && d.ch.wa.mood === "done");
  // ekipten 3+ kişi 10 sn içinde bitirdi → zafer dansı (ekip başına en çok 40 sn'de bir)
  if (team && mates.length >= 3 && t - (fw.victoryAt.get(team) ?? -99) > 40) {
    fw.victoryAt.set(team, t);
    for (const d of mates) {
      d.ch.victoryUntil = t + (level === "few" ? 2.6 : 3.6);
      burst(fx, "confetti", d.ch.pos.x, d.ch.pos.y + 1.9 * d.ch.scale, d.ch.pos.z, d.ch.scale);
    }
    return;
  }
  // çak bir beşlik: yakında (≤ 10 karo) kısa süre önce bitiren bir arkadaş
  if (fw.funs.size + (fw.bumpUntil > t ? 1 : 0) >= capOf(level) || R() > (level === "few" ? 0.35 : 0.7)) return;
  const me = tileOfPos(c);
  const mate = fw.done.find((d) => d.ch !== c && !d.ch.fun && !d.ch.meet && d.ch.lod === "near" && funMood(d.ch.wa.mood)
    && (!team || (d.ch.wa.agent.team ?? "") === team) && tileD(tileOfPos(d.ch), me) <= 10);
  if (!mate || c.fun) return;
  const s = sites(env.built, env.oceanY);
  const o = tileOfPos(mate.ch);
  const ps = pairSpots(s, env.built, env.claims, Math.round((me[0] + o[0]) / 2), Math.round((me[1] + o[1]) / 2), 1);
  if (!ps) return;
  const f = newFun("highfive", c, mate.ch, ps[0], ps[1], ps[2], ps[3], t, 1.5, 1.5, env.claims, [key(...ps[0]), key(...ps[1])]);
  c.fun = f; mate.ch.fun = f; fw.funs.add(f);
}

/** Geliştirme/ekran görüntüsü: belirli ajanla belirli eğlenceyi hemen başlatır (tavan ve sıklık yok sayılır). */
export function forceFun(fw: FunWorld, env: FunEnv, kind: FunKind, a: FunCh, b: FunCh | null): boolean {
  if (a.fun) endFun(fw, a.fun, env.t, env.claims, env.level);
  if (b?.fun) endFun(fw, b.fun, env.t, env.claims, env.level);
  return tryStart(fw, env, { kind, a, b });
}

function tryStart(fw: FunWorld, env: FunEnv, force?: { kind: FunKind; a: FunCh; b: FunCh | null }): boolean {
  const { list, plans, t, kit, built, claims, level } = env;
  const n = list.length;
  if (!n) return false;
  const off0 = Math.floor(R() * n);
  let a: FunCh | null = force?.a ?? null;
  for (let k = 0; k < n && !a; k++) {
    const c = list[(off0 + k) % n];
    if (t > c.nextFun && idleReady(c, t) && plans[c.index] && !inQuietZone(c.pos.x, c.pos.z)) { a = c; break; }
  }
  if (!a || !plans[a.index]) return false;
  a.nextFun = t + gapOf(level) * 0.5; // seçim başarısız olsa da hemen yeniden denemesin
  const p = plans[a.index];
  const s = sites(built, env.oceanY);
  const me = tileOfPos(a);
  const indoor = INDOOR.has(kit);
  const opts: [FunKind, number][] = [["dance", 2], ["juggle", 1.2], ["yoga", 1.1]];
  if (PLANE_KITS.has(kit) || !kit) opts.push(["plane", 1.2]);
  if (BALL_KITS.has(kit)) opts.push(["kickups", 1.2]);
  const seat = (p.station as Station & { pose?: string }).pose ?? "sit_chair";
  if (indoor && !p.shared && seat === "sit_chair" && tileD(me, p.station.tile) === 0) opts.push(["spin", 2]);
  // olta: istasyona ≤ 18 karo, boş
  let fish: FishSpot | null = null, fd = force ? 1e9 : 19;
  for (const f of s.fishing) {
    if (f.feedOnly) continue; // W2-INT: yalnız besleme noktası (olta yok)
    const d = tileD(f.tile, p.station.tile);
    if (d < fd && !claims.has(key(...f.tile))) { fd = d; fish = f; }
  }
  if (fish) opts.push(["fish", 3.5]);
  // W2-INT: ördek/balık besleme — yalnız gölete bakan kıyı noktaları (deniz değil)
  let feed: FishSpot | null = null, ed = force ? 1e9 : 19;
  for (const f of s.fishing) {
    if (!f.pond) continue;
    const d = tileD(f.tile, p.station.tile);
    if (d < ed && !claims.has(key(...f.tile))) { ed = d; feed = f; }
  }
  if (feed) opts.push(["feed", 2.2]);
  // W2-INT: yağmurda (dış mekân) şemsiye açıp bekleme
  if (env.rain && !indoor && (force || rainLevel(env.clock ?? t) > 0.3)) opts.push(["umbrella", 3]);
  // ikili: yakında hazır bir eş
  let b: FunCh | null = force?.b ?? null, bd = 13;
  for (const c of list) {
    if (b || c === a || !(t > c.nextFun - 30) || !idleReady(c, t)) continue;
    const d = tileD(tileOfPos(c), me);
    if (d < bd) { bd = d; b = c; }
  }
  let table: PlayTable | null = null;
  if (b) {
    opts.push(["duoDance", 1.5]);
    const o = tileOfPos(b), mid: Tile = [Math.round((me[0] + o[0]) / 2), Math.round((me[1] + o[1]) / 2)];
    let td = force ? 1e9 : 15;
    for (const tb of s.tables) {
      const d = tileD(tb.a, mid);
      if (d < td && !claims.has(key(...tb.a)) && !claims.has(key(...tb.b))) { td = d; table = tb; }
    }
    // W2-INT: masa oyunu masası (tavla/dama; `play` kancası r = PLAY_BOARD) sessiz oyun, diğer masalar masa tenisi
    // W2b-INT: atma oyunu (pétanque `toss`, sokak potası `hoop`; `play` kancası r = PLAY_TOSS / PLAY_HOOP)
    if (table) opts.push([table.board ? "board" : table.game ?? "pingpong", 3]);
    if (PLANE_KITS.has(kit) || !kit) opts.push(["planeToss", indoor ? 2.2 : 1]);
    if (BALL_KITS.has(kit)) opts.push(["pass", 2]);
    if (FRISBEE_KITS.has(kit)) opts.push(["frisbee", 2]);
    if (kit === "snow" || FULL_SNOWBALL_KITS.has(kit)) opts.push(["snowball", 4]); // W3a-INT: Aurora kartopu
  }
  let sum = 0;
  for (const o of opts) sum += o[1];
  let pick = R() * sum;
  let kind: FunKind = "dance";
  for (const o of opts) { pick -= o[1]; if (pick <= 0) { kind = o[0]; break; } }
  if (force) { if (!opts.some((o) => o[0] === force.kind)) return false; kind = force.kind; }

  const few = level === "few";
  const L = (lo: number, hi: number) => rr(lo, hi) * (few ? 0.75 : 1);
  const face = Math.atan2(env.camX - a.pos.x, env.camZ - a.pos.z);
  let f: Fun | null = null;
  const solo = (k: FunKind, dur: number, period: number) => {
    // ayakta, masanın önünden bir adım öteye (masaya/duvara doğru atmasın); yüz kameraya dönük
    const sp = pairSpots(s, built, claims, me[0], me[1], 0);
    if (!sp) return null;
    return newFun(k, a!, null, sp[0], null, face, 0, t, dur, period, claims, [key(...sp[0])]);
  };
  switch (kind) {
    case "spin": f = newFun("spin", a, null, p.station.tile, null, p.station.face, 0, t, 2.6, 2.6, claims, []); break;
    case "fish": {
      f = newFun("fish", a, null, fish!.tile, null, fish!.face, 0, t, L(16, 26), 1, claims, [key(...fish!.tile)]);
      f.fish = fish;
      break;
    }
    case "dance": f = solo("dance", L(7, 10), 1); break;
    case "umbrella": f = solo("umbrella", L(9, 14), 4); break;
    case "feed": {
      f = newFun("feed", a, null, feed!.tile, null, feed!.face, 0, t, L(8, 12), 2.4, claims, [key(...feed!.tile)]);
      f.fish = feed;
      break;
    }
    case "juggle": f = solo("juggle", L(6, 8), 1); break;
    case "yoga": f = solo("yoga", 8, 8); break;
    case "plane": f = solo("plane", 6.4, 3.2); break;
    case "kickups": f = solo("kickups", L(5, 7), 0.75); break;
    default: {
      if (!b) break;
      const o = tileOfPos(b);
      if (kind === "pingpong" && table) {
        f = newFun("pingpong", a, b, table.a, table.b, table.faceA, table.faceB, t, L(9, 13), 1.1, claims, [key(...table.a), key(...table.b)]);
        f.table = table;
        break;
      }
      if (kind === "board" && table) {
        // karşılıklı oturur; sırayla taş sürer (periyot = iki hamle)
        f = newFun("board", a, b, table.a, table.b, table.faceA, table.faceB, t, L(14, 22), 3.2, claims, [key(...table.a), key(...table.b)]);
        f.table = table;
        break;
      }
      if ((kind === "toss" || kind === "hoop" || kind === "volley") && table) {
        // W2b-INT: ikisi ayakta, sırayla atar (periyot = iki atış); pétanque sessiz, raket/masa yok
        f = newFun(kind, a, b, table.a, table.b, table.faceA, table.faceB, t, L(14, 20), kind === "toss" ? 4.4 : kind === "volley" ? 3.0 : 3.6, claims, [key(...table.a), key(...table.b)]);
        f.table = table;
        break;
      }
      const gap = kind === "duoDance" ? 1 : kind === "pass" || kind === "planeToss" ? 3 : 4;
      const ps = pairSpots(s, built, claims, Math.round((me[0] + o[0]) / 2), Math.round((me[1] + o[1]) / 2), gap);
      if (!ps) { f = solo("dance", L(7, 10), 1); break; }
      const dur = kind === "duoDance" ? L(8, 11) : kind === "pass" ? L(8, 11) : kind === "frisbee" ? 10.4 : 9.6;
      const period = kind === "pass" ? 2 : kind === "frisbee" || kind === "planeToss" ? 2.6 : kind === "snowball" ? 2.4 : 1;
      f = newFun(kind, a, b, ps[0], ps[1], ps[2], ps[3], t, dur, period, claims, [key(...ps[0]), key(...ps[1])]);
    }
  }
  if (!f) return false;
  // sakin bölgedeki yerlere gidilmez (ikili ve olta yerleri dahil)
  const bad = (tl: Tile | null) => !!tl && quietZone(tl);
  if (bad(f.spotA) || bad(f.spotB)) { for (const k of f.claims) claims.delete(k); return false; }
  a.fun = f;
  if (f.b) f.b.fun = f;
  fw.funs.add(f);
  return true;
}

const arrived = (c: FunCh, tile: Tile) => !c.path.length && Math.hypot(c.pos.x - tx(tile[0]), c.pos.z - tz(tile[1])) < 0.14;

function updateFun(fw: FunWorld, env: FunEnv, f: Fun) {
  const { t, claims, level, fx } = env;
  // geçerlilik: iki taraf da hâlâ bu eğlencede ve boşta
  const bad = (c: FunCh | null) => !!c && (c.fun !== f || !funMood(c.wa.mood) || !!c.meet);
  if (bad(f.a) || bad(f.b)) { endFun(fw, f, t, claims, level); return; }
  // W2b-INT: şemsiye anı yağmur dinince ≈ 1,5 sn içinde biter (yağmur kapandıysa ya da döngünün kuru evresindeyse; yoldaysa hemen)
  if (f.kind === "umbrella" && (!env.rain || rainLevel(env.clock ?? t) < 0.06)) {
    if (f.phase === "go") { endFun(fw, f, t, claims, level); return; }
    f.until = Math.min(f.until, t + 1.5);
  }
  if (f.phase === "go") {
    const readyA = arrived(f.a, f.spotA) && t > f.a.doneUntil, readyB = !f.b || (arrived(f.b, f.spotB!) && t > f.b.doneUntil);
    if (readyA && readyB) { f.phase = "play"; f.t0 = t; f.until = t + f.until; f.catchAt = t + rr(3.5, 7); f.emitAt = t; f.lastPh = 0; }
    else if (t - f.born > 16) endFun(fw, f, t, claims, level);
    return;
  }
  if (t > f.until) { endFun(fw, f, t, claims, level); return; }
  const a = f.a, b = f.b;
  const ph = (((t - f.t0) / f.period) % 1 + 1) % 1;
  const show = a.lod !== "off" || (b && b.lod !== "off");
  switch (f.kind) {
    case "dance": case "duoDance":
      f.motA = "dance"; f.motB = "dance";
      if (t > f.emitAt) {
        f.emitAt = t + 0.8;
        burst(fx, "notes", a.pos.x, a.pos.y + 1.95 * a.scale, a.pos.z, a.scale);
        if (b) burst(fx, "notes", b.pos.x, b.pos.y + 1.95 * b.scale, b.pos.z, b.scale);
      }
      break;
    case "juggle": {
      f.motA = "juggle";
      if (!show) break;
      const fwdx = Math.sin(a.facing), fwdz = Math.cos(a.facing), sx = Math.cos(a.facing), sz = -Math.sin(a.facing);
      const cx = a.pos.x + fwdx * 0.3 * a.scale, cz = a.pos.z + fwdz * 0.3 * a.scale, cy = a.pos.y + 1.2 * a.scale;
      for (let i = 0; i < 3; i++) {
        const th = t * TAU * 1.5 + (i * TAU) / 3;
        const bx = cx + sx * Math.cos(th) * 0.16 * a.scale, bz = cz + sz * Math.cos(th) * 0.16 * a.scale, by = cy + Math.sin(th) * 0.26 * a.scale;
        box(fx, bx, by, bz, 0.07, 0.07, 0.07, th, 0, 0, i === 0 ? C.paddle : i === 1 ? C.yellow : C.blue);
      }
      break;
    }
    case "yoga": f.motA = "yoga"; break;
    case "spin": {
      f.motA = "spin";
      if (!f.spun) { f.spun = true; }
      break;
    }
    case "kickups": {
      f.motA = "kick";
      if (!show) break;
      const fwdx = Math.sin(a.facing), fwdz = Math.cos(a.facing);
      const y = a.pos.y + 0.12 + 0.8 * Math.sin(Math.PI * ph) * a.scale;
      box(fx, a.pos.x + fwdx * 0.26 * a.scale, y, a.pos.z + fwdz * 0.26 * a.scale, 0.15, 0.15, 0.15, t * 6, t * 4, 0, C.white);
      break;
    }
    case "plane": {
      f.motA = "toss";
      if (!show) break;
      const h = handPos(a, true);
      const fwdx = Math.sin(a.facing), fwdz = Math.cos(a.facing);
      if (ph < 0.06 || ph > 0.84) {
        if (ph > 0.84 || ph < 0.02) paperPlane(fx, h.x, h.y + 0.05, h.z, a.facing, 0);
      } else {
        const u = Math.min(1, (ph - 0.06) / 0.62);
        if (!f.spun) { f.spun = true; f.lastPh = h.y; }
        const y0 = Math.max(0.9, f.lastPh);
        const x = a.pos.x + fwdx * (0.3 + 3.2 * u) + Math.cos(a.facing) * Math.sin(Math.PI * u) * 0.5;
        const z = a.pos.z + fwdz * (0.3 + 3.2 * u) - Math.sin(a.facing) * Math.sin(Math.PI * u) * 0.5;
        const y = u < 1 ? y0 + 0.4 * Math.sin(Math.PI * u * 0.9) - (y0 - 0.06) * u * u : 0.06;
        paperPlane(fx, x, y, z, a.facing + Math.cos(Math.PI * u) * 0.4, u < 1 ? 0.25 * u : 0);
        if (ph > 0.8) f.spun = false;
      }
      break;
    }
    case "fish": updateFishing(f, env, ph); break;
    case "board": updateBoard(f, env, ph); break;
    case "toss": case "hoop": updateToss(f, env, ph); break;
    case "volley": updateVolley(f, env, ph); break;
    case "umbrella": updateUmbrella(f, env); break;
    case "feed": updateFeed(f, env, ph); break;
    case "pingpong": case "pass": case "frisbee": case "snowball": case "planeToss": updateDuo(f, env, ph); break;
    case "highfive": {
      f.motA = "highfive"; f.motB = "highfive";
      if (ph > 0.45 && f.lastPh <= 0.45 && b) {
        const h1 = handPos(a, true), x = h1.x, y = h1.y, z = h1.z;
        const h2 = handPos(b, true);
        burst(fx, "stars", (x + h2.x) / 2, Math.max(y, h2.y) + 0.05, (z + h2.z) / 2, a.scale);
      }
      f.lastPh = ph;
      break;
    }
  }
}

function paddle(fx: FxState, c: FunCh) {
  const h = handPos(c, true);
  box(fx, h.x, h.y + 0.02, h.z, 0.03, 0.16, 0.13, c.facing + Math.PI / 2, 0, 0, C.paddle);
}

/** W2-INT — sessiz masa oyunu: sırası gelen elindeki taşı tahtaya sürer (küçük kavis); ses, raket, top yok. */
function updateBoard(f: Fun, env: FunEnv, ph: number) {
  f.motA = "board"; f.motB = "board";
  const a = f.a, b = f.b!, tb = f.table!;
  if (a.lod === "off" && b.lod === "off") return;
  const mover = ph < 0.5 ? a : b, u = (ph % 0.5) / 0.5;
  if (u < 0.12 || u > 0.62) return;
  // taş elden tahtaya: eldeki konumdan masanın ortasına yakın bir göze kısa bir kavis
  const h = handPos(mover, true);
  const v = (u - 0.12) / 0.5, side = mover === a ? -1 : 1;
  const ex = tb.x + side * 0.12 + Math.sin(f.t0 + Math.floor((env.t - f.t0) / f.period)) * 0.18, ez = tb.z + Math.cos(f.t0 * 3) * 0.1, ey = tb.y + 0.11;
  const x = h.x + (ex - h.x) * v, z = h.z + (ez - h.z) * v, y = h.y + (ey - h.y) * v + Math.sin(Math.PI * v) * 0.08;
  box(env.fx, x, y, z, 0.07, 0.025, 0.07, 0, 0, 0, mover === a ? C.white : C.brown);
}

/** W2b-INT — atma oyunu. Her oyuncu kendi evresinde (A 0, B 0,5) atar. `toss` (pétanque): alttan atış, top alçak kavisle
 *  hedef karonun önüne düşer, yanından yuvarlanıp durur ve bir sonraki atışına kadar orada kalır; ses/parıltı yok.
 *  `hoop` (sokak potası): top kavisle çembere (kanca karosu ortası, HOOP_RIM_Y) gider, içinden düşer, atana doğru seker. */
function updateToss(f: Fun, env: FunEnv, ph: number) {
  const hoop = f.kind === "hoop";
  f.motA = hoop ? "toss" : "bowl"; f.motB = f.motA;
  const a = f.a, b = f.b!, tb = f.table!;
  if (hoop && f.lastPh < 0.3 && ph >= 0.3) burst(env.fx, "sparkle", tb.x, HOOP_RIM_Y + 0.1, tb.z, 0.6);
  if (hoop && f.lastPh < 0.8 && ph >= 0.8) burst(env.fx, "sparkle", tb.x, HOOP_RIM_Y + 0.1, tb.z, 0.6);
  f.lastPh = ph;
  if (a.lod === "off" && b.lod === "off") return;
  for (const p of [a, b]) {
    const v = (((ph - (p === a ? 0 : 0.5)) % 1) + 1) % 1;
    const dx = tb.x - p.pos.x, dz = tb.z - p.pos.z, d = Math.hypot(dx, dz) || 1, ux = dx / d, uz = dz / d;
    const side = p === a ? 1 : -1, px = -uz * side, pz = ux * side, gy = p.pos.y + 0.06;
    if (!hoop) {
      if (v > 0.94) continue; // yerden alınıp sıradaki atışa hazırlanır
      const lx = p.pos.x + ux * 0.7 + px * 0.3, lz = p.pos.z + uz * 0.7 + pz * 0.3;
      const rx = p.pos.x + ux * 1.3 + px * 0.36, rz = p.pos.z + uz * 1.3 + pz * 0.36;
      let x = rx, y = gy, z = rz;
      if (v < 0.16) {
        const h = handPos(p, true), w = v / 0.16;
        x = h.x + (lx - h.x) * w; z = h.z + (lz - h.z) * w; y = h.y + (gy - h.y) * w + Math.sin(Math.PI * w) * 0.35;
      } else if (v < 0.3) {
        const w = (v - 0.16) / 0.14, e = 1 - (1 - w) * (1 - w);
        x = lx + (rx - lx) * e; z = lz + (rz - lz) * e;
      }
      box(env.fx, x, y, z, 0.1, 0.1, 0.1, 0, 0, 0, p === a ? C.grey : C.line);
      continue;
    }
    if (v > 0.72) continue;
    const ry = HOOP_RIM_Y + 0.12;
    let x: number, y: number, z: number;
    if (v < 0.3) {
      const h = handPos(p, true), w = v / 0.3;
      x = h.x + (tb.x - h.x) * w; z = h.z + (tb.z - h.z) * w; y = h.y + (ry - h.y) * w + Math.sin(Math.PI * w) * 0.9;
    } else if (v < 0.42) {
      const w = (v - 0.3) / 0.12;
      x = tb.x; z = tb.z; y = ry + (gy + 0.06 - ry) * w * w;
    } else {
      const w = (v - 0.42) / 0.3;
      x = tb.x - ux * 0.75 * w; z = tb.z - uz * 0.75 * w; y = gy + 0.06 + Math.abs(Math.sin(Math.PI * w * 2)) * 0.5 * (1 - w);
    }
    box(env.fx, x, y, z, 0.16, 0.16, 0.16, env.t * 4, 0, 0, C.orange);
  }
}

/** W3a-INT — plaj voleybolu (`play` kancası r = PLAY_NET): top A'nın elinden fileyi (kanca karosu) aşan yüksek kavisle B'nin
 *  eline, sonra geri; ikisi ayakta parmak pası (`toss` hareketi). Ses/parıltı yok; hareket azaltmada fx zaten kapalı. */
function updateVolley(f: Fun, env: FunEnv, ph: number) {
  f.motA = "toss"; f.motB = "toss"; f.lastPh = ph;
  const a = f.a, b = f.b!;
  if (a.lod === "off" && b.lod === "off") return;
  const from = ph < 0.5 ? a : b, to = from === a ? b : a, w = (ph % 0.5) / 0.5;
  const h0 = handPos(from, true), h1 = handPos(to, true);
  const top = Math.max(h0.y, h1.y) + 1.5;
  const x = h0.x + (h1.x - h0.x) * w, z = h0.z + (h1.z - h0.z) * w;
  const y = h0.y + (h1.y - h0.y) * w + Math.sin(Math.PI * w) * (top - Math.max(h0.y, h1.y));
  box(env.fx, x, y, z, 0.17, 0.17, 0.17, env.t * 3, 0, 0, C.white);
}

const BRELLAS = [C.red, C.blue, C.yellow, C.green, C.purple, C.dark];
/** W2-INT — şemsiye: elden yukarı sap, üstte iki kat yassı kanopi (yavaşça döner); renk ajan tohumundan. */
function updateUmbrella(f: Fun, env: FunEnv) {
  f.motA = "umbrella";
  const a = f.a;
  if (a.lod === "off") return;
  // CEOGOZU: sap elde dikey (başın sağında), kubbe şapka/kulak dahil başın üstünde (umbrella.ts; baş/şapka ile kesişmez)
  const h = handPos(a, true), k = (a.scale * (a.hs ?? 1)) / 16, top = headTopOf(a.wa.agent.avatar);
  const c = Math.cos(a.facing), s = Math.sin(a.facing);
  const cx = a.pos.x + (UMB_DOME.cx * c + UMB_DOME.cz * s) * k, cz = a.pos.z + (-UMB_DOME.cx * s + UMB_DOME.cz * c) * k;
  const dy = a.pos.y + (a.lift ?? 0) + domeY(top) * k;
  seg(env.fx, h.x, h.y - 3 * k, h.z, h.x, dy + 1.6 * k, h.z, 0.03, C.dark);
  const col = BRELLAS[Math.floor(a.seed * BRELLAS.length) % BRELLAS.length];
  const yaw = env.calm ? 0.4 : (env.t - f.t0) * 0.6;
  box(env.fx, cx, dy, cz, UMB_DOME.w * k, UMB_DOME.h * k, UMB_DOME.w * k, yaw, 0, 0, col);
  box(env.fx, cx, dy + (UMB_DOME.h / 2 + 0.6) * k, cz, 9 * k, 1.2 * k, 9 * k, yaw + Math.PI / 4, 0, 0, col);
}

/** W2-INT — gölete ekmek kırıntısı atma: her periyotta küçük bir avuç kırıntı suya kavisle düşer, halka yayılır. */
function updateFeed(f: Fun, env: FunEnv, ph: number) {
  const a = f.a, sp = f.fish!;
  f.motA = "toss";
  if (ph < f.lastPh) burst(env.fx, "ripple", sp.bx, sp.by + 0.02, sp.bz);
  f.lastPh = ph;
  if (a.lod === "off" || ph > 0.45) return;
  const h = handPos(a, true), u = ph / 0.45;
  for (let i = 0; i < 3; i++) {
    const v = Math.min(1, u * (1 + i * 0.12)), ox = (i - 1) * 0.12;
    box(env.fx, h.x + (sp.bx + ox - h.x) * v, h.y + (sp.by - h.y) * v + Math.sin(Math.PI * v) * 0.5, h.z + (sp.bz + ox - h.z) * v,
      0.04, 0.03, 0.04, i, 0, 0, C.yellow);
  }
}

function paperPlane(fx: FxState, x: number, y: number, z: number, yaw: number, pitch: number) {
  box(fx, x, y, z, 0.05, 0.04, 0.24, yaw, pitch, 0, C.paper);
  box(fx, x, y + 0.01, z - Math.cos(yaw) * 0.03, 0.26, 0.012, 0.11, yaw, pitch, 0, C.paper);
}

function updateFishing(f: Fun, env: FunEnv, _ph: number) {
  const { t, fx } = env;
  const a = f.a, sp = f.fish!;
  const h = handPos(a, true);
  const fwdx = Math.sin(a.facing), fwdz = Math.cos(a.facing);
  // olta ucu: elden ileri-yukarı
  const tipX = h.x + fwdx * 0.95, tipY = h.y + (f.cp === 3 ? 0.2 : 0.55), tipZ = h.z + fwdz * 0.95;
  let bobY = sp.by + 0.03;
  let fishPos: [number, number, number] | null = null;
  if (f.cp === 0) {
    a.lod !== "off" && (bobY += Math.sin(t * 2.2) * 0.012);
    f.motA = "fish";
    if (t > f.catchAt - 1) { bobY -= Math.abs(Math.sin(t * 15)) * 0.05; if (f.emitAt < f.catchAt) { f.emitAt = f.catchAt; burst(fx, "ripple", sp.bx, sp.by + 0.02, sp.bz); } }
    if (t > f.catchAt) { f.cp = 1; f.cpT = t; }
  } else if (f.cp === 1) {
    f.motA = "reel";
    if (t - f.cpT > 0.55) { f.cp = 2; f.cpT = t; burst(fx, "splash", sp.bx, sp.by, sp.bz, 0.6); }
  } else if (f.cp === 2) {
    // balık sudan ele kavisle uçar
    f.motA = "reel";
    const u = Math.min(1, (t - f.cpT) / 0.7);
    fishPos = [sp.bx + (h.x - sp.bx) * u, sp.by + (h.y + 0.2 - sp.by) * u + Math.sin(Math.PI * u) * 0.9, sp.bz + (h.z - sp.bz) * u];
    if (u >= 1) { f.cp = 3; f.cpT = t; burst(fx, "sparkle", h.x, h.y + 0.3, h.z, a.scale); }
  } else if (f.cp === 3) {
    // sevinç: zıplar, balığı havaya kaldırır
    f.motA = "jump";
    fishPos = [h.x, h.y + 0.08, h.z];
    if (t - f.cpT > 1.2) { f.cp = 4; f.cpT = t; }
  } else {
    // geri bırak: suya kavis, sıçrama
    f.motA = "fish";
    const u = Math.min(1, (t - f.cpT) / 0.6);
    fishPos = [h.x + (sp.bx - h.x) * u, h.y + (sp.by - h.y) * u + Math.sin(Math.PI * u) * 0.6, h.z + (sp.bz - h.z) * u];
    if (u >= 1) { f.cp = 0; f.catchAt = t + rr(5, 10); burst(fx, "splash", sp.bx, sp.by, sp.bz, 0.5); }
  }
  if (a.lod === "off") return;
  seg(fx, h.x, h.y, h.z, tipX, tipY, tipZ, 0.035, C.rod);
  if (fishPos) {
    seg(fx, tipX, tipY, tipZ, fishPos[0], fishPos[1] + 0.06, fishPos[2], 0.012, C.line);
    const yaw = a.facing + t * (f.cp === 3 ? 0 : 3);
    box(fx, fishPos[0], fishPos[1], fishPos[2], 0.07, 0.09, 0.2, yaw, 0.4 * Math.sin(t * 18), 0, C.orange);
    box(fx, fishPos[0] - Math.sin(yaw) * 0.12, fishPos[1], fishPos[2] - Math.cos(yaw) * 0.12, 0.02, 0.1, 0.07, yaw, 0, 0, C.orange);
  } else {
    seg(fx, tipX, tipY, tipZ, sp.bx, bobY + 0.04, sp.bz, 0.012, C.line);
    box(fx, sp.bx, bobY, sp.bz, 0.07, 0.05, 0.07, 0, 0, 0, C.paddle);
    box(fx, sp.bx, bobY + 0.045, sp.bz, 0.05, 0.04, 0.05, 0, 0, 0, C.white);
  }
}

function updateDuo(f: Fun, env: FunEnv, ph: number) {
  const { t, fx } = env;
  const a = f.a, b = f.b!;
  const mot: Motion = f.kind === "pingpong" ? "paddle" : f.kind === "pass" ? "kick" : f.kind === "snowball" ? "snowball" : "toss";
  f.motA = mot; f.motB = mot;
  // kartopu: top karşıya varınca toz (kar) bulutu
  if (f.kind === "snowball") {
    if (f.lastPh < 0.5 && ph >= 0.5) burst(fx, "snow", b.pos.x, b.pos.y + 1.05 * b.scale, b.pos.z, b.scale);
    if (ph < f.lastPh) burst(fx, "snow", a.pos.x, a.pos.y + 1.05 * a.scale, a.pos.z, a.scale);
  }
  f.lastPh = ph;
  if (a.lod === "off" && b.lod === "off") return;
  const from = ph < 0.5 ? a : b, to = ph < 0.5 ? b : a;
  const u = (ph % 0.5) / 0.5;
  if (f.kind === "pingpong") {
    paddle(fx, a); paddle(fx, b);
    const tb = f.table!;
    const dx = to.pos.x - from.pos.x, dz = to.pos.z - from.pos.z, d = Math.hypot(dx, dz) || 1;
    const sx = from.pos.x + (dx / d) * 0.4, sz = from.pos.z + (dz / d) * 0.4, ex = to.pos.x - (dx / d) * 0.4, ez = to.pos.z - (dz / d) * 0.4;
    const yH = tb.y + 0.32, yT = tb.y + 0.03;
    const y = u < 0.62 ? yH + (yT - yH) * (u / 0.62) + 0.22 * Math.sin(Math.PI * (u / 0.62)) : yT + (yH - yT) * ((u - 0.62) / 0.38) + 0.2 * Math.sin(Math.PI * ((u - 0.62) / 0.38));
    box(fx, sx + (ex - sx) * u, y, sz + (ez - sz) * u, 0.05, 0.05, 0.05, 0, 0, 0, C.white);
    return;
  }
  if (f.kind === "pass") {
    const fx0 = from.pos.x + Math.sin(from.facing) * 0.28, fz0 = from.pos.z + Math.cos(from.facing) * 0.28;
    const tx0 = to.pos.x + Math.sin(to.facing) * 0.28, tz0 = to.pos.z + Math.cos(to.facing) * 0.28;
    box(fx, fx0 + (tx0 - fx0) * u, 0.08 + Math.abs(Math.sin(Math.PI * u * 2)) * 0.08, fz0 + (tz0 - fz0) * u, 0.15, 0.15, 0.15, t * 7, t * 9, 0, C.white);
    return;
  }
  // frizbi / kartopu: atılan elde (tutan için 0,5 sonrası elinde), uçuşta kavis
  const h0 = handPos(from, true);
  const hx = h0.x, hy = h0.y, hz = h0.z;
  const h1 = handPos(to, f.kind === "frisbee");
  const yaw = Math.atan2(h1.x - hx, h1.z - hz);
  if (u < 0.08) { flyer(fx, f.kind, hx, hy, hz, t, yaw); return; }
  const v = (u - 0.08) / 0.92;
  const ty = f.kind === "snowball" ? to.pos.y + 1.05 * to.scale : h1.y;
  const arc = f.kind === "snowball" ? 1.1 : f.kind === "planeToss" ? 0.3 : 0.45;
  const side = f.kind === "frisbee" ? Math.sin(Math.PI * v) * 0.45 : 0;
  const dx = h1.x - hx, dz = h1.z - hz, d = Math.hypot(dx, dz) || 1;
  flyer(fx, f.kind, hx + dx * v + (-dz / d) * side, hy + (ty - hy) * v + Math.sin(Math.PI * v) * arc, hz + dz * v + (dx / d) * side, t, yaw);
}

function flyer(fx: FxState, kind: FunKind, x: number, y: number, z: number, t: number, yaw = 0) {
  if (kind === "planeToss") paperPlane(fx, x, y, z, yaw, 0);
  else if (kind === "frisbee") box(fx, x, y, z, 0.24, 0.035, 0.24, t * 14, 0.12, 0, C.cyan);
  else box(fx, x, y, z, 0.11, 0.11, 0.11, t * 3, 0, 0, C.snow);
}

// ------------------------------------------------------------------ şakşak: yoğun yürüyüşte çarpışma
const WALK: FunCh[] = [];
const WAIT: FunCh[] = [];
function tryBump(fw: FunWorld, env: FunEnv) {
  const { list, t, level } = env;
  if (t < fw.nextBump || fw.bumpUntil > t) return;
  WALK.length = 0; WAIT.length = 0;
  let seen = 0, busy = 0;
  for (const c of list) {
    if (c.lod === "off") continue;
    seen++;
    if (c.wa.mood === "working" || c.wa.mood === "thinking") busy++;
    if (needsYou(c)) { if (WAIT.length < 32) WAIT.push(c); continue; } // onay bekleyen çarpışmaya katılmaz
    if (c.lod === "near" && c.path.length && !c.meet && !c.fun && !c.bump && c.wa.mood !== "offline" && WALK.length < 64) WALK.push(c);
  }
  fw.walkers = WALK.length;
  // yoğunluk: görünenlerin en az %30'u çalışıyor ve yakında birkaç kişi yürüyor
  if (WALK.length < (level === "few" ? 4 : 2) || busy < seen * 0.3) return;
  for (let i = 0; i < WALK.length; i++) for (let j = i + 1; j < WALK.length; j++) {
    const a = WALK[i], b = WALK[j];
    const d = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
    if (d < fw.minGap) fw.minGap = d;
    if (d > 0.8 || d < 0.05) continue;
    // karşı karşıya ya da yan yana çarpışma (aynı yöne yürüyenler değil)
    const da = Math.atan2(Math.sin(a.facing - b.facing), Math.cos(a.facing - b.facing));
    if (Math.abs(da) < 1.2) continue;
    // onay bekleyenin (el sallayan) yanında şakşak yok: dikkat onda kalsın
    const mx = (a.pos.x + b.pos.x) / 2, mz = (a.pos.z + b.pos.z) / 2;
    let nearWait = false;
    for (const w of WAIT) if (Math.hypot(w.pos.x - mx, w.pos.z - mz) < 3) { nearWait = true; break; }
    if (nearWait || inQuietZone(mx, mz)) continue;
    doBump(fw, env, a, b);
    return;
  }
}

/** İki yürüyeni çarpıştırır (biri popo üstü düşebilir); toz bulutu ve yıldızlar. */
export function doBump(fw: FunWorld, env: FunEnv, a: FunCh, b: FunCh) {
  const { t, level, fx } = env;
  const mx = (a.pos.x + b.pos.x) / 2, mz = (a.pos.z + b.pos.z) / 2;
  const fallA = R() < 0.5, fall = R() < 0.7;
  a.bump = { t0: t, until: t + (fall && fallA ? 2.1 : 1.1), fall: fall && fallA, dizzy: false };
  b.bump = { t0: t, until: t + (fall && !fallA ? 2.1 : 1.1), fall: fall && !fallA, dizzy: false };
  a.facing = Math.atan2(b.pos.x - a.pos.x, b.pos.z - a.pos.z);
  b.facing = Math.atan2(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
  burst(fx, "puff", mx, 0.85 * a.scale, mz, a.scale);
  burst(fx, "stars", mx, 1.5 * a.scale, mz, a.scale * 0.8);
  fw.bumpUntil = t + 2.2;
  fw.bumps++; fw.lastBump = { x: mx, z: mz, t };
  fw.nextBump = t + (level === "few" ? rr(45, 90) : rr(14, 28));
}

/** Düşenin başında sersemlik yıldızları (çarpışmadan kısa süre sonra, bir kez). */
export function bumpFx(ch: FunCh, t: number, fx: FxState) {
  const b = ch.bump;
  if (!b || !b.fall || b.dizzy || t - b.t0 < 0.35) return;
  b.dizzy = true;
  burst(fx, "dizzy", ch.pos.x, ch.pos.y + 1.25 * ch.scale, ch.pos.z, ch.scale);
}
