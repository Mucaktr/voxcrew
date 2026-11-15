/**
 * COS-B — "Gece Atölyesi" (özgün; dünya teması + masa ışıkları + kutlama).
 * Geç saatte çalışan bir maker atölyesi: lacivert gece, sıcak lamba paleti, delikli pano üstünde soyut alet siluetleri,
 * tavanda ampul dizisi; masada eklemli lamba ve kavanoz ışıklarından lamba dizisi; "kıvılcım çarkı" kutlaması. Yazı, logo, marka yok.
 */
import type { CosmeticSet, SceneBox } from "../registry";

const WARM = "#FFC56B", AMBER = "#FB923C", PEG = "#7C5A3C";

/** Kıvılcım çarkı: karakterin üstünde dikey bir çark döner ve açılır, kıvılcımlar yay çizip düşer; statik hâl: duran çark
 *  (aynı halka, dönmez, yanıp sönmez) ve yerde üç ampul. */
function sparkWheel(t: number, calm: boolean): SceneBox[] {
  const out: SceneBox[] = [];
  const N = 24, cy = 34;
  const open = calm ? 1 : Math.sin(Math.min(1, t * 2.2) * Math.PI / 2);
  const spin = calm ? 0 : t * Math.PI * 2.4;
  const fade = calm ? 1 : 1 - Math.max(0, t - 0.8) / 0.2;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + spin, r = 4 + open * 10;
    const s = 1.4 * fade;
    out.push({ p: [Math.cos(a) * r, cy + Math.sin(a) * r, 2], s: [s, s, s], c: i % 2 ? WARM : AMBER, glow: true });
    if (i % 4 === 0) out.push({ p: [Math.cos(a) * r * 0.5, cy + Math.sin(a) * r * 0.5, 2], s: [0.5 * fade, 0.5 * fade, 0.5 * fade], c: "#FEF3C7", glow: true });
  }
  out.push({ p: [0, cy, 2], s: [2.4 * fade, 2.4 * fade, 1.2], c: "#FEF3C7", glow: true });
  if (!calm) {
    // çarktan kopan kıvılcımlar (yalnız hareketli hâl)
    for (let i = 0; i < 12; i++) {
      const k = Math.max(0, t - 0.25 - (i % 4) * 0.05), a = (i / 12) * Math.PI * 2;
      const x = Math.cos(a) * (14 + k * 14), y = cy + Math.sin(a) * 14 + 10 * k - 40 * k * k;
      if (k <= 0) continue;
      const s = fade;
      out.push({ p: [x, Math.max(0.6, y), 2 + Math.sin(a) * 4], s: [s, s, s], c: AMBER, glow: true });
    }
  }
  // her iki hâlde: yerde üç ampul (cam + sıcak çekirdek)
  for (const [x, z] of [[-10, 8], [0, 12], [10, 8]] as const) {
    out.push({ p: [x, 2.2, z], s: [3.4, 3.4, 3.4], c: "#FEF3C7", glass: true });
    out.push({ p: [x, 2.2, z], s: [1.4, 1.4, 1.4], c: WARM, glow: true });
    out.push({ p: [x, 0.4, z], s: [2, 0.8, 2], c: "#64748B" });
  }
  return out;
}

export const NIGHT_WORKSHOP: CosmeticSet = {
  id: "night-workshop", bucket: "small", ip_risk: 0, culture_risk: 0, signature: "night-workshop-desk-lamps", free_after_months: 12,
  tint: "#3B3F8C",
  items: [
    {
      id: "night-workshop-lamplight", slot: "world", surfaces: ["world", "collection"],
      theme: {
        sky: "#121733", hemiSky: "#FFD9A8", hemiGround: "#3B2A20", sun: "#FFC98A", sunIntensity: 0.95,
        floor: ["#5A3E2B", "#4E3525"], wall: "#2C2F4A", lamp: WARM,
        boxes: () => {
          const b: SceneBox[] = [];
          // delikli pano ve soyut alet siluetleri (anahtar, çekiç, cetvel biçimleri; yazı yok)
          b.push({ p: [-26, 20, -31.4], s: [30, 18, 1], c: PEG });
          for (let x = 0; x < 7; x++) for (let y = 0; y < 4; y++) b.push({ p: [-39 + x * 4.3, 13.5 + y * 4.3, -30.8], s: [0.7, 0.7, 0.3], c: "#3F2A1A" });
          b.push({ p: [-34, 21, -30.6], s: [1.4, 9, 0.6], c: "#94A3B8" });
          b.push({ p: [-34, 25.4, -30.6], s: [4, 2, 0.6], c: "#94A3B8" });
          b.push({ p: [-27, 20, -30.6], s: [1.2, 10, 0.6], c: "#B45309" });
          b.push({ p: [-27, 24.6, -30.6], s: [4.4, 2.4, 0.6], c: "#475569" });
          b.push({ p: [-18, 20, -30.6], s: [8, 1.4, 0.6], c: "#FCD34D" });
          // ampul dizisi (sarkık kablo + sıcak ampuller)
          for (let i = 0; i <= 16; i++) {
            const x = -48 + i * 6, y = 40 - Math.sin((i / 16) * Math.PI) * 6;
            b.push({ p: [x, y + 1.4, -30], s: [6.2, 0.4, 0.4], c: "#1F2937" });
            if (i % 2 === 0) b.push({ p: [x, y - 0.6, -30], s: [1.6, 2, 1.6], c: i % 4 ? WARM : AMBER, glow: true });
          }
          // ayaklı lambalar ve tezgâh
          for (const x of [-46, 46]) {
            b.push({ p: [x, 12, -18], s: [1.2, 24, 1.2], c: "#1F2937" });
            b.push({ p: [x, 24.5, -18], s: [4.4, 2.2, 4.4], c: "#374151" });
            b.push({ p: [x, 23, -18], s: [2.6, 1, 2.6], c: WARM, glow: true });
          }
          b.push({ p: [32, 6, -26], s: [24, 1.6, 8], c: "#6B4423" });
          for (const x of [22, 42]) b.push({ p: [x, 2.6, -26], s: [1.6, 5.2, 7], c: "#4A2F1D" });
          b.push({ p: [28, 8.6, -26], s: [5, 3.6, 4], c: "#64748B" });
          b.push({ p: [36, 7.6, -25], s: [6, 1.6, 2], c: "#B45309" });
          return b;
        },
      },
    },
    {
      id: "night-workshop-desk-lamps", slot: "desk", surfaces: ["desk", "collection"],
      boxes: () => {
        const b: SceneBox[] = [];
        // eklemli masa lambası: taban, iki kol, başlık, sıcak ampul
        b.push({ p: [8, 0.5, -2], s: [4, 1, 4], c: "#1F2937" });
        b.push({ p: [8, 4.5, -2], s: [0.8, 7, 0.8], c: "#374151", r: [0, 0, -0.25] });
        b.push({ p: [5.8, 9.6, -2], s: [0.8, 6, 0.8], c: "#374151", r: [0, 0, 0.9] });
        b.push({ p: [2.8, 10.4, -2], s: [3.6, 2.2, 3.6], c: AMBER });
        b.push({ p: [2.8, 9.1, -2], s: [2.2, 0.6, 2.2], c: WARM, glow: true });
        // kavanoz ışıkları (cam + sıcak çekirdek), ışık halkası
        for (const [x, z] of [[-8, 1], [-4.6, 2.2]] as const) {
          b.push({ p: [x, 2.2, z], s: [2.8, 4.4, 2.8], c: "#FDE68A", glass: true });
          b.push({ p: [x, 2, z], s: [1, 1.4, 1], c: WARM, glow: true });
          b.push({ p: [x, 4.7, z], s: [3, 0.6, 3], c: "#7C5A3C" });
        }
        b.push({ p: [2.8, 0.06, -1], s: [7, 0.12, 6], c: "#FDE68A", glass: true });
        return b;
      },
    },
    { id: "night-workshop-spark-wheel", slot: "celebration", surfaces: ["celebration", "collection"], durationMs: 2600, frame: sparkWheel },
  ],
};
