/**
 * test şehri: genel, özgün bir test semti ("deneme") ve yanında boş bir kıyı semti ("ek"). Uçtan uca boru hattını kanıtlar:
 * kapı → varış meydanı (iskele) → semt akışı → iki yer tutucu landmark (biri iç mekân sahne modeliyle girilebilir) → iki
 * durak arası tramvay → "Ofise dön". Gerçek bir yeri temsil etmez (yazı, logo, simge, bayrak yok); şehir içerikleri+.
 *
 * Yerleşim (şehir karosu; varış meydanı [0, 12) × [0, 16), avatar −z'ye, semte bakarak varır):
 * deneme [−24, −48] 48 × 48 meydanın arka kenarına bitişik (yerel lj = 47, li 24…35)
 * ek [ 24, −48] 48 × 48 denemenin doğusu (yürüyerek bağlı)
*/
import type { CityMapFile } from "./format";

export const SK0_TEST_MAP: CityMapFile = {
  id: "sk0_test",
  gate: { kind: "pier" },
  sea: true,
  districts: [
    {
      id: "deneme", seed: 20261019, bounds: [-24, -48, 48, 48], theme: "generic",
      landmarks: [
        { id: "kule", shape: "tower", tile: [8, 10], w: 6, d: 6, h: 9, door: [10, 16], interior: "tower" },
        { id: "anit", shape: "dome", tile: [30, 10], w: 8, d: 6, h: 5 },
      ],
      entries: [[29, 46], [46, 24]],
      viewpoints: [[40, 32]],
    },
    {
      id: "ek", seed: 7741, bounds: [24, -48, 48, 48], theme: "harbor",
      landmarks: [],
      entries: [[1, 24]],
    },
  ],
  stops: [
    { id: "durak_a", district: "deneme", tile: [26, 40] },
    { id: "durak_b", district: "deneme", tile: [10, 26] },
  ],
  lines: [
    // şehir karosu: durak_a (2, −8) → kuzeye (2, −22) → batıya durak_b (−14, −22)
    { id: "t1", kind: "tramvay", stops: ["durak_a", "durak_b"], route: [[2, -8], [2, -22], [-14, -22]] },
  ],
};
