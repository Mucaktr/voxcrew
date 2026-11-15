/**
 * S43 — ortam canlıları: voxel parça listeleri (dünya birimi; yerel +z ileri, taban y = 0). Her parça bir pivotta (`p`)
 * rolüne göre döner (kanat çırpma, gagalama, kuyruk sallama, bacak salınımı), sonra `o` kadar kayar ve `s` boyutunda çizilir.
 * Tümü tek örneklenmiş kutu dizisinde (Ambient.tsx); parlayanlar (ateş böceği, baykuş gözü, LED) ikinci dizide.
 */
import { fishModel } from "../fun/fishModels";
import { WALK_HUMAN_SCALE } from "../walk/scale";

export type V3 = [number, number, number];
export type Kind = "bird" | "pigeon" | "gull" | "duck" | "cat" | "squirrel" | "rabbit" | "deer" | "owl" | "firefly" | "fish" | "dolphin"
  | "crab" | "vacuum" | "robot" | "satellite" | "shuttle" | "dog"
  /** W3a-INT (Aurora, Antarktika): penguen — paytak yürür, gece de görünür */
  | "penguin";
export type Role = "body" | "head" | "wingL" | "wingR" | "tail" | "legF" | "legB" | "blink";

export interface APart { p: V3; o?: V3; s: V3; c: string; role?: Role; glow?: boolean; side?: 1 | -1 }

/** Türün adı (locales/world.ts `amb_<tür>`) */
export const KIND_KEY = (k: Kind) => `amb_${k}` as const;

/**
 * yürüme ölçeği. Modeller genel bakıştaki chibi insana (1,55)
 * göre tasarlandı; yürümede insan 1,0 birime inince (`walkRuntime.humanScale` → `WALK_HUMAN_SCALE` ≈ 0,645) canlılar da
 * küçülür. Çarpan insanınkinden %2 büyük: martı kanat açıklığı 0,92 × 0,66 = 0,61, alt sınır 0,6'nın üstünde kalır; öbür
 * türler aralıkta ya da × 1,3 stilizasyon payında. Genel bakış (humanScale 1) değişmez. `scripts/scale_check.mjs` okur.
*/
export const AMBIENT_WALK_SCALE = 0.66;
/** Yürümede küçülmeyenler: uzay canlıları (yörünge/hat) ve açık denizde uzaktan görülen yunus (gerçekte insandan uzun).
 *  Akvaryum balığı kipine göre muaf (tank chibi eşya ölçeğinde; Ambient.tsx). */
export const AMBIENT_WALK_FIXED: ReadonlySet<Kind> = new Set<Kind>(["satellite", "shuttle", "dolphin"]);
/** humanScale (1 genel bakış … `WALK_HUMAN_SCALE` yürüme; 600 ms geçiş) → canlı çizim çarpanı (1 … `AMBIENT_WALK_SCALE`), doğrusal. */
export function ambientWalkScale(humanScale: number): number {
  const k = Math.max(0, Math.min(1, (1 - humanScale) / (1 - WALK_HUMAN_SCALE)));
  return 1 - k * (1 - AMBIENT_WALK_SCALE);
}

const pick = <T,>(xs: readonly T[], v: number) => xs[Math.floor(v * xs.length) % xs.length];

function bird(v: number): APart[] {
  const [c, belly, head] = pick([["#8B6B4A", "#D9C4A5", "#6E5238"], ["#4F86C6", "#F2E27A", "#2F5D8F"], ["#6B5A4A", "#E06A3A", "#5A4A3C"],
    ["#3A3A3A", "#585858", "#2A2A2A"]] as const, v);
  return [
    { p: [0, 0.09, 0], s: [0.11, 0.1, 0.18], c },
    { p: [0, 0.07, 0.02], s: [0.09, 0.06, 0.12], c: belly },
    { p: [0, 0.13, 0.07], o: [0, 0.03, 0.02], s: [0.09, 0.09, 0.09], c: head, role: "head" },
    { p: [0, 0.13, 0.07], o: [0, 0.025, 0.085], s: [0.03, 0.025, 0.05], c: "#F2A93B", role: "head" },
    { p: [-0.055, 0.11, 0], o: [-0.05, 0, 0], s: [0.1, 0.02, 0.12], c: head, role: "wingL" },
    { p: [0.055, 0.11, 0], o: [0.05, 0, 0], s: [0.1, 0.02, 0.12], c: head, role: "wingR" },
    { p: [0, 0.1, -0.09], o: [0, 0, -0.05], s: [0.06, 0.02, 0.1], c: head, role: "tail" },
  ];
}

function pigeon(v: number): APart[] {
  const c = pick(["#9AA3AD", "#8A8F99", "#B5B9BF", "#6F737B"], v);
  return [
    { p: [0, 0.13, 0], s: [0.15, 0.14, 0.25], c },
    { p: [0, 0.18, 0.1], o: [0, 0.02, 0.02], s: [0.12, 0.1, 0.08], c: "#5B8F7B", role: "head" },
    { p: [0, 0.18, 0.1], o: [0, 0.08, 0.05], s: [0.1, 0.1, 0.1], c: "#5E6470", role: "head" },
    { p: [0, 0.18, 0.1], o: [0, 0.07, 0.12], s: [0.03, 0.025, 0.05], c: "#3F3F46", role: "head" },
    { p: [-0.08, 0.16, -0.01], o: [-0.06, 0, 0], s: [0.12, 0.02, 0.18], c: "#7C838E", role: "wingL" },
    { p: [0.08, 0.16, -0.01], o: [0.06, 0, 0], s: [0.12, 0.02, 0.18], c: "#7C838E", role: "wingR" },
    { p: [0, 0.14, -0.13], o: [0, 0, -0.06], s: [0.1, 0.02, 0.12], c: "#4B5058", role: "tail" },
    { p: [-0.04, 0.06, 0.01], o: [0, -0.03, 0], s: [0.025, 0.06, 0.025], c: "#D9534F", role: "legF", side: -1 },
    { p: [0.04, 0.06, 0.01], o: [0, -0.03, 0], s: [0.025, 0.06, 0.025], c: "#D9534F", role: "legF", side: 1 },
  ];
}

function gull(): APart[] {
  return [
    { p: [0, 0.14, 0], s: [0.14, 0.13, 0.32], c: "#F3F4F6" },
    { p: [0, 0.19, 0.14], o: [0, 0.03, 0.04], s: [0.11, 0.1, 0.12], c: "#FFFFFF", role: "head" },
    { p: [0, 0.19, 0.14], o: [0, 0.02, 0.13], s: [0.035, 0.03, 0.08], c: "#F2C14E", role: "head" },
    { p: [-0.07, 0.17, 0], o: [-0.17, 0, 0], s: [0.34, 0.02, 0.15], c: "#9CA3AF", role: "wingL" },
    { p: [-0.07, 0.17, 0], o: [-0.36, 0, -0.02], s: [0.06, 0.022, 0.12], c: "#1F2937", role: "wingL" },
    { p: [0.07, 0.17, 0], o: [0.17, 0, 0], s: [0.34, 0.02, 0.15], c: "#9CA3AF", role: "wingR" },
    { p: [0.07, 0.17, 0], o: [0.36, 0, -0.02], s: [0.06, 0.022, 0.12], c: "#1F2937", role: "wingR" },
    { p: [0, 0.16, -0.16], o: [0, 0, -0.05], s: [0.1, 0.02, 0.1], c: "#E5E7EB", role: "tail" },
    { p: [-0.035, 0.07, 0.02], o: [0, -0.035, 0], s: [0.025, 0.07, 0.025], c: "#F2C14E", role: "legF", side: -1 },
    { p: [0.035, 0.07, 0.02], o: [0, -0.035, 0], s: [0.025, 0.07, 0.025], c: "#F2C14E", role: "legF", side: 1 },
  ];
}

function duck(v: number): APart[] {
  const white = v > 0.75;
  const body = white ? "#F5F5F0" : v > 0.4 ? "#9CA3AF" : "#8B6B47";
  const head = white ? "#F5F5F0" : v > 0.4 ? "#2E6B3F" : "#7A5C3E";
  return [
    { p: [0, 0.07, 0], s: [0.2, 0.13, 0.32], c: body },
    { p: [0, 0.12, -0.15], o: [0, 0.02, -0.03], s: [0.1, 0.07, 0.08], c: white ? "#EDEDE6" : "#4B3A2A", role: "tail" },
    { p: [0, 0.12, 0.12], o: [0, 0.08, 0.03], s: [0.12, 0.12, 0.12], c: head, role: "head" },
    { p: [0, 0.12, 0.12], o: [0, 0.06, 0.12], s: [0.07, 0.03, 0.09], c: "#F59E0B", role: "head" },
    { p: [0, 0.12, 0.12], o: [0, 0.02, 0.02], s: [0.1, 0.03, 0.05], c: white ? "#F5F5F0" : "#F8FAFC", role: "head" },
  ];
}

function cat(v: number): APart[] {
  const [c, d] = pick([["#E08A3C", "#B9652A"], ["#2B2B2B", "#1A1A1A"], ["#8C8C8C", "#6B6B6B"], ["#F1EDE4", "#D8A06A"], ["#5C4A3A", "#3E3128"]] as const, v);
  return [
    { p: [0, 0.17, 0], s: [0.18, 0.15, 0.4], c },
    { p: [0, 0.2, 0.06], s: [0.185, 0.03, 0.06], c: d },
    { p: [0, 0.22, 0.2], o: [0, 0.05, 0.05], s: [0.18, 0.15, 0.15], c, role: "head" },
    { p: [0, 0.22, 0.2], o: [-0.055, 0.15, 0.04], s: [0.05, 0.06, 0.04], c: d, role: "head" },
    { p: [0, 0.22, 0.2], o: [0.055, 0.15, 0.04], s: [0.05, 0.06, 0.04], c: d, role: "head" },
    { p: [0, 0.22, 0.2], o: [0, 0.03, 0.13], s: [0.06, 0.04, 0.02], c: "#F9A8D4", role: "head" },
    { p: [0, 0.2, -0.19], o: [0, 0.1, -0.03], s: [0.045, 0.22, 0.045], c: d, role: "tail" },
    { p: [-0.06, 0.1, 0.13], o: [0, -0.05, 0], s: [0.05, 0.1, 0.05], c, role: "legF", side: -1 },
    { p: [0.06, 0.1, 0.13], o: [0, -0.05, 0], s: [0.05, 0.1, 0.05], c, role: "legF", side: 1 },
    { p: [-0.06, 0.1, -0.13], o: [0, -0.05, 0], s: [0.05, 0.1, 0.05], c, role: "legB", side: -1 },
    { p: [0.06, 0.1, -0.13], o: [0, -0.05, 0], s: [0.05, 0.1, 0.05], c, role: "legB", side: 1 },
  ];
}

/** S48: köpek (park, sahil, kamp): kedi gibi yürür; tıklayınca kuyruk sallar, havlar. */
function dog(v: number): APart[] {
  const [c, d] = pick([["#C68642", "#8B5A2B"], ["#F3EBDD", "#C9B79C"], ["#3F3A36", "#22201E"], ["#A0522D", "#F3EBDD"]] as const, v);
  return [
    { p: [0, 0.22, 0], s: [0.2, 0.17, 0.42], c },
    { p: [0, 0.27, 0.2], o: [0, 0.06, 0.06], s: [0.19, 0.18, 0.18], c, role: "head" },
    { p: [0, 0.27, 0.2], o: [0, 0.03, 0.18], s: [0.1, 0.08, 0.1], c: d, role: "head" },
    { p: [0, 0.27, 0.2], o: [0, 0.06, 0.235], s: [0.05, 0.04, 0.03], c: "#1F1F1F", role: "head" },
    { p: [0, 0.27, 0.2], o: [-0.105, 0.07, 0.04], s: [0.04, 0.12, 0.07], c: d, role: "head" },
    { p: [0, 0.27, 0.2], o: [0.105, 0.07, 0.04], s: [0.04, 0.12, 0.07], c: d, role: "head" },
    { p: [0, 0.27, 0.2], o: [0, 0.0, 0.16], s: [0.05, 0.015, 0.05], c: "#F472B6", role: "head" },
    { p: [0, 0.28, -0.2], o: [0, 0.08, -0.04], s: [0.045, 0.18, 0.045], c, role: "tail" },
    { p: [-0.07, 0.13, 0.14], o: [0, -0.065, 0], s: [0.06, 0.13, 0.06], c, role: "legF", side: -1 },
    { p: [0.07, 0.13, 0.14], o: [0, -0.065, 0], s: [0.06, 0.13, 0.06], c, role: "legF", side: 1 },
    { p: [-0.07, 0.13, -0.14], o: [0, -0.065, 0], s: [0.06, 0.13, 0.06], c, role: "legB", side: -1 },
    { p: [0.07, 0.13, -0.14], o: [0, -0.065, 0], s: [0.06, 0.13, 0.06], c, role: "legB", side: 1 },
  ];
}

function squirrel(): APart[] {
  const c = "#A0522D";
  return [
    { p: [0, 0.08, 0], s: [0.1, 0.11, 0.18], c },
    { p: [0, 0.12, 0.08], o: [0, 0.03, 0.03], s: [0.09, 0.09, 0.09], c, role: "head" },
    { p: [0, 0.12, 0.08], o: [0, 0.09, 0.02], s: [0.03, 0.04, 0.02], c: "#7A3E20", role: "head" },
    { p: [0, 0.1, -0.08], o: [0, 0.1, -0.04], s: [0.09, 0.2, 0.08], c: "#B5653A", role: "tail" },
    { p: [0, 0.06, 0.05], s: [0.07, 0.06, 0.06], c: "#E7C9A9" },
  ];
}

function rabbit(v: number, snow: boolean): APart[] {
  const c = snow || v > 0.7 ? "#F5F5F5" : "#9C7B5B";
  return [
    { p: [0, 0.1, 0], s: [0.16, 0.14, 0.24], c },
    { p: [0, 0.15, 0.1], o: [0, 0.04, 0.04], s: [0.12, 0.12, 0.12], c, role: "head" },
    { p: [0, 0.15, 0.1], o: [-0.03, 0.15, 0.02], s: [0.035, 0.13, 0.04], c, role: "head" },
    { p: [0, 0.15, 0.1], o: [0.03, 0.15, 0.02], s: [0.035, 0.13, 0.04], c, role: "head" },
    { p: [0, 0.15, 0.1], o: [0, 0.04, 0.105], s: [0.03, 0.025, 0.02], c: "#F9A8D4", role: "head" },
    { p: [0, 0.12, -0.12], s: [0.06, 0.06, 0.05], c: "#FFFFFF", role: "tail" },
  ];
}

function deer(v: number): APart[] {
  const c = "#8B5A2B", d = "#6B4220", buck = v > 0.5;
  const parts: APart[] = [
    { p: [0, 0.68, 0], s: [0.28, 0.28, 0.68], c },
    { p: [0, 0.62, 0], s: [0.24, 0.1, 0.5], c: "#C9A27A" },
    { p: [0, 0.78, 0.3], o: [0, 0.18, 0.06], s: [0.13, 0.36, 0.13], c, role: "head" },
    { p: [0, 0.78, 0.3], o: [0, 0.4, 0.14], s: [0.15, 0.15, 0.26], c, role: "head" },
    { p: [0, 0.78, 0.3], o: [0, 0.38, 0.28], s: [0.06, 0.06, 0.04], c: "#2B2B2B", role: "head" },
    { p: [0, 0.78, -0.33], o: [0, 0.02, -0.03], s: [0.08, 0.12, 0.05], c: "#F8FAFC", role: "tail" },
    { p: [-0.09, 0.56, 0.24], o: [0, -0.28, 0], s: [0.07, 0.56, 0.07], c: d, role: "legF", side: -1 },
    { p: [0.09, 0.56, 0.24], o: [0, -0.28, 0], s: [0.07, 0.56, 0.07], c: d, role: "legF", side: 1 },
    { p: [-0.09, 0.56, -0.24], o: [0, -0.28, 0], s: [0.07, 0.56, 0.07], c: d, role: "legB", side: -1 },
    { p: [0.09, 0.56, -0.24], o: [0, -0.28, 0], s: [0.07, 0.56, 0.07], c: d, role: "legB", side: 1 },
  ];
  if (buck) parts.push(
    { p: [0, 0.78, 0.3], o: [-0.07, 0.56, 0.08], s: [0.03, 0.2, 0.03], c: "#D6C3A3", role: "head" },
    { p: [0, 0.78, 0.3], o: [0.07, 0.56, 0.08], s: [0.03, 0.2, 0.03], c: "#D6C3A3", role: "head" },
  );
  return parts;
}

/** W3a-INT — penguen: siyah sırt, beyaz göğüs, turuncu gaga ve ayaklar, yan kanatçıklar (8 kutu). */
function penguin(): APart[] {
  return [
    { p: [0, 0.2, 0], s: [0.2, 0.32, 0.18], c: "#23262E" },
    { p: [0, 0.18, 0.06], s: [0.15, 0.26, 0.08], c: "#F4F7FB" },
    { p: [0, 0.4, 0.01], o: [0, 0.03, 0], s: [0.15, 0.12, 0.14], c: "#23262E", role: "head" },
    { p: [0, 0.4, 0.01], o: [0, 0.02, 0.09], s: [0.04, 0.03, 0.06], c: "#F59E0B", role: "head" },
    { p: [-0.11, 0.24, 0], o: [-0.01, -0.05, 0], s: [0.03, 0.18, 0.1], c: "#1B1E25", role: "wingL" },
    { p: [0.11, 0.24, 0], o: [0.01, -0.05, 0], s: [0.03, 0.18, 0.1], c: "#1B1E25", role: "wingR" },
    { p: [-0.05, 0.03, 0.04], s: [0.06, 0.03, 0.09], c: "#F59E0B", role: "legF", side: -1 },
    { p: [0.05, 0.03, 0.04], s: [0.06, 0.03, 0.09], c: "#F59E0B", role: "legF", side: 1 },
  ];
}

function owl(): APart[] {
  return [
    { p: [0, 0.14, 0], s: [0.2, 0.26, 0.17], c: "#7A5C3E" },
    { p: [0, 0.12, 0.06], s: [0.14, 0.18, 0.06], c: "#C9A27A" },
    { p: [0, 0.27, 0], o: [0, 0.07, 0], s: [0.21, 0.15, 0.17], c: "#6B4F35", role: "head" },
    { p: [0, 0.27, 0], o: [-0.05, 0.08, 0.087], s: [0.05, 0.05, 0.02], c: "#FCD34D", role: "head", glow: true },
    { p: [0, 0.27, 0], o: [0.05, 0.08, 0.087], s: [0.05, 0.05, 0.02], c: "#FCD34D", role: "head", glow: true },
    { p: [0, 0.27, 0], o: [0, 0.04, 0.09], s: [0.03, 0.04, 0.02], c: "#3F3F46", role: "head" },
  ];
}

/**
 * WORLD-FIX: tür modeli (`fun/fishModels.ts`): baş + göz "head" (ön gövde, kıvrımda kuyruğa ters döner), kuyruk sapı + kuyruk
 * "tail" (yatay sallanır), göğüs yüzgeçleri "wingL/wingR" (çırpar), gövde/karın/sırt/desen sabit. Pul parıltısı ortam
 * balıklarında yok (parıltı dizisi açılmaz: +0 çizim çağrısı). Su altında renk suyun saydamlığıyla kendiliğinden koyulaşır.
 */
const FISH_LEN = 0.3;
const HEAD_PIV = 0.13, TAIL_PIV = -0.17;
function fish(species: string, len = FISH_LEN): APart[] {
  const out: APart[] = [];
  for (const b of fishModel(species)) {
    if (b.glint) continue;
    const p: V3 = [b.p[0] * len, b.p[1] * len, b.p[2] * len];
    const s: V3 = [b.s[0] * len, b.s[1] * len, b.s[2] * len];
    // dönük kutular (çatal kuyruk, yüzgeç açısı): parça eksen hizalı çizilir; açıyı boyuta katlayarak yaklaşık siluet korunur
    if (b.r) { const ax = Math.abs(b.r[0]); s[1] = s[1] * Math.cos(ax) + s[2] * Math.sin(ax) * 0.55; s[2] *= Math.cos(ax * 0.6); }
    const head = b.part === "front" || b.part === "eye";
    const tail = b.part === "rear" || b.part === "tail";
    if (head) out.push({ p: [0, 0, HEAD_PIV * len], o: [p[0], p[1], p[2] - HEAD_PIV * len], s, c: b.c, role: "head" });
    else if (tail) out.push({ p: [0, 0, TAIL_PIV * len], o: [p[0], p[1], p[2] - TAIL_PIV * len], s, c: b.c, role: "tail" });
    else if (b.part === "finL" || b.part === "finR") out.push({ p, s, c: b.c, role: b.part === "finL" ? "wingL" : "wingR" });
    else out.push({ p, s, c: b.c });
  }
  return out;
}
export const fishSpecies = (v: number, list: readonly string[]) => pick(list, v);

function dolphin(): APart[] {
  return [
    { p: [0, 0, 0], s: [0.3, 0.3, 1.0], c: "#5F7F9F" },
    { p: [0, -0.09, 0.05], s: [0.26, 0.13, 0.8], c: "#C9D6E3" },
    { p: [0, -0.03, 0.56], s: [0.12, 0.1, 0.18], c: "#5F7F9F" },
    { p: [0, 0.2, -0.05], s: [0.05, 0.18, 0.2], c: "#4E6B88" },
    { p: [0, 0, -0.5], o: [0, 0, -0.08], s: [0.46, 0.05, 0.16], c: "#4E6B88", role: "tail" },
  ];
}

function crab(): APart[] {
  return [
    { p: [0, 0.06, 0], s: [0.22, 0.08, 0.16], c: "#D9483B" },
    { p: [-0.14, 0.05, 0.09], s: [0.07, 0.06, 0.07], c: "#C0392B", role: "legF", side: -1 },
    { p: [0.14, 0.05, 0.09], s: [0.07, 0.06, 0.07], c: "#C0392B", role: "legF", side: 1 },
    { p: [-0.04, 0.12, 0.06], s: [0.025, 0.05, 0.025], c: "#1F1F1F" },
    { p: [0.04, 0.12, 0.06], s: [0.025, 0.05, 0.025], c: "#1F1F1F" },
    { p: [-0.12, 0.03, -0.02], s: [0.08, 0.02, 0.1], c: "#B83227", role: "legB", side: -1 },
    { p: [0.12, 0.03, -0.02], s: [0.08, 0.02, 0.1], c: "#B83227", role: "legB", side: 1 },
  ];
}

function vacuum(): APart[] {
  return [
    { p: [0, 0.04, 0], s: [0.36, 0.07, 0.36], c: "#2F3640" },
    { p: [0, 0.085, 0], s: [0.28, 0.02, 0.28], c: "#4B5563" },
    { p: [0, 0.1, 0.1], s: [0.05, 0.02, 0.03], c: "#5EEAD4", glow: true, role: "blink" },
  ];
}

function robot(): APart[] {
  return [
    { p: [0, 0.08, 0], s: [0.3, 0.1, 0.34], c: "#475569" },
    { p: [0, 0.3, 0], s: [0.28, 0.3, 0.26], c: "#CBD5E1" },
    { p: [0, 0.47, 0], o: [0, 0.06, 0], s: [0.22, 0.12, 0.22], c: "#E2E8F0", role: "head" },
    { p: [0, 0.47, 0], o: [0, 0.07, 0.112], s: [0.15, 0.04, 0.02], c: "#5EEAD4", glow: true, role: "head" },
    { p: [0, 0.47, 0], o: [0.06, 0.2, 0], s: [0.02, 0.14, 0.02], c: "#94A3B8", role: "head" },
    { p: [0, 0.47, 0], o: [0.06, 0.28, 0], s: [0.05, 0.05, 0.05], c: "#F87171", glow: true, role: "blink" },
    { p: [-0.16, 0.3, 0], s: [0.04, 0.2, 0.08], c: "#94A3B8", role: "legF", side: -1 },
    { p: [0.16, 0.3, 0], s: [0.04, 0.2, 0.08], c: "#94A3B8", role: "legF", side: 1 },
  ];
}

function satellite(): APart[] {
  return [
    { p: [0, 0, 0], s: [0.5, 0.5, 0.7], c: "#D1D5DB" },
    { p: [-0.75, 0, 0], s: [0.95, 0.04, 0.45], c: "#1E40AF" },
    { p: [0.75, 0, 0], s: [0.95, 0.04, 0.45], c: "#1E40AF" },
    { p: [0, 0.32, 0.2], s: [0.08, 0.14, 0.08], c: "#9CA3AF" },
    { p: [0, 0.42, 0.2], s: [0.08, 0.08, 0.08], c: "#F87171", glow: true, role: "blink" },
  ];
}

function shuttle(): APart[] {
  return [
    { p: [0, 0, 0], s: [0.4, 0.3, 1.2], c: "#E5E7EB" },
    { p: [0, 0, 0.66], s: [0.26, 0.2, 0.2], c: "#CBD5E1" },
    { p: [0, -0.05, -0.1], s: [1.1, 0.06, 0.5], c: "#9CA3AF" },
    { p: [0, 0, -0.66], s: [0.2, 0.16, 0.08], c: "#7DD3FC", glow: true },
    { p: [-0.55, -0.05, -0.2], s: [0.06, 0.06, 0.06], c: "#F87171", glow: true, role: "blink" },
    { p: [0.55, -0.05, -0.2], s: [0.06, 0.06, 0.06], c: "#4ADE80", glow: true, role: "blink" },
  ];
}

function firefly(): APart[] {
  return [{ p: [0, 0, 0], s: [0.085, 0.085, 0.085], c: "#FFF3A3", glow: true, role: "blink" }];
}

/** Türün parçaları; `v` (0–1) renk/çeşit seçer, `snow` karlı sahnede beyaz tavşan, `shadow: false` akvaryum balığı (küçük),
 *  `species` balık türü (WORLD-FIX: biyoma göre; `fun/minigameLogic.ts biomeSpecies`). */
export function kindParts(k: Kind, v: number, opts: { snow?: boolean; shadow?: boolean; species?: string } = {}): APart[] {
  switch (k) {
    case "bird": return bird(v);
    case "pigeon": return pigeon(v);
    case "gull": return gull();
    case "duck": return duck(v);
    case "cat": return cat(v);
    case "squirrel": return squirrel();
    case "rabbit": return rabbit(v, !!opts.snow);
    case "deer": return deer(v);
    case "owl": return owl();
    case "firefly": return firefly();
    case "fish": return fish(opts.species ?? pick(["hamsi", "istavrit", "sazan", "japon"], v), opts.species === "japon" || opts.shadow === false ? 0.24 : FISH_LEN);
    case "dolphin": return dolphin();
    case "crab": return crab();
    case "vacuum": return vacuum();
    case "robot": return robot();
    case "satellite": return satellite();
    case "shuttle": return shuttle();
    case "dog": return dog(v);
    case "penguin": return penguin();
  }
}
