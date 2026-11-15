/**
 * W1-IST — İstanbul şehir stili ( İstanbul kartı). Palet özgündür: Arnavut kaldırımı gri-kahve,
 * pastel ahşap konaklar (`ottoman` cephe), kiremit çatı, Boğaz mavisi. kulüp renk kombinasyonu (sarı-kırmızı,
 * sarı-lacivert, siyah-beyaz), bayrak kırmızısı ya da ulaşım livresi yok; tente renkleri yumuşak ve beyaz şeritle dönüşümlü.
*/
import type { CityStyle } from "../style";

export const ISTANBUL_STYLE: CityStyle = {
  id: "istanbul",
  ground: {
    street: ["#8C8279", "#82786F"],
    sidewalk: ["#CFC3B0", "#C4B8A4"],
    plaza: ["#D9CBB2", "#CFC0A5"],
    grass: ["#79B851", "#6EAD4A"],
    quay: ["#AAA49A", "#9E988D"],
    under: "#6B5E4E",
  },
  water: "#2E7FA8",
  facade: "ottoman",
  walls: ["#F0D9B5", "#C9DCCB", "#E7BBA8", "#BACBDD", "#E9D9C4"],
  trim: "#F6F0E4",
  roof: "tile",
  roofColor: "#B4583F",
  window: "#3F5566",
  windowLit: "#FFD98A",
  door: "#6B3F22",
  tree: "plane",
  lamp: { post: "#2F3640", glow: "#FFE2A0" },
  awnings: ["#3F7D6E", "#C8553D", "#4A6FA5", "#7A5C99"],
  far: ["#9DB0C2", "#A8B9C8", "#92A6B8"],
};

/**
 * RB-IST — simge yapı paleti (kullanıcı kararı 2026-10-18: şehir simgeleri tanınır, sahnenin ortasında). Gerçek yapıları
 * andıran stilize renkler; logo, yazı, bayrak yok. Ayasofya benzeri: pembe-aşı boyası duvar + kurşun gri kubbe; Sultanahmet
 * benzeri: gri-mavi taş + kurşun mavi-gri kubbeler; Galata benzeri: bej taş gövde + koyu kurşun külah; Boğaz köprüsü: açık gri.
 */
export const ISTANBUL_LANDMARKS = {
  hsWall: "#D9A07E", hsWall2: "#C78A6A", hsLead: "#7F8A94", hsLead2: "#8E98A1", hsMinaret: "#E6D8C3", hsMinaret2: "#D4A68A",
  bmStone: "#B4BDC7", bmStone2: "#A2ADB9", bmDome: "#7E91A5", bmMinaret: "#CDD4DB",
  galata: "#C8B69A", galata2: "#B6A487", galataTop: "#DACBB0", galataCap: "#56616D",
  bridge: "#C9CED4", bridgeDeck: "#99A2AC", cable: "#D3D8DE",
  opening: "#4E3E33", finial: "#C9A44C",
  /** BIG-IST: kapalı çarşı (taş kemer, kurşun tonoz), mısır çarşısı salonu, hipodrom anıtları, yamaç taşı */
  bazaarStone: "#D2C2A3", bazaarRib: "#B9A27E", bazaarVault: "#8E98A1", spiceHall: "#CDB18C", spiceDome: "#808C97",
  spices: ["#C2410C", "#D97706", "#A16207", "#7C2D12", "#65A30D", "#B91C1C"],
  obelisk: "#C9A27A", column: "#A99C88", hillStone: "#B7A88E", hillGreen: "#6E9E4A",
  /** gece yumuşak, durağan projektör yıkaması (ek. katmanlı pencere işareti; animasyon yok) */
  flood: "#A87545", // LANDMARK-FIDELITY: gece altın sarısı yıkama okunur (eski #8A6038 neredeyse görünmüyordu)
  /** Kız Kulesi benzeri (kamu malı tarihî yapı, yalnız dış): kireç badanalı taş, kurşun külah, kaya ada, fener*/
  kzWall: "#EFE7DA", kzBand: "#DCD2C2", kzLead: "#7F8A94", kzRock: "#857A6C", kzRock2: "#6F665A", kzQuay: "#C9BFAC",
  kzGlass: "#CFE6F0", kzLamp: "#FFE7A3",
} as const;
