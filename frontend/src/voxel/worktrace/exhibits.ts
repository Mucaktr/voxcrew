/**
 * "Dünya çıktının hafızasıdır": kabul edilen işler ofis dünyasının ön kenarında küçük bir ARŞİV sırası olur
 * (kaide + belge paneli + pirinç plaka) ve sıranın başında "Yeni girdiyle tekrar" TARİF MASASI durur.
 *
 * Çizim bütçesi: bütün parçalar `solid` grubuna katılır (mevcut InstancedMesh; +0 çizim çağrısı, yeni malzeme/grup yok).
 * Tıklama için çizim yok: zemin tıklamasının ışını bu kutularla (Box3) kesiştirilir. Başlık 2B etiket tuvalinde en düşük
 * öncelikli yer tabelası olarak çizilir (+0 çizim çağrısı). Sıra dünya ızgarasının DIŞINDADIR (ön kenarın ötesi): engel,
 * istasyon, yürüme ızgarası ve dünya kuralları değişmez; "Şehre çık" kapısının önü boş bırakılır.
 *
 * Saf modül: React/three yok (scripts ile sınanabilir).
*/
import { officeDoor } from "../citymap/door";
import { tx, tz, type Block, type Built } from "../scenes";

export interface WorldExhibit { id: string; title: string | null; kind: string }
export interface ExhibitHit { id: string; min: [number, number, number]; max: [number, number, number] }
export interface ExhibitSign { x: number; y: number; z: number; text: string; color: string; kind: "place" }
export interface ExhibitLayout { blocks: Block[]; hits: ExhibitHit[]; signs: ExhibitSign[] }

/** Tarif masasının tıklama kimliği. */
export const DESK_ID = "__recipe_desk";
/** Dünyada en çok bu kadar öğe (sunucu `world_max` ile aynı); geri kalanı arayüz listesinde. */
export const WORLD_MAX = 8;
const STEP = 1.25;
const LABEL_MAX = 24;
const KIND_COLOR: Record<string, string> = {
  report: "#3B82F6", text: "#64748B", code: "#10B981", data: "#F59E0B", image: "#EC4899", other: "#8B5CF6",
};
const EMPTY: ExhibitLayout = { blocks: [], hits: [], signs: [] };

const clip = (s: string) => (s.length > LABEL_MAX ? `${s.slice(0, LABEL_MAX - 1).trimEnd()}…` : s);

/** Sıranın x konumları: taban modülünün ortasından dışa doğru, kapı önünden ve dünya sınırından kaçınarak. */
function slotsX(built: Built, n: number, avoid: { x: number; r: number } | null): number[] {
  const m = built.modules.find((x) => x.base) ?? built.modules[0] ?? { i0: 0, j0: 0, w: built.width, d: built.depth };
  const cx = tx(m.i0 + m.w / 2 - 0.5);
  const lo = tx(0) - 0.1, hi = tx(built.width - 1) + 0.1;
  const out: number[] = [];
  for (let k = 0; out.length < n && k < 4 * n + 8; k++) {
    const off = (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * STEP;
    const x = cx + off;
    if (x < lo || x > hi) continue;
    if (avoid && Math.abs(x - avoid.x) < avoid.r) continue;
    out.push(x);
  }
  return out.sort((a, b) => a - b);
}

/**
 * Arşiv sırası: masa en solda, öğeler yeniden eskiye soldan sağa. `labels.desk` masa tabelası, `labels.forgotten`
 * başlığı verilmeyen (unutulan) öğenin nötr etiketi. Öğe yoksa hiçbir şey çizilmez.
 */
export function exhibitLayout(built: Built, items: WorldExhibit[], labels: { desk: string; forgotten: string }): ExhibitLayout {
  const shown = items.slice(0, WORLD_MAX);
  if (!shown.length) return EMPTY;
  const door = officeDoor(built);
  const front = !!door && door.dir[1] === 1;
  const xs = slotsX(built, shown.length + 1, front && door ? { x: tx(door.tile[0]), r: 1.45 } : null);
  if (xs.length < 2) return EMPTY;
  const z0 = tz(built.depth - 1) + 0.5 + 0.6;
  const blocks: Block[] = [];
  const hits: ExhibitHit[] = [];
  const signs: ExhibitSign[] = [];
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, c: string, j = 0.02) =>
    blocks.push({ p: [x, y, z], s: [w, h, d], c, g: "solid", j });
  // zemin şeridi (sıranın altı); kapı önünü atlayan şeritler: ardışık konumlar arası boşluk STEP'i aşıyorsa şerit bölünür
  let start = xs[0];
  for (let k = 1; k <= xs.length; k++) {
    if (k === xs.length || xs[k] - xs[k - 1] > STEP + 0.01) {
      const a = start - 0.6, b = xs[k - 1] + 0.6;
      box((a + b) / 2, -0.03, z0, b - a, 0.08, 1.0, "#5B4636", 0.03);
      if (k < xs.length) start = xs[k];
    }
  }
  // tarif masası (en solda)
  const dx = xs[0];
  box(dx, 0.72, z0, 0.92, 0.06, 0.62, "#8B5E3C");
  for (const s of [-1, 1]) box(dx + s * 0.38, 0.35, z0, 0.08, 0.7, 0.5, "#6B4429");
  box(dx - 0.12, 0.765, z0 + 0.02, 0.36, 0.03, 0.28, "#FDE68A", 0.01);      // tarif kartı
  box(dx - 0.12, 0.785, z0 - 0.04, 0.26, 0.012, 0.02, "#B45309", 0.01);     // kart satırı
  box(dx + 0.24, 0.84, z0 - 0.1, 0.16, 0.18, 0.16, "#F8FAFC", 0.01);        // kalemlik
  box(dx + 0.24, 0.97, z0 - 0.1, 0.03, 0.12, 0.03, "#E5584E", 0.01);
  hits.push({ id: DESK_ID, min: [dx - 0.5, -0.05, z0 - 0.4], max: [dx + 0.5, 1.1, z0 + 0.4] });
  signs.push({ x: dx, y: 1.35, z: z0, text: clip(labels.desk), color: "#FDE68A", kind: "place" });
  // sergi öğeleri
  shown.forEach((e, i) => {
    const x = xs[i + 1];
    if (x === undefined) return;
    const forgotten = !e.title;
    box(x, 0.2, z0, 0.86, 0.4, 0.66, "#3F4654", 0.03);                      // kaide
    box(x, 0.42, z0, 0.92, 0.04, 0.72, "#D9C7A3", 0.02);                    // kaide başlığı
    box(x, 0.84, z0 - 0.12, 0.6, 0.76, 0.06, "#2B2F36", 0.01);              // çerçeve
    box(x, 0.84, z0 - 0.085, 0.5, 0.66, 0.02, forgotten ? "#9CA3AF" : "#F8FAFC", 0.01); // belge
    if (!forgotten) {
      box(x, 1.08, z0 - 0.07, 0.5, 0.1, 0.02, KIND_COLOR[e.kind] ?? KIND_COLOR.other, 0.01); // tür bandı
      for (const dy of [0.0, -0.1, -0.2]) box(x - 0.04, 0.9 + dy, z0 - 0.07, 0.36, 0.025, 0.012, "#CBD5E1", 0.005);
    }
    box(x, 0.48, z0 + 0.36, 0.46, 0.08, 0.02, "#E8B94A", 0.01);             // pirinç plaka
    hits.push({ id: e.id, min: [x - 0.48, -0.05, z0 - 0.4], max: [x + 0.48, 1.3, z0 + 0.4] });
    signs.push({ x, y: 1.45, z: z0, text: clip(e.title ?? labels.forgotten), color: "#E5E7EB", kind: "place" });
  });
  return { blocks, hits, signs };
}

/** Işın (köken + yön) ile en yakın kutu (eksen hizalı; dilim yöntemi). Yoksa null. */
export function pickExhibit(hits: ExhibitHit[], o: [number, number, number], d: [number, number, number]): string | null {
  let best: string | null = null, bestT = Infinity;
  for (const h of hits) {
    let t0 = -Infinity, t1 = Infinity;
    let miss = false;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-9) {
        if (o[a] < h.min[a] || o[a] > h.max[a]) { miss = true; break; }
        continue;
      }
      let ta = (h.min[a] - o[a]) / d[a], tb = (h.max[a] - o[a]) / d[a];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) { miss = true; break; }
    }
    if (miss || t1 < 0) continue;
    const t = Math.max(0, t0);
    if (t < bestT) { bestT = t; best = h.id; }
  }
  return best;
}
