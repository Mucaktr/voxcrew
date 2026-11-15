/**
 * GIFTS-GENDER — hediye rafı: ajanın masasının yanında küçük bir voxel dolap; en yeni hediyeler minik voxel eşyalar olarak
 * iki rafta durur. Saf veri ve saf işlev (three/React yok): `GiftShelfLayer` (R3F) ve node testi aynı tanımı okur.
 * Yerel ölçü "piksel" (masa süsüyle aynı: 1/22 birim). Eşya türleri hediye türleriyle birebir (coffee, tea, snack, meal,
 * dessert, plant, trophy, cosmetic, thanks, team_lunch). Hareketsiz, parlak parça yok; renkler sıralı gökkuşağı oluşturmaz.
 * Hediye yalnızca görseldir: raf hiçbir istem ya da iş kalitesini etkilemez.
 */
import type { SceneBox } from "./registry";

const WOOD = "#8A5A33", WOOD_D = "#6B4426", BACK = "#4B3322";
const WHITE = "#F4F1EA", CREAM = "#EADFC8", GOLD = "#E0A526", GOLD_D = "#B8841A";

type Item = (x: number, y: number) => SceneBox[];
const b = (x: number, y: number, z: number, w: number, h: number, d: number, c: string): SceneBox => ({ p: [x, y + h / 2, z], s: [w, h, d], c });

/** Her eşya yaklaşık 4 px genişlik, ≤ 6 px yükseklik; (x, y) = raf yüzeyinde eşyanın merkezi. */
const ITEMS: Record<string, Item> = {
  coffee: (x, y) => [b(x, y, 0.4, 3, 2.6, 3, "#6F4A2F"), b(x, y + 2.6, 0.4, 3.2, 0.5, 3.2, WHITE), b(x + 2, y + 0.8, 0.4, 0.8, 1.2, 1, WHITE)],
  tea: (x, y) => [b(x, y, 0.4, 3, 2.6, 3, "#C9822B"), b(x, y + 2.6, 0.4, 3.2, 0.5, 3.2, "#9FD3C7"), b(x + 2, y + 0.8, 0.4, 0.8, 1.2, 1, "#9FD3C7")],
  snack: (x, y) => [b(x, y, 0.4, 4, 0.9, 4, "#D8B07A"), b(x - 0.8, y + 0.9, 0.4, 1, 0.5, 1, "#5B3A24"), b(x + 0.9, y + 0.9, 0.9, 1, 0.5, 1, "#5B3A24")],
  meal: (x, y) => [b(x, y, 0.4, 4.4, 0.6, 4.4, WHITE), b(x - 0.8, y + 0.6, 0.4, 2, 1.1, 2, "#C8553D"), b(x + 1.1, y + 0.6, 0.8, 1.4, 1.2, 1.6, "#7FA650")],
  dessert: (x, y) => [b(x, y, 0.4, 3.6, 1.8, 3.2, "#F2B8C6"), b(x, y + 1.8, 0.4, 3.6, 0.6, 3.2, WHITE), b(x, y + 2.4, 0.4, 1, 1, 1, "#B3262B")],
  plant: (x, y) => [b(x, y, 0.4, 3, 2.2, 3, "#B5623A"), b(x, y + 2.2, 0.4, 3.6, 2.2, 3.6, "#3F8F4F"), b(x, y + 4.4, 0.4, 2, 1.6, 2, "#5FB36B")],
  trophy: (x, y) => [b(x, y, 0.4, 3.4, 0.9, 3, GOLD_D), b(x, y + 0.9, 0.4, 1, 2, 1, GOLD), b(x, y + 2.9, 0.4, 3.2, 2.6, 2.6, GOLD)],
  cosmetic: (x, y) => [b(x, y, 0.4, 4.4, 0.6, 1.6, WOOD_D), b(x, y + 0.6, 0.4, 4.4, 3.2, 1.6, "#7C6BC4"), b(x, y + 3.8, 0.4, 1.4, 0.8, 1.4, "#C9C9D4")],
  thanks: (x, y) => [b(x, y, 0.4, 3.4, 4.2, 0.6, CREAM), b(x, y + 2, 1.0, 1.6, 1.4, 0.4, "#C8433E")],
  team_lunch: (x, y) => [b(x, y, 0.4, 4.4, 2.4, 4.4, "#D9A35B"), b(x, y + 2.4, 0.4, 4.4, 0.5, 4.4, "#B9823F"), b(x, y + 1, 2.7, 2, 0.8, 0.3, WHITE)],
};
export const SHELF_KINDS = Object.keys(ITEMS);

const SLOT_X = [-4, 0, 4] as const;
/** İki raf gözü: üst göz (tahta üstü 8,6 px) ve alt göz (0,8 px); 6 eşyaya kadar, en yeni üst gözün solunda. */
const BASE_Y = [8.6, 8.6, 8.6, 0.8, 0.8, 0.8] as const;
export const SHELF_SLOTS = BASE_Y.length;

/** Dolap gövdesi: arka panel, iki yan, üç tahta (alt, orta, üst); toplam 16,2 px (~0,74 birim). */
function carcass(): SceneBox[] {
  return [
    { p: [0, 8.1, -1.6], s: [14, 16.2, 0.8], c: BACK },
    { p: [-6.7, 8.1, 0], s: [0.8, 16.2, 4], c: WOOD }, { p: [6.7, 8.1, 0], s: [0.8, 16.2, 4], c: WOOD },
    { p: [0, 0.4, 0], s: [14, 0.8, 4], c: WOOD_D }, { p: [0, 8.2, 0], s: [14, 0.8, 4], c: WOOD },
    { p: [0, 15.8, 0], s: [14, 0.8, 4], c: WOOD_D },
  ];
}

/** Rafın tüm kutuları (yerel piksel; +z öne bakar). `kinds`: en yeni önce (en çok 6). */
export function shelfBoxes(kinds: readonly string[]): SceneBox[] {
  const out = carcass();
  kinds.slice(0, SHELF_SLOTS).forEach((k, i) => {
    const item = ITEMS[k] ?? ITEMS.thanks;
    out.push(...item(SLOT_X[i % 3], BASE_Y[i]));
  });
  return out;
}
