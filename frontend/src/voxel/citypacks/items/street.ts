/**
 * CITY-PACKS — sokak ve dekor paketleri: şehir mobilyası, gece ışıkları, park ve bahçe, festival süsleri, canlı malzemeler.
 *
 * Hepsi özgün ve geneldir: marka, logo, gerçek dükkân adı, sponsor, yazı ya da harita yok (tabela yerine düz renk ya da
 * piktogram). Şehir haritasına girenler yalnız durağan grupları kullanır. Canlı malzemeler var olan canlı grupları kullanır
 * (`wave` dalga, `flame` titreşen alev, `snow` kar, `bob` suda sallanma, `flag` dalgalanan kumaş): yeni çizim çağrısı ya da
 * gölgelendirici yok; hareket azaltma açıkken Blocks.tsx hepsini durağan çizer.
 */
import { Kit, type Box } from "../kit";

const IRON = "#2F3437", WOOD = "#8B5E3C", WARM = "#FFE3A3";
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// ------------------------------------------------------------------------------------------ Şehir mobilyası
/** Park bankı (ahşap çıtalar, dökme demir ayak ve kolçak). 2 × 1. */
export function bench(): Box[] {
  const k = new Kit(2, 1);
  for (const z of [0.3, 0.5]) k.b(0.1, 0.42, z, 1.8, 0.07, 0.17, WOOD);
  for (const y of [0.62, 0.8]) k.b(0.1, y, 0.72, 1.8, 0.12, 0.06, WOOD);
  for (const x of [0.15, 1.75]) { k.b(x, 0, 0.3, 0.1, 0.42, 0.5, IRON); k.b(x, 0.42, 0.72, 0.1, 0.52, 0.08, IRON); k.b(x, 0.6, 0.3, 0.1, 0.06, 0.4, IRON); }
  return k.done();
}

/** Dökme demir sokak lambası (sıcak fener başlığı). 1 × 1. */
export function streetLamp(): Box[] {
  const k = new Kit(1, 1);
  k.c(0.5, 0, 0.5, 0.3, 0.3, 0.3, IRON).c(0.5, 0.3, 0.5, 0.09, 2.5, 0.09, IRON).c(0.5, 2.8, 0.5, 0.2, 0.08, 0.2, IRON);
  k.c(0.5, 2.88, 0.5, 0.3, 0.36, 0.3, WARM, "glow").c(0.5, 3.24, 0.5, 0.38, 0.08, 0.38, IRON).c(0.5, 3.32, 0.5, 0.12, 0.12, 0.12, IRON);
  return k.done();
}

/** Taş içme çeşmesi (sütun, yalak, akan su). 1 × 1. */
export function drinkingFountain(): Box[] {
  const k = new Kit(1, 1), ST = "#A8A29A";
  k.c(0.5, 0, 0.5, 0.6, 0.7, 0.6, ST).c(0.5, 0.7, 0.5, 0.72, 0.12, 0.72, "#B9B3AA").c(0.5, 0.82, 0.5, 0.5, 0.03, 0.5, "#62B6DE", "water");
  k.c(0.5, 0.82, 0.18, 0.14, 0.5, 0.12, ST).c(0.5, 1.1, 0.28, 0.05, 0.05, 0.14, "#8A8F94");
  return k.done();
}

/** Gazete ve çiçek büfesi (yeşil gövde, açık tezgâh, renkli raflar; yazı yok). 2 × 2. */
export function newsKiosk(): Box[] {
  const k = new Kit(2, 2), G = "#2F6B4F", G2 = "#244F3B";
  k.b(0.2, 0, 0.3, 1.6, 1.8, 1.4, G).b(0.35, 0.8, 1.68, 1.3, 0.7, 0.04, "#F2E8D0");
  k.b(0.25, 0.8, 1.7, 1.5, 0.08, 0.3, G2);
  for (let n = 0; n < 5; n++) k.b(0.4 + n * 0.25, 0.9, 1.72, 0.2, 0.28, 0.04, ["#E35D5B", "#F2C14E", "#4D9DE0", "#7BC67B", "#C47AC0"][n]);
  k.b(0.1, 1.8, 0.2, 1.8, 0.15, 1.6, G2).b(0.5, 1.95, 0.6, 1.0, 0.25, 0.8, G2).b(0.9, 2.2, 0.9, 0.2, 0.2, 0.2, G2);
  for (const x of [0.25, 1.55]) k.b(x, 0, 1.9, 0.2, 0.5, 0.25, ["#F28AB2", "#F2D14E"][x < 1 ? 0 : 1]);
  return k.done();
}

/** Simit arabası (kırmızı gövde, camlı vitrin, halka simitler, iki teker). 2 × 1. ACTIVITY-FEEL (B5): kasa şasiye, şasi iki yandaki
 *  tekerleklere ve iki dayanak ayağına basar (eski: tekerlekler kasanın yanında ve 0,07 altında; kasa tek ince ayakta asılıydı). */
export function simitCart(): Box[] {
  const k = new Kit(2, 1), RED = "#C62828", BR = "#B5763A";
  k.b(0.2, 0.4, 0.25, 1.4, 0.05, 0.5, IRON); // şasi (0,40–0,45)
  k.b(0.2, 0.45, 0.25, 1.4, 0.55, 0.5, RED).b(0.2, 1.0, 0.25, 1.4, 0.45, 0.5, "#D9EEF5", "glass").b(0.15, 1.45, 0.2, 1.5, 0.06, 0.6, RED);
  for (const x of [0.45, 0.85, 1.25]) for (const y of [1.02, 1.22]) k.b(x, y, 0.4, 0.26, 0.08, 0.22, BR);
  for (const z of [0.3, 0.7]) k.c(1.2, 0, z, 0.44, 0.44, 0.08, IRON); // tekerlek: şasinin iki yanı (zemin–0,44)
  k.c(1.2, 0.18, 0.5, 0.06, 0.06, 0.48, IRON); // dingil
  for (const z of [0.32, 0.68]) k.c(0.35, 0, z, 0.06, 0.4, 0.06, IRON); // dayanak ayakları (zemin–şasi)
  k.b(1.55, 0.85, 0.45, 0.4, 0.05, 0.05, IRON); // itme kolu kasaya geçer
  return k.done();
}

/** Sokak yemeği arabası (ızgara, çizgili şemsiye, tekerler; marka yok). 2 × 1. */
export function foodCart(): Box[] {
  const k = new Kit(2, 1);
  k.b(0.15, 0.4, 0.2, 1.5, 0.7, 0.6, "#E9E4DA").b(0.15, 0.62, 0.79, 1.5, 0.12, 0.03, "#2E86AB");
  k.b(0.25, 1.1, 0.25, 0.8, 0.08, 0.5, "#3A3A3A").b(1.15, 1.1, 0.3, 0.4, 0.18, 0.4, "#C0C4C8");
  k.c(1.0, 1.1, 0.5, 0.06, 1.2, 0.06, "#C0C4C8");
  for (let n = 0; n < 4; n++) k.c(1.0, 2.3, 0.5, 1.6 - n * 0.35, 0.08, 1.2 - n * 0.25, n % 2 ? "#FFFFFF" : "#F2A33A");
  for (const x of [0.35, 1.45]) k.c(x, 0, 0.85, 0.4, 0.4, 0.08, IRON);
  return k.done();
}

/** Tramvay durağı (alçak platform, saçak, bank; tabela yerine piktogram levha). 3 × 1. */
export function tramStop(): Box[] {
  const k = new Kit(3, 1), POST = "#3E4A55";
  k.b(0, 0, 0, 3, 0.16, 1, "#B7B2A8").b(0, 0.16, 0.9, 3, 0.03, 0.1, "#F2C14E");
  for (const x of [0.3, 2.6]) k.b(x, 0.16, 0.15, 0.1, 2.1, 0.1, POST);
  k.b(0.1, 2.26, 0.05, 2.8, 0.1, 0.8, POST).b(0.9, 0.16, 0.2, 1.2, 0.42, 0.35, WOOD);
  k.b(2.75, 0.16, 0.6, 0.08, 2.4, 0.08, POST).b(2.6, 2.1, 0.62, 0.38, 0.38, 0.04, "#2F6FB0").b(2.68, 2.2, 0.6, 0.22, 0.12, 0.04, "#FFFFFF");
  return k.done();
}

/** Otobüs durağı (cam arka panel ve yan, saçak, bank; reklam ya da harita yok). 3 × 1. */
export function busShelter(): Box[] {
  const k = new Kit(3, 1), FR = "#4A5560";
  for (const x of [0.1, 1.45, 2.8]) k.b(x, 0, 0.1, 0.1, 2.1, 0.1, FR);
  k.b(0, 2.1, 0, 3, 0.1, 0.9, FR).b(0.2, 0.2, 0.12, 2.6, 1.7, 0.05, "#CFE8EE", "glass");
  k.b(2.85, 0.2, 0.2, 0.05, 1.7, 0.6, "#DCEFF4").b(0.5, 0.4, 0.3, 2.0, 0.08, 0.35, WOOD).b(0.5, 0, 0.35, 0.08, 0.4, 0.08, FR).b(2.4, 0, 0.35, 0.08, 0.4, 0.08, FR);
  return k.done();
}

/** Saksı (ahşap kasa, toprak, çalı ve çiçekler). 1 × 1. */
export function planter(): Box[] {
  const k = new Kit(1, 1);
  k.c(0.5, 0, 0.5, 0.72, 0.5, 0.72, "#8C6A4F").c(0.5, 0.5, 0.5, 0.62, 0.04, 0.62, "#4E3B2C").c(0.5, 0.54, 0.5, 0.56, 0.42, 0.56, "#4F8A3C");
  for (const [x, z, c] of [[0.3, 0.3, "#F28AB2"], [0.68, 0.4, "#F2D14E"], [0.45, 0.7, "#B48CF2"]] as const) k.c(x, 0.96, z, 0.14, 0.12, 0.14, c);
  return k.done();
}

/** Bisiklet parkı (ters U demirler, bir bisiklet). 2 × 1. */
export function bikeRack(): Box[] {
  const k = new Kit(2, 1), ST = "#9AA3AB";
  k.b(0.1, 0, 0.45, 1.8, 0.05, 0.1, ST);
  for (const x of [0.3, 0.9, 1.5]) { k.b(x, 0, 0.47, 0.06, 0.7, 0.06, ST); k.b(x + 0.24, 0, 0.47, 0.06, 0.7, 0.06, ST); k.b(x, 0.7, 0.47, 0.3, 0.06, 0.06, ST); }
  for (const x of [0.55, 1.35]) { k.c(x, 0, 0.3, 0.06, 0.56, 0.56, IRON).c(x, 0.25, 0.3, 0.02, 0.06, 0.06, IRON); }
  k.c(0.95, 0.45, 0.3, 0.8, 0.06, 0.06, "#2E86AB").c(0.75, 0.55, 0.3, 0.06, 0.4, 0.06, "#2E86AB").c(0.75, 0.78, 0.3, 0.22, 0.05, 0.1, IRON).c(1.25, 0.7, 0.3, 0.06, 0.06, 0.4, IRON);
  return k.done();
}

/** Pazar tezgâhı (ahşap tezgâh, sebze-meyve kasaları, çizgili tente). 2 × 2. */
export function marketStall(): Box[] {
  const k = new Kit(2, 2);
  k.b(0.1, 0.7, 0.3, 1.8, 0.1, 1.2, WOOD);
  for (const [x, z] of [[0.15, 0.35], [1.75, 0.35], [0.15, 1.4], [1.75, 1.4]]) k.b(x, 0, z, 0.1, 0.7, 0.1, "#6B4A30");
  const fruit = ["#D64545", "#F2C14E", "#6BAA3E", "#F28C28", "#8E44AD", "#C9302C"];
  for (let n = 0; n < 6; n++) { const x = 0.2 + (n % 3) * 0.55, z = 0.4 + Math.floor(n / 3) * 0.55; k.b(x, 0.8, z, 0.5, 0.12, 0.45, "#B88A5A").b(x + 0.05, 0.92, z + 0.05, 0.4, 0.12, 0.35, fruit[n]); }
  for (const [x, z] of [[0.05, 0.25], [1.85, 0.25], [0.05, 1.65], [1.85, 1.65]]) k.b(x, 0.8, z, 0.08, 1.3, 0.08, "#6B4A30");
  for (let n = 0; n < 6; n++) k.b(n * 0.35, 2.1, 0.15, 0.35, 0.1, 1.7, n % 2 ? "#FFFFFF" : "#E04F4F");
  return k.done();
}

// ------------------------------------------------------------------------------------------ Gece ışıkları
/** Işık zinciri (iki direk, sarkık tel, sıcak ampuller). 4 × 1. */
export function fairyLights(): Box[] {
  const k = new Kit(4, 1);
  for (const x of [0.15, 3.75]) k.b(x, 0, 0.45, 0.1, 2.4, 0.1, IRON);
  for (let n = 0; n < 9; n++) {
    const u = (n + 0.5) / 9, x = 0.2 + u * 3.6, y = 2.35 - Math.sin(u * Math.PI) * 0.45;
    k.b(x - 0.2, y, 0.48, 0.4, 0.025, 0.025, "#3A3A3A");
    k.c(x, y - 0.14, 0.5, 0.1, 0.12, 0.1, n % 3 === 1 ? "#FFD27A" : WARM, "glow");
  }
  return k.done();
}

/** Çift fenerli direk. 1 × 1. */
export function lanternPost(): Box[] {
  const k = new Kit(1, 1);
  k.c(0.5, 0, 0.5, 0.36, 0.2, 0.36, IRON).c(0.5, 0.2, 0.5, 0.1, 2.3, 0.1, IRON).c(0.5, 2.3, 0.5, 0.9, 0.07, 0.07, IRON);
  for (const x of [0.1, 0.9]) { k.c(x, 1.98, 0.5, 0.22, 0.3, 0.22, WARM, "glow"); k.c(x, 2.28, 0.5, 0.28, 0.06, 0.28, IRON); }
  return k.done();
}

/** Işıklı çeşme (taş havuz, su, havuz altında ışık şeridi, orta fıskiye). 2 × 2. */
export function litFountain(): Box[] {
  const k = new Kit(2, 2), ST = "#B9B3AA";
  k.b(0.1, 0, 0.1, 1.8, 0.4, 0.15, ST).b(0.1, 0, 1.75, 1.8, 0.4, 0.15, ST).b(0.1, 0, 0.25, 0.15, 0.4, 1.5, ST).b(1.75, 0, 0.25, 0.15, 0.4, 1.5, ST);
  k.b(0.25, 0, 0.25, 1.5, 0.3, 1.5, "#4BA3D0", "water");
  for (const [x, z, w, d] of [[0.25, 0.25, 1.5, 0.06], [0.25, 1.69, 1.5, 0.06], [0.25, 0.31, 0.06, 1.38], [1.69, 0.31, 0.06, 1.38]]) k.b(x, 0.3, z, w, 0.05, d, "#8FE3FF", "glow");
  k.c(1, 0.3, 1, 0.3, 0.5, 0.3, ST).c(1, 0.8, 1, 0.1, 0.7, 0.1, "#BDE8FA", "water"); // fıskiye 0,5 → 0,7 ( c)
  return k.done();
}

/** Yol işaret ışıkları (üç alçak direk, parlak tepe). 3 × 1. */
export function pathLights(): Box[] {
  const k = new Kit(3, 1);
  for (const x of [0.5, 1.5, 2.5]) k.c(x, 0, 0.5, 0.2, 0.5, 0.2, "#3F454B").c(x, 0.5, 0.5, 0.22, 0.12, 0.22, "#FFF1C2", "glow").c(x, 0.62, 0.5, 0.26, 0.05, 0.26, "#3F454B");
  return k.done();
}

// ------------------------------------------------------------------------------------------ Park ve bahçe
/** Çiçek tarhı (taş kenar, toprak, renkli çiçek kümeleri). 2 × 2. */
export function flowerBed(): Box[] {
  const k = new Kit(2, 2), ED = "#B9B3AA";
  k.b(0.1, 0, 0.1, 1.8, 0.2, 0.1, ED).b(0.1, 0, 1.8, 1.8, 0.2, 0.1, ED).b(0.1, 0, 0.2, 0.1, 0.2, 1.6, ED).b(1.8, 0, 0.2, 0.1, 0.2, 1.6, ED);
  k.b(0.2, 0, 0.2, 1.6, 0.16, 1.6, "#5A4332");
  const cols = ["#F28AB2", "#F2D14E", "#B48CF2", "#FF7F50", "#FFFFFF"];
  for (let n = 0; n < 12; n++) {
    const x = 0.35 + (n % 4) * 0.42, z = 0.35 + Math.floor(n / 4) * 0.55;
    k.c(x, 0.16, z, 0.08, 0.28, 0.08, "#4F8A3C").c(x, 0.42, z, 0.2, 0.14, 0.2, cols[n % cols.length]);
  }
  return k.done();
}

/** Çardak (sekizgen beyaz döşeme, ince direkler, kademeli çatı). 3 × 3. */
export function gazebo(): Box[] {
  const k = new Kit(3, 3), WH = "#F4F1EA", ROOF = "#5E7C8A";
  k.oct(1.5, 0, 1.5, 2.8, 0.25, "#DCD6CA");
  for (let n = 0; n < 8; n++) { const a = (n / 8) * Math.PI * 2; k.c(1.5 + Math.cos(a) * 1.15, 0.25, 1.5 + Math.sin(a) * 1.15, 0.1, 1.9, 0.1, WH); }
  k.oct(1.5, 0.75, 1.5, 2.5, 0.06, WH);
  k.oct(1.5, 2.15, 1.5, 3.0, 0.2, ROOF).oct(1.5, 2.35, 1.5, 2.2, 0.25, ROOF).oct(1.5, 2.6, 1.5, 1.3, 0.25, ROOF).c(1.5, 2.85, 1.5, 0.14, 0.3, 0.14, WH);
  return k.done();
}

/** Nilüferli havuz (taş kenar, su, nilüfer yaprakları ve pembe çiçekler). 3 × 2. */
export function lilyPond(): Box[] {
  const k = new Kit(3, 2), ED = "#A8A29A";
  k.b(0, 0, 0, 3, 0.25, 0.15, ED).b(0, 0, 1.85, 3, 0.25, 0.15, ED).b(0, 0, 0.15, 0.15, 0.25, 1.7, ED).b(2.85, 0, 0.15, 0.15, 0.25, 1.7, ED);
  k.b(0.15, 0, 0.15, 2.7, 0.18, 1.7, "#3E8FB0", "water");
  for (const [x, z, f] of [[0.6, 0.5, 1], [1.3, 1.2, 0], [2.1, 0.6, 1], [2.3, 1.4, 0], [0.9, 1.4, 1]] as const) {
    k.c(x, 0.18, z, 0.36, 0.03, 0.3, "#4F8A3C");
    if (f) k.c(x + 0.05, 0.21, z, 0.12, 0.1, 0.12, "#F7A8C8");
  }
  return k.done();
}

/** Budama heykel (saksıda üç kademeli yeşil top). 1 × 1. */
export function topiary(): Box[] {
  const k = new Kit(1, 1), G = "#3F7A3A";
  k.c(0.5, 0, 0.5, 0.5, 0.4, 0.5, "#B5643C").c(0.5, 0.4, 0.5, 0.08, 0.3, 0.08, "#5A3E2A");
  k.oct(0.5, 0.6, 0.5, 0.62, 0.5, G).oct(0.5, 1.15, 0.5, 0.45, 0.4, G).oct(0.5, 1.6, 0.5, 0.28, 0.3, G);
  return k.done();
}

/** Gül kemeri (iki kafes direk, kemer tepe, gül kümeleri). 2 × 1. */
export function gardenArch(): Box[] {
  const k = new Kit(2, 1), WH = "#F4F1EA";
  for (const x of [0.15, 1.75]) { k.b(x, 0, 0.35, 0.1, 2.0, 0.3, WH); for (const y of [0.5, 1.0, 1.5]) k.b(x - 0.04, y, 0.32, 0.18, 0.05, 0.36, "#4F8A3C"); }
  k.b(0.15, 2.0, 0.35, 1.7, 0.1, 0.3, WH).b(0.35, 2.1, 0.35, 1.3, 0.12, 0.3, WH).b(0.7, 2.22, 0.35, 0.6, 0.1, 0.3, WH);
  for (const [x, y] of [[0.3, 2.1], [0.9, 2.3], [1.5, 2.15], [0.2, 1.2], [1.8, 0.8], [1.2, 2.3]] as const) k.c(x, y, 0.5, 0.18, 0.16, 0.36, x > 1 ? "#E35D7A" : "#F7A8C8");
  return k.done();
}

/** Kuş banyosu (taş ayak, çanak, su, küçük kuş). 1 × 1. */
export function birdBath(): Box[] {
  const k = new Kit(1, 1), ST = "#B9B3AA";
  k.c(0.5, 0, 0.5, 0.4, 0.12, 0.4, ST).c(0.5, 0.12, 0.5, 0.16, 0.6, 0.16, ST).c(0.5, 0.72, 0.5, 0.7, 0.1, 0.7, ST);
  k.c(0.5, 0.82, 0.5, 0.56, 0.05, 0.56, "#6BBCE0", "water").c(0.72, 0.82, 0.5, 0.12, 0.1, 0.16, "#7A5A3A").c(0.72, 0.93, 0.55, 0.07, 0.07, 0.07, "#7A5A3A");
  return k.done();
}

// ------------------------------------------------------------------------------------------ Festival süsleri
/** Yeni yıl çamı (kademeli çam, parlak süs topları, tepede yıldız; dinî simge yok). 2 × 2. */
export function newYearTree(): Box[] {
  const k = new Kit(2, 2), G = "#2F6B45";
  k.c(1, 0, 1, 0.3, 0.4, 0.3, "#6B4A30");
  k.c(1, 0.4, 1, 1.8, 0.7, 1.8, G).c(1, 1.1, 1, 1.4, 0.7, 1.4, G).c(1, 1.8, 1, 1.0, 0.6, 1.0, G).c(1, 2.4, 1, 0.55, 0.5, 0.55, G);
  const cols = ["#FF5A5F", "#FFD166", "#4DCCBD", "#B28DFF"];
  for (let n = 0; n < 8; n++) { const a = n * 2.3, y = 0.6 + (n % 4) * 0.55, r = 0.92 - (n % 4) * 0.18; k.c(1 + Math.cos(a) * r, y, 1 + Math.sin(a) * r, 0.14, 0.14, 0.14, cols[n % 4], "glow"); }
  k.c(1, 2.9, 1, 0.24, 0.24, 0.24, "#FFE066", "glow");
  for (const [x, c] of [[0.3, "#D64545"], [1.6, "#2E86AB"]] as const) k.c(x, 0, 1.75, 0.35, 0.3, 0.3, c);
  return k.done();
}

/** Fener dizisi (iki direk, tel, beş renkli kâğıt fener). 4 × 1. */
export function lanternString(): Box[] {
  const k = new Kit(4, 1);
  for (const x of [0.15, 3.75]) k.b(x, 0, 0.45, 0.1, 2.5, 0.1, "#5A3E2A");
  k.b(0.2, 2.4, 0.48, 3.6, 0.03, 0.03, "#3A3A3A");
  const cols = ["#FF6B6B", "#FFD166", "#06D6A0", "#4DA8FF", "#C792EA"];
  for (let n = 0; n < 5; n++) { const x = 0.6 + n * 0.7; k.c(x, 2.25, 0.5, 0.03, 0.15, 0.03, "#3A3A3A").c(x, 1.9, 0.5, 0.3, 0.36, 0.3, cols[n], "glow").c(x, 1.86, 0.5, 0.2, 0.04, 0.2, "#5A3E2A"); }
  return k.done();
}

/** Hasat balkabakları (üç balkabağı, oyma yüzlerde sıcak ışık, saman balyası). 2 × 1. */
export function harvestPumpkins(): Box[] {
  const k = new Kit(2, 1), OR = "#E8771E";
  k.b(0.1, 0, 0.3, 0.9, 0.45, 0.5, "#D9B95B").b(0.1, 0.15, 0.3, 0.9, 0.04, 0.52, "#B8963E");
  for (const [x, y, s] of [[0.55, 0.45, 0.42], [1.4, 0, 0.55], [1.75, 0, 0.36]] as const) {
    k.c(x, y, 0.55, s, s * 0.8, s, OR).c(x, y + s * 0.8, 0.55, 0.06, 0.1, 0.06, "#4F6B2A");
    k.c(x - s * 0.18, y + s * 0.45, 0.55 + s / 2 + 0.005, s * 0.16, s * 0.14, 0.02, "#FFD166", "glow");
    k.c(x + s * 0.18, y + s * 0.45, 0.55 + s / 2 + 0.005, s * 0.16, s * 0.14, 0.02, "#FFD166", "glow");
  }
  return k.done();
}

/** İkram tezgâhı (bayram ve kutlama şekerleri: renkli kâseler, tente; yazı yok). 2 × 2. */
export function treatStall(): Box[] {
  const k = new Kit(2, 2);
  k.b(0.15, 0, 0.4, 1.7, 0.85, 1.1, "#F6E7D2").b(0.1, 0.85, 0.35, 1.8, 0.08, 1.2, "#C98A4A");
  const cols = ["#FF8FAB", "#FFD166", "#8DE0C3", "#B5A1FF", "#FF9F6E", "#9ED8FF"];
  for (let n = 0; n < 6; n++) { const x = 0.45 + (n % 3) * 0.55, z = 0.65 + Math.floor(n / 3) * 0.5; k.c(x, 0.93, z, 0.4, 0.1, 0.36, "#FFFFFF").c(x, 1.03, z, 0.3, 0.1, 0.26, cols[n]); }
  for (const x of [0.15, 1.75]) k.b(x, 0.93, 0.35, 0.08, 1.2, 0.08, "#C98A4A");
  for (let n = 0; n < 5; n++) k.b(0.05 + n * 0.38, 2.1, 0.2, 0.38, 0.1, 1.0, n % 2 ? "#FFFFFF" : "#3BB3A3");
  return k.done();
}

/** Işıklı kemer kapı (iki direk, kemer tepe, ampul sırası). 3 × 1. */
export function lightArch(): Box[] {
  const k = new Kit(3, 1), FR = "#3E4A55";
  for (const x of [0.2, 2.7]) k.b(x, 0, 0.4, 0.12, 2.4, 0.2, FR);
  const pts: [number, number][] = [];
  for (let n = 0; n <= 10; n++) { const u = n / 10; pts.push([0.26 + u * 2.5, 2.4 + Math.sin(u * Math.PI) * 0.6]); }
  for (let n = 0; n < 10; n++) { const [x0, y0] = pts[n], [x1, y1] = pts[n + 1]; k.c((x0 + x1) / 2, Math.min(y0, y1), 0.5, Math.abs(x1 - x0) + 0.02, Math.abs(y1 - y0) + 0.08, 0.12, FR); }
  for (let n = 1; n < 10; n += 2) k.c(pts[n][0], pts[n][1] + 0.08, 0.6, 0.12, 0.12, 0.06, n % 4 === 1 ? "#FFD166" : "#FF8FAB", "glow");
  for (const y of [0.6, 1.2, 1.8]) for (const x of [0.26, 2.76]) k.c(x, y, 0.6, 0.1, 0.1, 0.06, "#FFF1C2", "glow");
  return k.done();
}

// ------------------------------------------------------------------------------------------ Canlı malzemeler (dünya yapıcı)
/** Dalgalı havuz: `wave` grubu karolar yan yana "yuvarlanır" (hareket azaltmada durağan). 3 × 3. */
export function ripplePool(): Box[] {
  const k = new Kit(3, 3), ED = "#9CA3AF";
  k.b(0, 0, 0, 3, 0.35, 0.2, ED).b(0, 0, 2.8, 3, 0.35, 0.2, ED).b(0, 0, 0.2, 0.2, 0.35, 2.6, ED).b(2.8, 0, 0.2, 0.2, 0.35, 2.6, ED);
  k.b(0.2, 0, 0.2, 2.6, 0.06, 2.6, "#2E6F8E");
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) k.b(0.2 + i * 0.65, 0.18, 0.2 + j * 0.65, 0.65, 0.1, 0.65, (i + j) % 2 ? "#3FA7D6" : "#5CB8E0", "wave");
  return k.done();
}

/** Lav havzası: parlayan lav yüzeyi (`glow`) ve titreşen alev dilleri (`flame`). 2 × 2. */
export function lavaBasin(): Box[] {
  const k = new Kit(2, 2), RK = "#3B3330";
  k.b(0, 0, 0, 2, 0.4, 0.25, RK).b(0, 0, 1.75, 2, 0.4, 0.25, RK).b(0, 0, 0.25, 0.25, 0.4, 1.5, RK).b(1.75, 0, 0.25, 0.25, 0.4, 1.5, RK);
  k.b(0.25, 0, 0.25, 1.5, 0.3, 1.5, "#FF6A1A", "glow").b(0.6, 0.3, 0.7, 0.5, 0.02, 0.4, "#FFB347", "glow");
  for (const [x, z, h] of [[0.7, 0.7, 0.5], [1.3, 1.1, 0.7], [0.9, 1.35, 0.4]] as const) k.c(x, 0.3, z, 0.22, h, 0.22, "#FFB347", "flame");
  k.c(1.85, 0.4, 0.3, 0.3, 0.3, 0.3, RK).c(0.2, 0.4, 1.7, 0.35, 0.22, 0.3, RK);
  return k.done();
}

/** Kar yağan köşe: karlı zemin, karlı çam ve düşen kar taneleri (`snow`; hareket azaltmada durağan). 3 × 3. */
export function snowCorner(): Box[] {
  const k = new Kit(3, 3), G = "#2F6B45", SN = "#F4F7FB";
  k.b(0, 0, 0, 3, 0.08, 3, SN);
  k.c(1.5, 0.08, 1.5, 0.2, 0.4, 0.2, "#5A3E2A");
  for (const [y, w] of [[0.48, 1.6], [1.0, 1.2], [1.5, 0.8], [1.95, 0.45]] as const) { k.c(1.5, y, 1.5, w, 0.5, w, G); k.c(1.5, y + 0.45, 1.5, w * 0.8, 0.08, w * 0.8, SN); }
  k.c(0.5, 0.08, 2.4, 0.5, 0.45, 0.5, SN).c(0.5, 0.53, 2.4, 0.36, 0.34, 0.36, SN).c(0.5, 0.87, 2.4, 0.06, 0.06, 0.12, "#F28C28");
  for (let n = 0; n < 28; n++) k.b(hash(n) * 2.9, 0.4 + hash(n + 50) * 7.6, hash(n + 99) * 2.9, 0.06, 0.06, 0.06, "#FFFFFF", "snow");
  return k.done();
}

/** Yüzen fenerler: küçük göl (`water`) ve suda sallanan fenerler (`bob`). 3 × 3. */
export function floatingLanterns(): Box[] {
  const k = new Kit(3, 3), ED = "#8A8478";
  k.b(0, 0, 0, 3, 0.25, 0.2, ED).b(0, 0, 2.8, 3, 0.25, 0.2, ED).b(0, 0, 0.2, 0.2, 0.25, 2.6, ED).b(2.8, 0, 0.2, 0.2, 0.25, 2.6, ED);
  k.b(0.2, 0, 0.2, 2.6, 0.16, 2.6, "#245E86", "water");
  const cols = ["#FFC069", "#FF9F6E", "#FFD166", "#FFB3C1", "#FFE7A3", "#FFC069"];
  for (let n = 0; n < 6; n++) { const x = 0.6 + (n % 3) * 0.9, z = 0.7 + Math.floor(n / 3) * 1.3 + (n % 2) * 0.2; k.c(x, 0.18, z, 0.3, 0.06, 0.3, "#C98A4A", "bob").c(x, 0.24, z, 0.22, 0.26, 0.22, cols[n], "bob"); }
  return k.done();
}

/** Dalgalanan flama dizisi: iki direk ve rüzgârda dalgalanan sekiz renkli flama (`flag`). 4 × 1. */
export function festivalBunting(): Box[] {
  const k = new Kit(4, 1);
  for (const x of [0.15, 3.75]) k.b(x, 0, 0.45, 0.1, 2.6, 0.1, "#5A3E2A");
  k.b(0.2, 2.5, 0.48, 3.6, 0.03, 0.03, "#3A3A3A");
  const cols = ["#FF6B6B", "#FFD166", "#06D6A0", "#4DA8FF", "#C792EA", "#FF9F6E", "#8DE0C3", "#FFB3C1"];
  // flag grubu: kumaş 1 birim enlidir ve direğin çevresinde döner — ince şeritler olarak dizilir (pivot = merkez − 0,5)
  for (let n = 0; n < 8; n++) k.c(0.75 + n * 0.4, 2.0, 0.5, 0.3, 0.45, 0.04, cols[n], "flag");
  return k.done();
}

/** Neon çerçeve: koyu çerçeve içinde pembe ve camgöbeği ışık tüpleri (soyut desen; yazı ya da marka yok). 2 × 1. */
export function neonFrame(): Box[] {
  const k = new Kit(2, 1), FR = "#1F2430";
  k.b(0.1, 0, 0.4, 0.1, 2.4, 0.1, FR).b(1.8, 0, 0.4, 0.1, 2.4, 0.1, FR).b(0.1, 0.9, 0.45, 1.8, 1.5, 0.06, FR);
  for (const [x, y, w, h, c] of [[0.3, 1.1, 1.4, 0.06, "#FF4FD8"], [0.3, 2.14, 1.4, 0.06, "#FF4FD8"], [0.3, 1.1, 0.06, 1.1, "#FF4FD8"], [1.64, 1.1, 0.06, 1.1, "#FF4FD8"],
    [0.55, 1.4, 0.9, 0.06, "#3EF0FF"], [0.55, 1.8, 0.9, 0.06, "#3EF0FF"], [0.97, 1.4, 0.06, 0.46, "#3EF0FF"]] as const) k.b(x, y, 0.52, w, h, 0.04, c, "glow");
  return k.done();
}

/** Cam köşk: ince çerçeve, cam duvarlar ve çatı, içeride saksı. 3 × 3. */
export function glassPavilion(): Box[] {
  const k = new Kit(3, 3), FR = "#E8ECEF", GL = "#CFE8EE";
  k.b(0.1, 0, 0.1, 2.8, 0.15, 2.8, "#C9C4BA");
  for (const [x, z] of [[0.15, 0.15], [2.75, 0.15], [0.15, 2.75], [2.75, 2.75]]) k.b(x, 0.15, z, 0.1, 2.2, 0.1, FR);
  k.b(0.25, 0.15, 0.15, 2.5, 2.2, 0.05, GL, "glass").b(0.15, 0.15, 0.25, 0.05, 2.2, 2.5, GL, "glass").b(2.8, 0.15, 0.25, 0.05, 2.2, 2.5, GL, "glass");
  k.b(0.25, 1.3, 2.8, 2.5, 1.05, 0.05, GL, "glass").b(0.1, 2.35, 0.1, 2.8, 0.08, 2.8, GL, "glass").b(0.6, 2.43, 0.6, 1.8, 0.3, 1.8, GL, "glass");
  k.c(1.5, 0.15, 1.3, 0.5, 0.4, 0.5, "#B5643C").c(1.5, 0.55, 1.3, 0.6, 0.7, 0.6, "#4F8A3C");
  return k.done();
}
