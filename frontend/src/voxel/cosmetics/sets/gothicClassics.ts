/**
 * HERO-PACKS — "Gotik Klasikler" / Gothic Classics (kamu malı 19. yy romanları; yalnız KİTAPTAKİ tarif; büyük set:
 * 6 kostüm, 2 masa süsü, 1 kutlama).
 *
 * - Karpat Kontu: Stoker (1897) — uzun beyaz bıyıklı yaşlı bir adam, tepeden tırnağa siyah giysi. Kaçınılan: yüksek yakalı
 *   opera pelerini, sivri saç çizgisi ve 1931 film makyajı.
 * - Yapılmış Dev: Shelley (1818) — uzun, dalgalı siyah saç, yamalı eski giysi. Kaçınılan: düz kafa, boyunda cıvata, yeşil ten
 *   (1931 stüdyo makyajı ve tescilli görüntüsü).
 * - Sisli Sokak Dedektifi: 1890'lar dergi resimlerindeki (kamu malı) pelerinli palto ve kulaklıklı kasket; ad, dizi ve film
 *   görsel kimlikleri (adı tescilli dizi başlıkları) kullanılmadı.
 * - Sargılı Yabancı: Wells (1897) — sargılı baş, iri renkli gözlük, eldiven, uzun palto, geniş şapka. Romanın adı ve stüdyo
 *   afişi kullanılmadı.
 * - Ay Kurdu: halk anlatısının genel kurt adamı (kukuletalı kürk kostüm); belirli bir 1941 film makyajı ya da adı yok.
 * - Kuzgunlu Şair: 1840'ların kamu malı gotik şiirinden esinli genel Viktorya dönemi şairi (gerçek kişi tasviri yok).
 * Masa süsleri (şamdan, kule saati) ve dolunay-sis kutlaması geneldir; kafatası ve dinî simge yok.
 * Adların hiçbiri roman karakterinin adı değildir (özgün tanımlayıcı adlar).
 */
import { suit } from "../kit";
import type { CosmeticSet, SceneBox } from "../registry";

const BLACK = "#1C1917", BLACK_L = "#292524", SILVER = "#E7E5E4";
const RAG = "#6B5B45", RAG_D = "#4A3F30", PATCH = "#8C7A5B", HAIR = "#111111";
const TWEED = "#7A6A4F", TWEED_D = "#5E513C", CHECK = "#9C8A68";
const COAT = "#3F3A36", BANDAGE = "#EDE6D6", LENS = "#3B82F6";
const FURC = "#6B5E54", FURC_D = "#4E443D", FURC_L = "#9C8F84";
const INK = "#1F1B2E", CRAVAT = "#F5F0E6", RAVEN = "#111827";

/** Dolunay ve sis: dolunay yükselir, sis kutuları yerde süzülür; statik hâl: gökte dolunay + yerde durgun sis şeridi. */
function moonFog(t: number, calm: boolean): SceneBox[] {
  const out: SceneBox[] = [];
  const rise = calm ? 1 : Math.min(1, t * 1.4);
  out.push({ p: [8, 10 + rise * 22, -10], s: [8, 8, 1], c: "#FEF9C3", glow: true });
  out.push({ p: [6.8, 11 + rise * 22, -9.4], s: [2, 2, 0.4], c: "#FDE68A" });
  for (let i = 0; i < 12; i++) {
    const x = -24 + i * 4.4 + (calm ? 0 : Math.sin(t * 5 + i) * 2.4);
    out.push({ p: [x, 1.2 + (i % 3) * 0.6, (i % 2) * 6 - 3], s: [6, 2, 5], c: i % 2 ? "#CBD5E1" : "#E2E8F0" });
  }
  return out;
}

export const GOTHIC_CLASSICS: CosmeticSet = {
  id: "gothic-classics", bucket: "large", ip_risk: 1, culture_risk: 0, signature: "gothic-classics-fog-detective", free_after_months: 12,
  tint: "#292524", group: "costume",
  items: [
    {
      id: "gothic-classics-carpathian-count", slot: "outfit", surfaces: ["avatar", "me", "collection"],
      wear: (_a, box) => {
        // tepeden tırnağa siyah: uzun redingot, yelek düğmeleri, gümüş saat zinciri; uzun beyaz bıyık (pelerin YOK)
        suit(box, { body: BLACK, sleeve: BLACK, glove: BLACK_L, leg: BLACK_L, boot: BLACK }, true);
        box("body", [0, 10.4, 3.0], [2.4, 6.4, 0.2], BLACK_L);
        for (const y of [12.2, 10.6, 9]) box("body", [0, y, 3.15], [0.6, 0.6, 0.2], SILVER);
        box("body", [1.8, 9.8, 3.15], [2.4, 0.3, 0.2], SILVER, { r: [0, 0, -0.3] });
        for (const x of [-1.6, 1.6]) box("body", [x, 13.2, 3.0], [1.6, 2.4, 0.3], BLACK_L, { r: [0, 0, x < 0 ? 0.3 : -0.3] });
        box("head", [0, 3.7, 5.22], [3.2, 0.7, 0.3], SILVER);                // bıyık
        for (const x of [-1.9, 1.9]) box("head", [x, 3, 5.22], [0.6, 1.6, 0.3], SILVER);
      },
    },
    {
      id: "gothic-classics-made-giant", slot: "outfit", surfaces: ["avatar", "me", "collection"], head: true,
      wear: (_a, box) => {
        // yamalı eski palto, kaba dikiş izleri, uzun dalgalı siyah saç (kafa düz değil, cıvata yok)
        suit(box, { body: RAG, sleeve: RAG_D, leg: RAG_D, boot: "#3F2A1D" }, true);
        for (const [x, y] of [[-2.4, 11.6], [2.2, 8.4], [-1.6, 5.6]] as const) box("body", [x, y, 3.05], [2.2, 2, 0.2], PATCH);
        for (const y of [12.4, 9.8, 7.2]) box("body", [0.4, y, 3.12], [3.4, 0.3, 0.2], "#2B2118");
        for (const bone of ["armL", "armR"] as const) {
          box(bone, [0, -4, 1.55], [2, 0.3, 0.2], "#2B2118");
          box(bone, [0, -6.6, 0], [3.2, 1, 3.2], RAG);                      // yırtık kol ağzı
        }
        box("head", [0, 10.4, -0.4], [10.6, 1.6, 10.4], HAIR, { lod: 0 });  // dalgalı saç (yuvarlak, düz tepe değil)
        box("head", [0, 6, -5.4], [10.6, 9.4, 1], HAIR, { lod: 0 });
        for (const x of [-5.3, 5.3]) box("head", [x, 6.8, -1.6], [0.8, 7.6, 6.4], HAIR);
        for (const x of [-3, 0, 3]) box("head", [x, 9.8, 4.8], [2.4, 1.2, 1], HAIR, { r: [0, 0, x * 0.1] });
        box("head", [0, 1.2, -5.2], [8, 2.4, 1], HAIR);
      },
    },
    {
      id: "gothic-classics-fog-detective", slot: "outfit", surfaces: ["avatar", "me", "collection"], head: true,
      wear: (_a, box) => {
        // kareli tüvit pelerinli palto (omuz pelerini), kulaklıklı kasket, göğüs cebinde büyüteç
        suit(box, { body: TWEED, sleeve: TWEED, glove: "#5B3A29", leg: TWEED_D, boot: "#3F2A1D" }, true);
        box("body", [0, 12.4, 0], [10.6, 4, 7.2], TWEED_D, { lod: 0 });       // omuz pelerini
        for (const x of [-3.6, -1.2, 1.2, 3.6]) box("body", [x, 12.4, 3.65], [0.3, 3.8, 0.2], CHECK);
        box("body", [0, 13.2, 3.65], [10.4, 0.3, 0.2], CHECK);
        box("body", [2.8, 8.4, 3.2], [1.6, 1.6, 0.3], "#B8C4CC", { o: 0.82 }); // büyüteç camı
        box("body", [2.8, 7, 3.2], [0.4, 1.4, 0.3], "#5B3A29");
        box("head", [0, 10.8, 0], [10.8, 2.4, 10.8], TWEED, { lod: 0 });
        box("head", [0, 10.2, 5.8], [6, 0.6, 1.8], TWEED_D);                 // ön siper
        box("head", [0, 10.2, -5.8], [6, 0.6, 1.8], TWEED_D);                // arka siper
        for (const x of [-5.5, 5.5]) box("head", [x, 8.4, 0], [0.6, 3, 4], TWEED_D);   // kulaklık
        box("head", [0, 12.2, 0], [10.9, 0.3, 0.3], CHECK);
      },
    },
    {
      id: "gothic-classics-bandaged-stranger", slot: "outfit", surfaces: ["avatar", "me", "collection"], head: true, eyes: true,
      wear: (_a, box) => {
        // sargılı baş + iri mavi gözlük + geniş şapka, yüksek yakalı uzun palto, eldiven
        suit(box, { body: COAT, sleeve: COAT, glove: "#1F2937", leg: "#292524", boot: "#1C1917" }, true);
        box("body", [0, 14, 0], [9.6, 2, 6.6], COAT, { lod: 0 });
        for (const y of [11.4, 9.4, 7.4]) box("body", [-1.2, y, 3.05], [0.6, 0.6, 0.2], "#78716C");
        box("head", [0, 5, 0], [10.4, 10.2, 10.4], BANDAGE, { lod: 0 });
        for (const y of [1.8, 4.2, 8.4]) box("head", [0, y, 5.25], [10.5, 0.4, 0.2], "#D6CDB8", { r: [0, 0, 0.08] });
        for (const x of [-2.3, 2.3]) box("head", [x, 6.2, 5.35], [2.8, 2.2, 0.4], LENS, { o: 0.82 });
        box("head", [0, 6.6, 5.4], [1.8, 0.4, 0.3], "#1F2937");
        box("head", [0, 10.6, 0], [15, 0.8, 15], "#1C1917", { lod: 0 });
        box("head", [0, 12.2, 0], [10.6, 2.6, 10.6], "#1C1917", { lod: 0 });
      },
    },
    {
      id: "gothic-classics-moon-wolf", slot: "outfit", surfaces: ["avatar", "me", "collection"], head: true,
      wear: (_a, box) => {
        // ay kurdu: kürk tulum, açık göğüs tüyü, yırtık pantolon paçası, kulaklı ve burunlu kukuleta (yüz açık), pençe eldiven
        suit(box, { body: FURC, sleeve: FURC, glove: FURC_D, leg: "#475569", boot: FURC_D });
        box("body", [0, 11, 3.0], [4.6, 5, 0.3], FURC_L);
        for (const x of [-1.6, 0, 1.6]) box("body", [x, 5.6, 3.1], [1.2, 1.6, 0.2], FURC_D, { r: [0, 0, 0.785] });
        for (const bone of ["armL", "armR"] as const) for (const x of [-0.8, 0, 0.8]) box(bone, [x, -7.5, 1.1], [0.4, 0.8, 0.5], "#F5F5F4");
        for (const bone of ["legL", "legR"] as const) box(bone, [0, -4.2, 0], [3.5, 0.8, 3.5], "#334155", { r: [0, 0, 0.2] });
        box("head", [0, 10.4, -0.4], [10.8, 1.8, 10.6], FURC, { lod: 0 });
        box("head", [0, 6, -5.4], [10.8, 9, 0.8], FURC);
        for (const x of [-5.35, 5.35]) box("head", [x, 6.8, -1.4], [0.7, 6.6, 7.8], FURC);
        for (const x of [-3.2, 3.2]) box("head", [x, 12.4, -0.6], [2, 2.6, 1.2], FURC_D, { r: [0, 0, x < 0 ? 0.25 : -0.25] });
        box("head", [0, 10.2, 5.6], [3.4, 1.6, 2], FURC_L);
        box("head", [0, 10.6, 6.7], [1.2, 0.8, 0.4], "#1F2937");
      },
    },
    {
      id: "gothic-classics-raven-poet", slot: "outfit", surfaces: ["avatar", "me", "collection"],
      wear: (_a, box) => {
        // kuzgunlu şair: mürekkep rengi uzun redingot, krem kravat, gümüş düğmeler, omuzda tüneyen kuzgun, cepte tüy kalem
        suit(box, { body: INK, sleeve: INK, glove: "#E7E5E4", leg: "#292524", boot: BLACK }, true);
        box("body", [0, 13, 3.05], [2.2, 2, 0.3], CRAVAT);
        box("body", [0, 11.6, 3.1], [1, 1.4, 0.3], CRAVAT);
        for (const y of [10.2, 8.6, 7]) box("body", [1.4, y, 3.1], [0.5, 0.5, 0.2], SILVER);
        box("body", [-2.6, 11.4, 3.15], [0.3, 3.4, 0.3], "#F5F0E6", { r: [0, 0, 0.3] });
        box("body", [6.4, 15.4, -0.4], [2, 2, 2.8], RAVEN);
        box("body", [6.4, 16.8, 0.9], [1.4, 1.4, 1.4], RAVEN);
        box("body", [6.4, 16.6, 1.9], [0.5, 0.4, 0.9], "#4B5563");
        box("body", [6.4, 15, -2.2], [1.2, 0.4, 1.6], "#1F2937", { r: [0.4, 0, 0] });
        box("body", [5.4, 14.3, 0], [2.2, 0.6, 1.2], "#5B4030");                // omuz tüneği (apolet)
      },
    },
    {
      id: "gothic-classics-candelabra", slot: "desk", surfaces: ["desk", "collection"],
      boxes: () => {
        // üç kollu şamdan: dökme taban, kollar, krem mumlar ve titremeyen alevler (dinî simge yok)
        const IRON = "#3F3A36";
        const b: SceneBox[] = [{ p: [0, 0.4, 0], s: [5, 0.8, 4], c: IRON }];
        b.push({ p: [0, 3, 0], s: [0.8, 4.4, 0.8], c: IRON });
        b.push({ p: [0, 5.4, 0], s: [8, 0.6, 0.8], c: IRON });
        for (const x of [-3.6, 0, 3.6]) {
          const h = x ? 0 : 1;
          b.push({ p: [x, 6.2 + h, 0], s: [1.4, 1 + h * 2, 1.4], c: IRON });
          b.push({ p: [x, 8.2 + h * 2, 0], s: [0.9, 2.6, 0.9], c: "#F5F0E6" });
          b.push({ p: [x, 10 + h * 2, 0], s: [0.6, 1, 0.6], c: "#FDBA74", glow: true });
        }
        return b;
      },
    },
    {
      id: "gothic-classics-tower-clock", slot: "desk", surfaces: ["desk", "collection"],
      boxes: () => {
        // gotik kule saati: sivri tepe, rakamsız kadran (yalnız çentik), sarkaç penceresi
        const WOOD = "#3B2A20", WOOD_L = "#5B4030";
        const b: SceneBox[] = [{ p: [0, 0.5, 0], s: [6, 1, 4], c: WOOD }];
        b.push({ p: [0, 5, 0], s: [4.4, 8, 3], c: WOOD_L });
        b.push({ p: [0, 4.2, 1.55], s: [2, 4, 0.2], c: "#1C1917" });
        b.push({ p: [0, 3, 1.7], s: [0.8, 0.8, 0.2], c: "#D6B25E" });
        b.push({ p: [0, 10.4, 0], s: [4, 3.2, 3], c: WOOD });
        b.push({ p: [0, 10.4, 1.55], s: [2.8, 2.8, 0.2], c: "#F5F0E6" });
        for (const [x, y] of [[0, 1.2], [0, -1.2], [1.2, 0], [-1.2, 0]] as const) b.push({ p: [x, 10.4 + y, 1.7], s: [0.3, 0.3, 0.2], c: "#1C1917" });
        b.push({ p: [0.4, 10.6, 1.75], s: [0.2, 1.2, 0.2], c: "#1C1917", r: [0, 0, -0.5] });
        b.push({ p: [0, 13.2, 0], s: [2.4, 2.4, 2], c: WOOD_L, r: [0, 0, 0.785] });
        return b;
      },
    },
    { id: "gothic-classics-moon-fog", slot: "celebration", surfaces: ["celebration", "collection"], durationMs: 2800, frame: moonFog },
  ],
};
