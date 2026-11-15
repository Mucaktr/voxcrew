/**
 * S47 — mini harita bölge görünümü: bölge türü/ad anahtarından (voxel/districts, `dist_*`) renk ailesi ve simge.
 * Renkler tema belirteçlerinden okunur (index.css); bilinmeyen ad anahtarı türüne göre güvenli varsayılana düşer
 * (S46 yeni bölge eklerse harita yine çizilir).
 */
import type { ModuleCell } from "../../voxel/scenes";

export type DistrictFamily = "hq" | "guest" | "food" | "rest" | "learn" | "meet" | "water" | "green" | "play" | "tech" | "yard";

/** Aile → simge ve tema belirteci (CSS değişkeni adı). */
export const FAMILY: Record<DistrictFamily, { icon: string; token: string }> = {
  hq: { icon: "★", token: "--gold" },
  guest: { icon: "👥", token: "--ink-2" },
  food: { icon: "☕", token: "--gold" },
  rest: { icon: "🛏", token: "--amethyst" },
  learn: { icon: "📚", token: "--sky" },
  meet: { icon: "💬", token: "--accent-fg" },
  water: { icon: "⚓", token: "--diamond" },
  green: { icon: "🌿", token: "--grass" },
  play: { icon: "⚽", token: "--red" },
  tech: { icon: "⚙", token: "--muted" },
  yard: { icon: "", token: "--line-soft" },
};

const BY_LABEL: Record<string, DistrictFamily> = {};
const put = (fam: DistrictFamily, keys: string) => { for (const k of keys.split(" ")) BY_LABEL[`dist_${k}`] = fam; };
put("food", "kitchen cafe_hq cafe_terrace roastery cocoa messhall mess foodcourt dockcafe bar beachclub bonfire");
put("rest", "quietroom bedrooms backroom crewquarters bunkhouse dorm restlounge hammocks beachhuts tents barracks houseboats stilthuts living home");
put("learn", "library bookshop gallery auditorium training");
put("meet", "meeting");
put("water", "marinaclub moorings pier boats dock lake pond superyacht sundeck lighthouse island upperdeck foredeck");
put("green", "garden greenhouse vegpatch meadow forest pines clearing atrium dunes terrace courtyard");
put("play", "playground volley sportsfield skating sledhill");
put("tech", "server workshop launchpad cargo depot parking");
put("guest", "cowork");

export function districtFamily(m: Pick<ModuleCell, "kind" | "label">): DistrictFamily | null {
  if (!m.kind || m.kind === "team") return null;
  if (m.kind === "hq") return "hq";
  if (m.kind === "guest") return "guest";
  if (m.label && BY_LABEL[m.label]) return BY_LABEL[m.label];
  return m.kind === "yard" ? "yard" : "tech";
}
