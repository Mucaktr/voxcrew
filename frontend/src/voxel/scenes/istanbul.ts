/**
 * BIG-IST — İstanbul şehir sahnesi, büyük taban 36 × 32 (3 × 2 bölge; CITY-BIG). `city` katmanı, `world_tour_turkey`, ücretsiz.
 * Kullanıcı kararı 2026-10-18 ( sonu): ünlü simgeler sahnenin ortasında, ilk bakışta tanınır stilize
 * voxel yorumlar; şehir tabanı normal sahneden büyük → simgelerin çevresinde yürünecek yer var.
 *
 * Batı yakası (i 0–21):
 * - Ayasofya benzeri cami (i 2–8, j 3–8, ×1,1) ile Sultanahmet benzeri cami (i 15–20, j 3–10, ×1,1) arasında havuzlu,
 * çınarlı bahçe (i 10–13); önlerinde açık meydan ve hipodrom benzeri uzun alan (j 12–18): yazısız taş dikilitaş, örme taş
 * sütun, sekizgen kubbeli çeşme köşkü, oval taş yol, banklar, simit arabası.
 * - Kapalı çarşı benzeri sokak (i 1–13, j 20–23): kuzeyde nişli dükkân duvarı, üstte taş kemer kaburgaları ve kurşun tonoz
 * şeritleri (ortası açık ışıklık), güneyde tezgâh sırası (satıcılar kemer altında). Mısır çarşısı benzeri salon (i 15–20,
 * j 20–22): kemerli cephe, baharat çuvalları, kubbecikler; önünde çay bahçesi (semaver tezgâhı, alçak tabureler ve masa;
 * `cay_bogaz` mekânı) ve meyve tezgâhı.
 * - Ön şerit: çay bahçesi (8 istasyon, çay ocağı, tavla), kafe terası (4 istasyon, web panosu), vapur iskelesi (kabuk), yanında
 * balık-ekmek (rıhtıma bağlı ızgara teknesi + tezgâh, tabure, masa; `balik_ekmek` mekânı), sahil yürüyüş yolu (j 30–31; bank
 * istasyonları, simit arabası) ve rıhtım oltacıları.
 * Boğaz (su i 23–27, j 0–29; rıhtımlar i 22 / i 28): arkada yürünür alçak taş köprü (j 0–1, kenar kapısı + olta), j 18'de
 * iki kuleli asma köprü (güverte y 2,6; vapurlar altından geçer), önde rıhtım güvertesi (j 30) ve yürüyüş yolu.
 * Boğaz'ın ortasında (i 25, j 25–26) Kız Kulesi benzeri kayalık ada (iki vapur şeridi arasında; gece yumuşak fener).
 * Doğu yakası (i 29–35): Galata benzeri kule (×0,9) kademeli taş yamaç kaidesinde (i 30–34, j 2–6); önünde basamaklı sokağa
 * (i 32) doğru yükselen taş setler üstünde ahşap konaklar (dört yüzde pencereli); kıyıda çay bahçesi (`cay_bogaz` mekânı: semaver
 * tezgâhı, tabureler, kıyıda masa; 4 istasyon, plan panosu), simit arabası; HOTEL-SYS (E1): eski açık pansiyon (15 ranza, Kız Kulesi yanında) yerine tek, küçük ahşap konak otel
 * (2 × 1 karo, 2,86 yükseklik — en alçak anıtsal simge Kız Kulesi 4,97 × 0,6; Ayasofya/Sultanahmet'in çok altında), geçit kapısı
 * (32, 24); içerisi ayrı sahne (oryantalist otel lobisi, kafes asansör). Görünür yatak yok.
 * CITY-PASS-IST (kalite seferberliği 2026-10-28): Galata gövdesi kaidesine oturur; taban kuşağı, mazgal pencereler, konsollu seyir
 * balkonu ve korkuluk, kapıya yanaklı taş merdiven (içeride asansör + dönen merdiven: iç mekân `galata`).
 *
 * Mantık: camiler `sacredZone` (tampon 1) içinde, tamponları tabanın içinde; istasyon, uyku, dinlenme,
 * araç ve kahve noktası yok; ayak izine 3 karo içinde tavla/olta yok; bölgede ortam kancası yok; dinî ses yok. Ajanlar meydanda
 * ve bahçede yürür. Gece: camilere ve kuleye yalnız durağan, yumuşak sıcak yıkama, yanan pencereler.
 * Kenar sözleşmesi (36 × 32): arka/ön kenarda i 5–7 / 17–19 / 29–31 yürünür (j 0 sokak + köprü güvertesi, j 31 yürüyüş yolu);
 * sol/sağ kenarda j 0/2/7/12/16/18/23/28 yürünür (i 0 ve i 35 sütunları boş); açık su kenara değmez; vapurlar ızgara içinde.
 * IP/kültür: logo, bayrak, yazı (dikilitaşta da), gerçek kişi ve dinî ses yok. Kayıt notu: scenes.ts ile döngüsel içe aktarılır.
*/
import { addMover, cafeSet, cafeStations, cityBench, cityTree, marketStall, marketStation, paintCity, quay,
  sacredZone, streetLamp, waterBody } from "../city/kit";
import { fillSpotReach } from "../city/kit";
import { placeHotel } from "../districts/hotel";
import { flowerBed } from "../districts/parts";
import { ISTANBUL_LANDMARKS as L, ISTANBUL_STYLE as S } from "../city/styles/istanbul";
import { noteObject } from "../rules/hooks";
import { Builder, key, PLAY_BOARD, tx, tz, type Built, type Group, type SceneDef } from "../scenes";
import { stool } from "../city/furniture";
import { placeVenue, venueSolidTiles } from "../city/venues";

/** Taban boyutu (karo): 3 × 2 bölge. */
const GW = 36, GD = 32;
const UP = 0, DOWN = Math.PI, LEFT = -Math.PI / 2;
const WOOD = "#7A4E2A", TEA = "#B5462E", COPPER = "#C47A3A", STONE = "#BFB4A0";

// ------------------------------------------------------------------ ölçekli çizim (simgeler ×k, merkez (X, Z), taban Y)
interface Sink { box(x: number, y: number, z: number, w: number, h: number, d: number, c: string, g?: Group, j?: number): void }
function scaled(b: Builder, X: number, Z: number, k: number, Y = 0): Sink {
  return { box: (x, y, z, w, h, d, c, g = "solid", j = 0) => b.box(X + (x - X) * k, Y + y * k, Z + (z - Z) * k, w * k, h * k, d * k, c, g, j) };
}

// ------------------------------------------------------------------ kubbe/minare ilkelleri (yalnız solid grup)
/** Sekizgen prizma (üç kutu): yuvarlak gövde, kubbe kademesi, minare gövdesi. y merkez. */
function oct(b: Sink, x: number, y: number, z: number, w: number, h: number, c: string, j = 0.03) {
  b.box(x, y, z, w, h, w * 0.42, c, "solid", j);
  b.box(x, y, z, w * 0.42, h, w, c, "solid", j);
  b.box(x, y, z, w * 0.8, h, w * 0.8, c, "solid", j);
}
/** Kubbe: y taban, r yarıçap, h yükseklik (h < r basık); sekizgen kademeler + isteğe bağlı alem. */
function cupola(b: Sink, x: number, y: number, z: number, r: number, h: number, c: string, steps = 4, finial = true) {
  const hh = h / steps;
  for (let k = 0; k < steps; k++) {
    const t = (k + 0.35) / steps;
    oct(b, x, y + k * hh + hh / 2, z, 2 * r * Math.sqrt(1 - t * t), hh + 0.02, c);
  }
  if (finial) b.box(x, y + h + 0.15, z, 0.07, 0.3, 0.07, L.finial);
}
/** Küçük revak kubbeciği (2 kutu). */
function domelet(b: Sink, x: number, y: number, z: number, r: number, c: string) {
  b.box(x, y + 0.08, z, 2 * r, 0.16, 2 * r, c, "solid", 0.02);
  b.box(x, y + 0.22, z, 1.2 * r, 0.14, 1.2 * r, c, "solid", 0.02);
}
/** Yarım kubbe: (x, z) düz kenarın ortası, (dx, dz) açıldığı yön; kademeli. */
function halfDome(b: Sink, x: number, y: number, z: number, r: number, h: number, dx: number, dz: number, c: string, steps = 3) {
  const hh = h / steps;
  for (let k = 0; k < steps; k++) {
    const t = (k + 0.35) / steps, w = 2 * r * Math.sqrt(1 - t * t), yc = y + k * hh + hh / 2;
    for (const [len, across] of [[w / 2 * 0.82, w], [w / 2, w * 0.6]]) {
      const cx = x + dx * len / 2, cz = z + dz * len / 2;
      if (dx) b.box(cx, yc, cz, len, hh + 0.02, across, c, "solid", 0.03);
      else b.box(cx, yc, cz, across, hh + 0.02, len, c, "solid", 0.03);
    }
  }
}
/** İnce kalem minare: kaide, gövde, `n` şerefe, kurşun külah, alem. Yalnız dış silüet. */
function minaret(b: Sink, x: number, z: number, h: number, n: number, c: string, cap: string, shaft = 0.36) {
  oct(b, x, 0.5, z, 0.7, 1.0, c);
  oct(b, x, h / 2, z, shaft, h, c);
  const ys = n === 1 ? [0.8] : n === 2 ? [0.64, 0.86] : [0.52, 0.7, 0.88];
  for (const f of ys) {
    const y = h * f;
    b.box(x, y - 0.1, z, shaft * 1.3, 0.14, shaft * 1.3, c);
    oct(b, x, y, z, shaft * 1.8, 0.08, c, 0.02);
    b.box(x, y + 0.1, z, shaft * 1.7, 0.1, shaft * 1.7, "#8E98A1");
  }
  for (let k = 0; k < 4; k++) { const w = shaft * 1.05 * (1 - k / 4) + 0.05; b.box(x, h + 0.15 + k * 0.3, z, w, 0.3, w, cap, "solid", 0.02); }
  // CITY-PASS-IST (REAL-SUPPORT): alem külahın tepesine oturur (eski: 0,05 boşluk)
  b.box(x, h + 1.35, z, 0.05, 0.3, 0.05, L.finial);
}
/** Gece yumuşak projektör yıkaması (durağan, eklemeli düz dikdörtgen; yalnız gece görünür). */
const flood = (b: Builder, x: number, y: number, z: number, w: number, h: number, c: string = L.flood) =>
  b.props.push({ k: "window", p: [x, y, z], r: 0, s: [w, h], c });
/** Gece zeminde sıcak ışık havuzu (projektör tabanı; durağan `lamp` işareti, armatür yok). */
const uplight = (b: Builder, x: number, z: number) => b.props.push({ k: "lamp", p: [x, 0.6, z], r: 0, s: [1.6, 0], c: "#FFD9A0" });
const landmark = (b: Builder, i0: number, j0: number, w: number, d: number, tag: string) =>
  b.zones.push({ kind: "landmark", i0, j0, w, d, tag });
const footprint = (b: Builder, i0: number, j0: number, w: number, d: number) => {
  for (let i = i0; i < i0 + w; i++) for (let j = j0; j < j0 + d; j++) b.block(i, j);
};
const midX = (i0: number, w: number) => (tx(i0) + tx(i0 + w - 1)) / 2;
const midZ = (j0: number, d: number) => (tz(j0) + tz(j0 + d - 1)) / 2;

// ------------------------------------------------------------------ simgeler
/** Ayasofya benzeri (7 × 6 karo, ×k): uzun kenar kameraya; ana kubbe ≈ 6, minareler ≈ 8,4. */
function ayasofya(b: Builder, i0: number, j0: number, k: number) {
  const w = 7, d = 6, X = midX(i0, w), Z = midZ(j0, d), s = scaled(b, X, Z, k);
  const at = (x: number, z: number) => [X + (x - X) * k, Z + (z - Z) * k] as const;
  noteObject(b, "tower", [i0, j0], { w, d, floors: 1, y: 5.5 * k, enclosed: true });
  // ana kütle + kurşun yan nef çatısı + batı narteksi (alçak)
  s.box(X, 1.2, Z, 4.9, 2.4, 3.9, L.hsWall, "solid", 0.03);
  s.box(X, 2.48, Z, 5.0, 0.16, 4.0, L.hsLead2, "solid", 0.02);
  s.box(X - 2.15, 0.85, Z, 0.7, 1.7, 3.2, L.hsWall2, "solid", 0.03);
  // kubbeyi taşıyan kare kütle + köşe ağırlık kuleleri
  s.box(X, 3.05, Z, 3.1, 1.15, 3.1, L.hsWall, "solid", 0.03);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    s.box(X + sx * 1.5, 3.25, Z + sz * 1.5, 0.55, 1.6, 0.55, L.hsWall2, "solid", 0.03);
    s.box(X + sx * 1.5, 4.1, Z + sz * 1.5, 0.62, 0.12, 0.62, L.hsLead);
  }
  // ön/arka yüzde kademeli payandalar
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
    s.box(X + sx * 1.0, 1.6, Z + sz * 2.05, 0.6, 3.2, 0.5, L.hsWall2, "solid", 0.03);
    s.box(X + sx * 1.0, 3.3, Z + sz * 1.8, 0.45, 0.3, 0.8, L.hsWall2, "solid", 0.03);
  }
  // kasnak pencere halkası + büyük basık ana kubbe
  // LANDMARK-FIDELITY: 40 pencereli kasnağı andıran koyu pencere halkası + 20 taş payanda
  for (const [w, d] of [[2.8, 1.16], [1.16, 2.8], [2.0, 2.0]]) s.box(X, 3.76, Z, w, 0.26, d, L.opening);
  for (let q = 0; q < 20; q++) { const a = ((q + 0.5) / 20) * Math.PI * 2; s.box(X + Math.cos(a) * 1.44, 3.76, Z + Math.sin(a) * 1.44, 0.2, 0.28, 0.2, L.hsWall); }
  cupola(s, X, 3.88, Z, 1.62, 1.3, L.hsLead, 5);
  // doğu-batı yarım kubbeleri + köşe eksedraları (çağlayan)
  for (const sx of [-1, 1]) {
    halfDome(s, X + sx * 1.55, 2.55, Z, 1.45, 1.05, sx, 0, L.hsLead, 3);
    for (const sz of [-1, 1]) halfDome(s, X + sx * 2.05, 2.55, Z + sz * 0.95, 0.6, 0.5, sx, 0, L.hsLead2, 2);
  }
  // ön cephe: iki sıra pencere, kapı, kasnak altı kemerleri
  const fz = Z + 1.96;
  for (const y of [0.9, 1.75]) for (let q = -4; q <= 4; q++) if (Math.abs(q) !== 2) s.box(X + q * 0.5, y, fz, 0.2, 0.42, 0.04, L.opening);
  s.box(X, 0.6, fz + 0.01, 0.6, 1.1, 0.04, L.opening);
  for (let q = -2; q <= 2; q++) s.box(X + q * 0.5, 3.0, Z + 1.56, 0.22, 0.4, 0.04, L.opening);
  // dört FARKLI minare (kaynak: batı çifti özdeş, kalın beyaz taş, en yüksek, iki şerefe; kuzeydoğu ince beyaz taş, tek şerefe;
  // güneydoğu kırmızı tuğla, tek şerefe). Sahnede +z ön (güney) kabul edilir.
  for (const sz of [-1, 1]) minaret(s, X - 2.75, Z + sz * 2.25, 6.2, 2, L.hsMinaret, L.hsLead, 0.42);
  minaret(s, X + 2.75, Z - 2.25, 6.0, 1, L.hsMinaret, L.hsLead, 0.32);
  minaret(s, X + 2.75, Z + 2.25, 5.7, 1, "#A9573F", L.hsLead, 0.4);
  // gece: cephe ve kubbe yıkaması + kasnak pencereleri
  const [, fzk] = at(X, fz + 0.06);
  flood(b, X, 1.3 * k, fzk, 4.6 * k, 2.2 * k);
  for (const dx of [-1.8, 0, 1.8]) { const [ux, uz] = at(X + dx, Z + 2.6); uplight(b, ux, uz); }
  b.props.push({ k: "window", p: [X, 3.76 * k, at(X, Z + 1.58)[1]], r: 0, s: [2.6 * k, 0.2 * k], c: S.windowLit });
  // LANDMARK-FIDELITY: kasnak pencereleri dört yönde gece içten ışık (durağan)
  for (const [dx, dz, r] of [[0, -1, Math.PI], [1, 0, Math.PI / 2], [-1, 0, -Math.PI / 2]] as const)
    b.props.push({ k: "window", p: [X + dx * 1.58 * k, 3.76 * k, Z + dz * 1.58 * k], r, s: [2.6 * k, 0.2 * k], c: S.windowLit });
  footprint(b, i0, j0, w, d);
  sacredZone(b, i0, j0, w, d, 1);
  landmark(b, i0, j0, w, d, "ayasofya");
}

/** Sultanahmet benzeri (6 × 8 karo, ×k: ibadet bölümü arkada + revaklı avlu önde); 6 minare ≈ 9,2. */
function sultanahmet(b: Builder, i0: number, j0: number, k: number) {
  const w = 6, d = 8, X = midX(i0, w), Z = midZ(j0, d), s = scaled(b, X, Z, k);
  const Zh = Z - 1.5, Zc = Z + 2;
  const zk = (z: number) => Z + (z - Z) * k;
  noteObject(b, "tower", [i0, j0], { w, d, floors: 1, y: 4.8 * k, enclosed: true });
  // ibadet bölümü + pandantif katı
  s.box(X, 1.0, Zh, 3.9, 2.0, 3.5, L.bmStone, "solid", 0.03);
  s.box(X, 2.07, Zh, 3.95, 0.14, 3.55, L.bmStone2);
  s.box(X, 2.35, Zh, 3.0, 0.5, 3.0, L.bmStone2, "solid", 0.03);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cupola(s, X + sx * 1.45, 2.14, Zh + sz * 1.25, 0.45, 0.42, L.bmDome, 3, false);
  // dört yarım kubbe (çağlayan) + ağırlık kuleleri
  halfDome(s, X + 1.0, 2.6, Zh, 1.0, 0.85, 1, 0, L.bmDome);
  halfDome(s, X - 1.0, 2.6, Zh, 1.0, 0.85, -1, 0, L.bmDome);
  halfDome(s, X, 2.6, Zh + 1.0, 1.0, 0.85, 0, 1, L.bmDome);
  halfDome(s, X, 2.6, Zh - 1.0, 1.0, 0.85, 0, -1, L.bmDome);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = X + sx * 1.05, z = Zh + sz * 1.05;
    oct(s, x, 3.05, z, 0.38, 0.9, L.bmStone);
    s.box(x, 3.62, z, 0.3, 0.25, 0.3, L.bmDome); s.box(x, 3.85, z, 0.14, 0.25, 0.14, L.bmDome);
  }
  // kasnak + pencere halkası + ana kubbe
  oct(s, X, 3.05, Zh, 2.25, 0.5, L.bmStone);
  oct(s, X, 3.1, Zh, 2.32, 0.18, L.opening);
  cupola(s, X, 3.3, Zh, 1.2, 1.1, L.bmDome, 5);
  for (let q = -3; q <= 3; q++) s.box(X + q * 0.5, 1.4, Zh + 1.76, 0.2, 0.5, 0.04, L.opening);
  // revaklı avlu: taş zemin, yan ve ön duvarlar, kubbecikler, kemerler, taç kapı, şadırvan
  s.box(X, 0.02, Zc, 4.2, 0.04, 2.9, "#DAD4C9");
  for (const sx of [-1, 1]) s.box(X + sx * 1.95, 0.55, Zc, 0.4, 1.1, 2.9, L.bmStone, "solid", 0.03);
  s.box(X, 0.55, Zc + 1.3, 4.3, 1.1, 0.4, L.bmStone, "solid", 0.03);
  for (let q = -3; q <= 3; q++) {
    domelet(s, X + q * 0.6, 1.1, Zc + 1.3, 0.22, L.bmDome);
    if (q) s.box(X + q * 0.6, 0.5, Zc + 1.51, 0.28, 0.55, 0.04, L.opening);
  }
  for (const sx of [-1, 1]) for (const q of [-1, 0, 1]) domelet(s, X + sx * 1.95, 1.1, Zc + q * 0.85, 0.22, L.bmDome);
  s.box(X, 0.85, Zc + 1.35, 0.9, 1.7, 0.5, L.bmStone2, "solid", 0.03);
  s.box(X, 0.7, Zc + 1.61, 0.45, 1.0, 0.04, L.opening);
  domelet(s, X, 1.7, Zc + 1.35, 0.3, L.bmDome);
  oct(s, X, 0.3, Zc, 0.7, 0.6, L.bmStone2);
  cupola(s, X, 0.6, Zc, 0.4, 0.35, L.bmDome, 2, false);
  // altı minare: ibadet bölümü köşelerinde 4 (üç şerefe), avlu ön köşelerinde 2 (iki şerefe)
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) minaret(s, X + sx * 2.2, Zh + sz * 1.75, 7.0, 3, L.bmMinaret, L.bmDome, 0.32);
    minaret(s, X + sx * 2.2, Zc + 1.25, 6.0, 2, L.bmMinaret, L.bmDome, 0.32);
  }
  // gece: avlu duvarı ve ibadet bölümü yıkaması + kasnak pencereleri
  flood(b, X, 0.8 * k, zk(Zc + 1.53), 4.0 * k, 1.1 * k);
  flood(b, X, 1.35 * k, zk(Zh + 1.8), 3.6 * k, 1.2 * k);
  for (const dx of [-1.4, 1.4]) uplight(b, X + dx * k, zk(Zc + 1.9));
  b.props.push({ k: "window", p: [X, 3.1 * k, zk(Zh + 1.18)], r: 0, s: [2.0 * k, 0.15 * k], c: S.windowLit });
  for (const [dx, dz, r] of [[0, -1, Math.PI], [1, 0, Math.PI / 2], [-1, 0, -Math.PI / 2]] as const)
    b.props.push({ k: "window", p: [X + dx * 1.18 * k, 3.1 * k, zk(Zh + dz * 1.18)], r, s: [2.0 * k, 0.15 * k], c: S.windowLit });
  footprint(b, i0, j0, w, d);
  sacredZone(b, i0, j0, w, d, 1);
  landmark(b, i0, j0, w, d, "sultanahmet");
}

/** Galata benzeri yuvarlak taş kule, kademeli yamaç kaidesinin (5 × 5 karo) ortasında: gövde, kuşaklar, şerefe + kemerli seyir
 *  katı, konik kurşun külah (×k). Tepe ≈ 0,85 + 9,6k. */
function galata(b: Builder, i0: number, j0: number, k: number) {
  const X = tx(i0 + 2), Z = tz(j0 + 2), Y = 0.85;
  // yamaç kaidesi: üç taş set, yeşil şeritler, köşelerde selviler
  b.box(X, 0.15, Z, 5.0, 0.3, 5.0, L.hillStone, "solid", 0.05);
  b.box(X, 0.45, Z - 0.2, 4.2, 0.3, 4.4, L.hillStone, "solid", 0.05);
  b.box(X, 0.72, Z - 0.3, 3.4, 0.26, 3.6, "#A89A84", "solid", 0.04);
  for (const sx of [-1, 1]) b.box(X + sx * 2.3, 0.34, Z, 0.4, 0.08, 4.6, L.hillGreen, "solid", 0.1);
  b.box(X, 0.34, Z + 2.3, 4.6, 0.08, 0.4, L.hillGreen, "solid", 0.1);
  for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 1.6], [2, 1.6]]) {
    b.box(X + dx, 0.6, Z + dz, 0.12, 0.6, 0.12, "#5D3A1A");
    [[0.6, 1.0], [0.48, 1.6], [0.32, 2.1]].forEach(([wd, y]) => b.box(X + dx, y, Z + dz, wd, 0.7, wd, "#2E5E3A", "solid", 0.1));
  }
  // CITY-PASS-IST: kapıya çıkan taş merdiven — basamaklar zeminden yükselir (havada değil), iki yanda yanak duvarı ve tırabzan
  for (let q = 0; q < 4; q++) { const top = 0.16 + q * 0.2; b.box(X, top / 2, Z + 2.4 - q * 0.3, 1.0, top, 0.3, "#C9BFAC", "solid", 0.03); }
  for (const sx of [-1, 1]) {
    b.box(X + sx * 0.58, 0.45, Z + 1.95, 0.16, 0.9, 1.2, L.hillStone, "solid", 0.04);
    for (const dz of [2.45, 1.45]) b.box(X + sx * 0.58, 1.05 - (dz - 1.45) * 0.4, Z + dz, 0.05, 0.3, 0.05, "#3A3F47");
    b.box(X + sx * 0.58, 1.0, Z + 1.95, 0.05, 0.05, 1.1, "#3A3F47");
  }
  const s = scaled(b, X, Z, k, Y);
  noteObject(b, "tower", [i0 + 1, j0 + 1], { w: 3, d: 3, floors: 3, y: Y + 9.6 * k, enclosed: true });
  // CITY-PASS-IST (REAL-SUPPORT P0): gövde kaidenin üstüne oturur (eski gövde y 0,5'ten başlıyordu → 0,45 havada). Gerçek Galata:
  // çap 16,45 m, gövde ≈ 51 m'de konsollu seyir balkonu, üstte kemerli pencereli kat, konik kurşun külah (tepe ≈ 67 m; oran ≈ 1 : 4).
  oct(s, X, 3.1, Z, 2.3, 6.2, L.galata);
  oct(s, X, 0.3, Z, 2.42, 0.6, L.galata2); // kalın taş taban kuşağı
  for (const y of [2.3, 4.3]) oct(s, X, y, Z, 2.38, 0.1, L.galata2);
  const fz = Z + 1.16;
  // zemin kapısı (güney): taş çerçeve + kemerli açıklık; içeride asansör çekirdeği ve duvar boyu dönen merdiven (iç mekân `galata`)
  s.box(X, 0.6, fz + 0.06, 0.64, 1.2, 0.08, L.galata2, "solid", 0.02);
  s.box(X, 0.47, fz + 0.11, 0.42, 0.94, 0.04, L.opening);
  s.box(X, 0.98, fz + 0.11, 0.26, 0.1, 0.04, L.opening);
  // dar mazgal pencereler: dört yüzde düşey sıralar (kuşaklar arasında)
  for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) [1.75, 2.95, 3.75, 5.1].forEach((y, q) => {
    if (dz === 1 && q === 0) return; // kapının üstü boş
    const o = q % 2 ? 0.22 : -0.22;
    s.box(X + dx * 1.16 + (dz ? o : 0), y, Z + dz * 1.16 + (dx ? o : 0), dz ? 0.13 : 0.04, 0.36, dz ? 0.04 : 0.13, L.opening);
  });
  // balkonu taşıyan konsollar (8) + konsol kuşağı
  for (let q = 0; q < 8; q++) { const a = (q / 8) * Math.PI * 2; s.box(X + Math.cos(a) * 1.2, 6.09, Z + Math.sin(a) * 1.2, 0.16, 0.22, 0.16, L.galata2); }
  oct(s, X, 6.3, Z, 2.55, 0.2, L.galata2);
  oct(s, X, 6.45, Z, 2.75, 0.08, "#3A3F47");
  oct(s, X, 6.85, Z, 2.1, 0.8, L.galataTop);
  // seyir balkonu korkuluğu: 12 dikme + üst küpeşte (halka)
  for (let q = 0; q < 12; q++) { const a = ((q + 0.5) / 12) * Math.PI * 2; s.box(X + Math.cos(a) * 1.3, 6.62, Z + Math.sin(a) * 1.3, 0.04, 0.26, 0.04, "#3A3F47"); }
  oct(s, X, 6.75, Z, 2.7, 0.05, "#3A3F47", 0);
  for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) for (const o of [-0.28, 0, 0.28]) {
    const px = X + dx * 1.06 + (dz ? o : 0), pz = Z + dz * 1.06 + (dx ? o : 0);
    s.box(px, 6.88, pz, dz ? 0.16 : 0.04, 0.46, dz ? 0.04 : 0.16, L.opening);
  }
  [2.3, 1.9, 1.5, 1.1, 0.72, 0.38].forEach((w, q) => oct(s, X, 7.25 + q * 0.34 + 0.17, Z, w, 0.36, L.galataCap, 0.02));
  s.box(X, 9.45, Z, 0.07, 0.3, 0.07, L.finial);
  // LANDMARK-FIDELITY (istanbul.md §4): külahta dört ana yönde çatı penceresi; tepede gece kırmızı ikaz ışığı (durağan)
  for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    s.box(X + dx * 0.97, 7.74, Z + dz * 0.97, 0.26, 0.28, 0.26, L.galataCap, "solid", 0.02);
    s.box(X + dx * 1.11, 7.72, Z + dz * 1.11, dz ? 0.14 : 0.03, 0.16, dz ? 0.03 : 0.14, "#E9D9A8");
  }
  s.box(X, 9.64, Z, 0.09, 0.09, 0.09, "#D7263D", "glow");
  // gece: gövde yıkaması + seyir katı pencereleri
  flood(b, X, Y + 3.2 * k, Z + 1.2 * k, 1.8 * k, 5.0 * k);
  b.props.push({ k: "window", p: [X, Y + 6.88 * k, Z + 1.1 * k], r: 0, s: [0.8 * k, 0.4 * k], c: S.windowLit });
  for (const [dx, dz, r] of [[0, -1, Math.PI], [1, 0, Math.PI / 2], [-1, 0, -Math.PI / 2]] as const)
    b.props.push({ k: "window", p: [X + dx * 1.1 * k, Y + 6.88 * k, Z + dz * 1.1 * k], r, s: [0.8 * k, 0.4 * k], c: S.windowLit });
  uplight(b, X, Z + 2.7);
  footprint(b, i0, j0, 5, 5);
  landmark(b, i0 + 1, j0 + 1, 3, 3, "galata");
  b.hook("perch", i0 + 2, j0 + 5); // kaide basamaklarının önü: güneşlenen kediler
}

/** Boğaz asma köprüsü (j satırı boyunca x'te): iki portal kule (rıhtımlarda), güverte (vapurlar altından geçer), sarkık ana
 * kablolar, askılar, ankraj blokları. Yürünmez (görsel); su karoları su kalır. açıklık rıhtımlara bağlı (yatay sabit);
 * kule, güverte ve kablolar düşeyde orantılı ×`BRIDGE_KY` (eski tepe 7,2 → 10,6; güverte 2,6 → 3,8, oran korunur).*/
const BRIDGE_KY = 10.6 / 7.2;
function bosphorusBridge(b: Builder, j: number, iw: number, ie: number, reach = 1) {
  // (`reach`): ankraj kuleden `reach` karo dışarıda — kuleler suda, ankraj karada; aradaki rıhtım güvertenin altında açık kalır
  const z = tz(j), xw = tx(iw), xe = tx(ie), xa = tx(iw - reach), xb = tx(ie + reach), deckY = 2.6 * BRIDGE_KY, top = 7.2 * BRIDGE_KY;
  b.box((xa + xb) / 2, deckY, z, xb - xa + 1, 0.22, 1.0, L.bridgeDeck, "solid", 0.02);
  for (const s of [-1, 1]) b.box((xa + xb) / 2, deckY + 0.18, z + s * 0.46, xb - xa + 1, 0.12, 0.05, L.bridge);
  for (const [i, x] of [[iw, xw], [ie, xe]] as [number, number][]) {
    // kule suda — ayak ve kirişler kendi karosunda (z ± 0,48; eskiden ± 0,58 komşu su karolarını örtüp su yüzünü siliyordu)
    for (const s of [-1, 1]) b.box(x, top / 2, z + s * 0.36, 0.26, top, 0.24, L.bridge, "solid", 0.02);
    for (const y of [deckY - 0.24, 5.0 * BRIDGE_KY, top - 0.1]) b.box(x, y, z, 0.26, 0.24, 0.96, L.bridge);
    b.block(i, j);
  }
  for (const [i, x] of [[iw - reach, xa], [ie + reach, xb]] as [number, number][]) {
    b.box(x, 0.45, z, 0.8, 0.9, 0.8, "#A9AFB6", "solid", 0.03);
    b.box(x, deckY / 2, z, 0.3, deckY, 0.5, L.bridge);
    b.block(i, j);
  }
  // kademeli kablo: (x0,y0) → (x1,y1), sarkma (eksene hizalı kutularla)
  const cable = (x0: number, y0: number, x1: number, y1: number, sag: number, n: number, zz: number) => {
    const at = (u: number) => [x0 + (x1 - x0) * u, y0 + (y1 - y0) * u - sag * 4 * u * (1 - u)];
    for (let q = 0; q < n; q++) {
      const [ax, ay] = at(q / n), [bx, by] = at((q + 1) / n);
      b.box((ax + bx) / 2, (ay + by) / 2, zz, Math.abs(bx - ax) + 0.02, Math.abs(by - ay) + 0.045, 0.045, L.cable);
    }
  };
  for (const s of [-1, 1]) {
    const zz = z + s * 0.46, low = deckY + 0.35;
    cable(xw, top, xe, top, top - low, 30, zz);
    cable(xa, 0.9, xw, top, 0.3, 4, zz);
    cable(xe, top, xb, 0.9, 0.3, 4, zz);
    for (let q = 1; q < 10; q++) {
      const u = q / 10, x = xw + (xe - xw) * u, yc = top - (top - low) * 4 * u * (1 - u);
      b.box(x, (deckY + yc) / 2, zz, 0.03, yc - deckY, 0.03, L.cable);
    }
  }
  // LANDMARK-FIDELITY: gece güverte boyunca durağan sıcak yol lambaları (ışık gösterisi yok)
  for (const s of [-1, 1]) for (let q = 1; q < 10; q++)
    b.props.push({ k: "window", p: [xw + (xe - xw) * (q / 10), deckY + 0.36, z + s * 0.5], r: s > 0 ? 0 : Math.PI, s: [0.14, 0.14], c: S.windowLit });
  landmark(b, iw - reach, j, ie - iw + 1 + 2 * reach, 1, "bosphorus_bridge");
  b.hook("perch", ie + reach, j); // ankraj bloğu: martılar
}

/** Kız Kulesi benzeri (kamu malı tarihî yapı; yalnız dış silüet; bayrak, yazı, işletme markası yok): Boğaz'ın ortasında
 * (i, j0..j0+1) kayalık ada + taş rıhtım; önde (+z) kurşun çatılı alçak ek yapı, arkada kare taş kule: kuşaklar, pencereler,
 * koyu galeri, camlı fener odası (yumuşak, durağan `glow`), kurşun külah ve alem. Tepe ≈ 5. Ada eni ≤ 0,96 (x ± 0,48): iki vapur
 * şeridinin (i 24 / i 26, iç kenarlar x ± 0,61) arasında kalır. Karolar su gövdesinde zaten engelli; yürünmez, yalnız görünür.*/
function maidenTower(b: Builder, i: number, j0: number) {
  const X = tx(i), Zc = (tz(j0) + tz(j0 + 1)) / 2, Zt = tz(j0) + 0.12, Za = tz(j0 + 1) - 0.02;
  // kayalık ada (su yüzü y −0,2): kaba kaya kütlesi + kenar kayaları, üstte taş rıhtım
  b.box(X, -0.3, Zc, 0.96, 0.5, 1.9, L.kzRock, "solid", 0.08);
  for (const [dx, dz, w, h, d] of [[-0.3, -0.84, 0.36, 0.34, 0.32], [0.32, -0.62, 0.3, 0.28, 0.36], [0.3, 0.82, 0.34, 0.3, 0.32],
    [-0.28, 0.9, 0.3, 0.24, 0.26]] as [number, number, number, number, number][])
    b.box(X + dx, -0.14 + h / 2, Zc + dz, w, h, d, L.kzRock2, "solid", 0.1);
  b.box(X, 0.0, Zc, 0.84, 0.2, 1.62, L.kzQuay, "solid", 0.03);
  // ek yapı (önde): badanalı gövde, kurşun kırma çatı, pencereler
  b.box(X, 0.45, Za, 0.78, 0.7, 0.66, L.kzWall, "solid", 0.03);
  b.box(X, 0.84, Za, 0.84, 0.08, 0.72, L.kzLead, "solid", 0.02);
  b.box(X, 0.94, Za, 0.5, 0.12, 0.42, L.kzLead, "solid", 0.02);
  for (const dx of [-0.24, 0, 0.24]) b.box(X + dx, 0.48, Za + 0.34, 0.1, 0.22, 0.03, L.opening);
  // kare kule (arkada): gövde, iki kuşak, pencereler. kule grubu kayalık rıhtımın üstünden (y 0,1) orantılı ×`KZ_K`
  // (tepe 4,0 → 5,0; sahne hedefi 23 m → 5,6 ±%25); en geniş parça (galeri 0,8 → 1,0) ada eninde (x ± 0,5) kalır.
  const KZ_K = 1.25, t = { box: (x: number, y: number, z: number, w: number, h: number, d: number, c: string, g?: Group, j?: number) =>
    b.box(X + (x - X) * KZ_K, 0.1 + (y - 0.1) * KZ_K, Zt + (z - Zt) * KZ_K, w * KZ_K, h * KZ_K, d * KZ_K, c, g, j) };
  t.box(X, 1.3, Zt, 0.6, 2.4, 0.6, L.kzWall, "solid", 0.03);
  for (const y of [1.05, 1.95]) t.box(X, y, Zt, 0.64, 0.05, 0.64, L.kzBand);
  for (const y of [1.45, 2.2]) t.box(X, y, Zt + 0.31, 0.12, 0.26, 0.03, L.opening);
  for (const s of [-1, 1]) t.box(X + s * 0.31, 1.7, Zt, 0.03, 0.26, 0.12, L.opening);
  // galeri + camlı fener odası (gece yumuşak ışık) + kurşun külah + alem
  t.box(X, 2.55, Zt, 0.8, 0.08, 0.8, "#3A3F47");
  t.box(X, 2.66, Zt, 0.76, 0.12, 0.76, "#3A3F47", "solid", 0);
  t.box(X, 2.92, Zt, 0.44, 0.48, 0.44, L.kzGlass, "glass");
  t.box(X, 2.92, Zt, 0.2, 0.22, 0.2, L.kzLamp, "glow");
  t.box(X, 3.19, Zt, 0.56, 0.06, 0.56, L.kzLead);
  [0.46, 0.32, 0.18].forEach((w, q) => t.box(X, 3.31 + q * 0.17, Zt, w, 0.18, w, L.kzLead, "solid", 0.02));
  t.box(X, 3.87, Zt, 0.04, 0.26, 0.04, L.finial);
  // gece: kule ön yüzü yumuşak yıkama (durağan)
  flood(b, X, 0.1 + 1.3 * KZ_K, Zt + 0.33 * KZ_K, 0.5 * KZ_K, 2.0 * KZ_K);
  landmark(b, i, j0, 1, 2, "maiden_tower");
}

/** Alçak taş köprü (x boyunca, `j` satırı i0..i1; yürünür güverte, üst ≈ 0,02): korkuluk, ayaklar. Kenar kapısı.
 *  CITY-PASS-IST (REAL-PATH): güneyde ikinci güverte satırı (`j + 1`, i0..i2; eski tek karo: 5 karoluk tek geçiş). Doğu ucu
 *  (i2 < i ≤ i1) tek sıra kalır: rıhtım köşesindeki olta yerleri suya bakmaya devam eder. Vapurlar köprünün güneyinde döner. */
function lowBridge(b: Builder, i0: number, i1: number, j: number, i2 = i0 - 1) {
  const deck = (a: number, e: number, jj: number) => {
    for (let i = a; i <= e; i++) { b.blocked.delete(key(i, jj)); b.box(tx(i), -0.5, tz(jj), 0.4, 0.8, 0.9, STONE, "solid", 0.04); }
    b.box((tx(a) + tx(e)) / 2, -0.05, tz(jj), e - a + 1.2, 0.14, 1.0, "#C9BFAC", "solid", 0.03);
  };
  const rail = (x: number, z: number, w: number, d: number) => b.box(x, 0.3, z, w, 0.5, d, "#8E98A1");
  deck(i0, i1, j);
  rail((tx(i0) + tx(i1)) / 2, tz(j) - 0.46, i1 - i0 + 1.2, 0.08);
  if (i2 < i0) { rail((tx(i0) + tx(i1)) / 2, tz(j) + 0.46, i1 - i0 + 1.2, 0.08); return; }
  deck(i0, i2, j + 1);
  rail((tx(i0) + tx(i2)) / 2, tz(j + 1) + 0.46, i2 - i0 + 1.2, 0.08);
  rail((tx(i2 + 1) + tx(i1)) / 2 + 0.1, tz(j) + 0.46, i1 - i2, 0.08);
  rail(tx(i2) + 0.56, tz(j + 1), 0.08, 1.0);
}

/** Dikilitaş benzeri (yazısız, genel taş): kaide + incelen gövde + piramit uç. Karoyu engeller. */
function obelisk(b: Builder, i: number, j: number) {
  const x = tx(i), z = tz(j);
  b.box(x, 0.3, z, 0.95, 0.6, 0.95, "#B9AE9C", "solid", 0.03);
  b.box(x, 0.75, z, 0.75, 0.3, 0.75, "#A99C88", "solid", 0.03);
  for (let q = 0; q < 6; q++) { const w = 0.48 - q * 0.04; b.box(x, 1.2 + q * 0.5, z, w, 0.52, w, L.obelisk, "solid", 0.02); }
  // CITY-PASS-IST (REAL-SUPPORT): piramit uç gövdenin tepesine (3,96) oturur (eski: 0,115 boşluk)
  b.box(x, 4.085, z, 0.22, 0.25, 0.22, L.obelisk); b.box(x, 4.27, z, 0.1, 0.12, 0.1, L.obelisk);
  b.block(i, j);
}
/** Örme taş sütun (hipodrom benzeri, kaba taş, yazısız). */
function stoneColumn(b: Builder, i: number, j: number) {
  const x = tx(i), z = tz(j);
  b.box(x, 0.25, z, 0.9, 0.5, 0.9, "#B9AE9C", "solid", 0.03);
  for (let q = 0; q < 7; q++) b.box(x, 0.72 + q * 0.44, z, 0.5 - q * 0.02, 0.45, 0.5 - q * 0.02, q % 2 ? L.column : "#958873", "solid", 0.08);
  b.block(i, j);
}
/** Sekizgen kubbeli çeşme köşkü (meydan süsü; dinî değil): 8 ince sütun, saçak, küçük kubbe, ortada çeşme taşı. */
function fountainKiosk(b: Builder, i: number, j: number) {
  const x = tx(i), z = tz(j), s = scaled(b, x, z, 1);
  for (let q = 0; q < 8; q++) { const a = (q / 8) * Math.PI * 2; b.box(x + Math.cos(a) * 0.62, 0.8, z + Math.sin(a) * 0.62, 0.1, 1.6, 0.1, "#E9E1D0"); }
  oct(s, x, 1.68, z, 1.6, 0.16, "#5F7F6E");
  oct(s, x, 1.82, z, 1.1, 0.14, "#E9E1D0");
  cupola(s, x, 1.88, z, 0.55, 0.5, "#5F7F6E", 3, false);
  oct(s, x, 0.3, z, 0.6, 0.6, "#D7CDBB");
  b.box(x, 0.62, z, 0.36, 0.04, 0.36, S.water, "water");
  b.block(i, j);
}
/** Bahçe havuzu (fıskiye): sekizgen taş bilezik, su, fıskiye. (x, z) merkez; karoları çağıran engeller. */
function fountain(b: Builder, x: number, z: number) {
  const s = scaled(b, x, z, 1);
  oct(s, x, 0.2, z, 2.2, 0.4, "#D7CDBB");
  oct(s, x, 0.36, z, 1.9, 0.1, S.water, 0);
  b.box(x, 0.35, z, 0.7, 0.08, 0.7, "#D7CDBB");
  b.box(x, 0.8, z, 0.08, 0.8, 0.08, "#E6F4FB", "water");
  b.box(x, 1.2, z, 0.3, 0.06, 0.3, "#E6F4FB", "water");
}

/** Kapalı çarşı benzeri sokak (x boyunca i0..i1; kuzey dükkân duvarı jN, yürüme jN+1..jN+2, tezgâh sırası jN+3). Genel
 *  kemerler, yazısız. Ortası açık ışıklık: kemer kaburgaları + yan tonoz şeritleri (alt kenar ≥ 2,5). */
function grandBazaar(b: Builder, i0: number, i1: number, jN: number) {
  const x0 = tx(i0) - 0.5, x1 = tx(i1) + 0.5, xc = (x0 + x1) / 2, len = x1 - x0;
  const zN = tz(jN), zS = tz(jN + 3), zc = (zN + zS) / 2;
  // kuzey dükkân duvarı: nişler, mallar, üstte kubbecikler
  b.box(xc, 1.4, zN - 0.15, len, 2.8, 0.7, L.bazaarStone, "solid", 0.03);
  for (let i = i0; i <= i1; i++) {
    const x = tx(i);
    b.box(x, 0.85, zN + 0.21, 0.62, 1.5, 0.04, L.opening);
    b.box(x, 1.68, zN + 0.21, 0.4, 0.18, 0.04, L.opening);
    for (let q = 0; q < 3; q++) b.box(x - 0.18 + q * 0.18, 0.3 + (q % 2) * 0.12, zN + 0.12, 0.14, 0.22, 0.14, L.spices[(i + q) % 6]);
    b.box(x, 1.25, zN + 0.2, 0.5, 0.06, 0.08, "#8B6A47");
    if (i % 2 === 0) domelet(scaled(b, x, zN, 1), x, 2.8, zN - 0.15, 0.3, L.bazaarVault);
    b.block(i, jN);
  }
  // kemer kaburgaları (her iki karoda bir) + yan tonoz şeritleri; ortası açık
  for (let i = i0; i <= i1 + 1; i += 2) {
    const x = tx(i) - 0.5;
    b.box(x, 2.75, zc, 0.24, 0.3, zS - zN + 1.0, L.bazaarRib, "solid", 0.03);
    b.box(x, 2.55, zS + 0.38, 0.24, 0.5, 0.24, L.bazaarRib);
  }
  for (const [z, y, wd] of [[zN + 0.55, 2.95, 0.7], [zN + 1.0, 3.05, 0.35], [zS - 0.55, 2.95, 0.7], [zS - 1.0, 3.05, 0.35]] as [number, number, number][])
    b.box(xc, y, z, len, 0.14, wd, L.bazaarVault, "solid", 0.03);
  // kemer altında asılı fenerler (gece yanar)
  // CITY-PASS-IST (REAL-SUPPORT): fener kemer kaburgasının altında, kısa zincirle asılı (eski: kaburgalar arasında havada)
  for (let i = i0 + 1; i <= i1; i += 2) {
    b.box(tx(i) + 0.5, 2.35, zc, 0.16, 0.22, 0.16, ["#FFB86B", "#7FD1C7", "#F28FAD"][i % 3], "glow");
    b.box(tx(i) + 0.5, 2.53, zc, 0.03, 0.16, 0.03, "#3A3F47");
  }
  // uç kemer kapıları (taç kemer, iki ayak engellemez: duvar ve tezgâh sırası hizasında)
  // batı ayağı x0 − 0,05'te çarşı önündeki 2 karoluk geçidin ortasındaydı (WALK-CLEAR); doğu ayağı gibi tezgâh karosuna (i0 + 1)
  for (const x of [x0 + 1.05, x1 + 0.05]) {
    b.box(x, 1.5, zS + 0.3, 0.3, 3.0, 0.3, L.bazaarRib, "solid", 0.03);
    b.box(x, 3.15, zc, 0.36, 0.5, zS - zN + 1.3, L.bazaarStone, "solid", 0.03);
  }
}

/** Mısır çarşısı benzeri salon (i0.., j0.., w × 3): kemerli cephe (+z), baharat çuvalları, çatıda kubbecikler. Engelli. */
function spiceHall(b: Builder, i0: number, j0: number, w: number) {
  const X = midX(i0, w), Z = midZ(j0, 3), fz = Z + 1.5;
  b.box(X, 1.25, Z, w, 2.5, 3, L.spiceHall, "solid", 0.03);
  b.box(X, 2.56, Z, w + 0.1, 0.12, 3.1, L.bazaarRib);
  for (let q = 0; q < w; q++) {
    const x = tx(i0 + q);
    b.box(x, 0.85, fz + 0.01, 0.6, 1.4, 0.04, L.opening);
    b.box(x, 1.62, fz + 0.01, 0.38, 0.16, 0.04, L.opening);
    for (let c = 0; c < 3; c++) b.box(x - 0.2 + c * 0.2, 0.2, fz + 0.2, 0.18, 0.4, 0.3, L.spices[(q * 2 + c) % 6], "solid", 0.06);
    domelet(scaled(b, x, Z, 1), x, 2.6, Z - 0.6, 0.34, L.spiceDome);
  }
  cupola(scaled(b, X, Z, 1), X, 2.6, Z + 0.3, 0.9, 0.7, L.spiceDome, 3, false);
  b.box(X, 2.45, fz + 0.3, w - 0.4, 0.08, 0.6, S.awnings[0], "solid", 0.02);
  footprint(b, i0, j0, w, 3);
}

// ------------------------------------------------------------------ yaşam alanı yardımcıları
/** Çay bahçesi masası (alçak, engelli) + iki alçak tabure (istasyon oturağı, y 0,42) + ince belli bardaklar. */
function teaTable(b: Builder, i: number, j: number) {
  const x = tx(i), z = tz(j);
  b.box(x, 0.28, z, 0.08, 0.56, 0.08, "#3A3F47");
  b.box(x, 0.58, z, 0.66, 0.05, 0.66, "#E9E1D0", "solid", 0.02);
  for (const dz of [-0.16, 0.16]) {
    b.box(x + 0.12, 0.615, z + dz, 0.14, 0.02, 0.14, "#F8FAFC");
    b.box(x + 0.12, 0.68, z + dz, 0.06, 0.11, 0.06, TEA, "glass");
  }
  b.laptop(x - 0.12, 0.6, z - 0.12, "-z");
  for (const dj of [-1, 1]) {
    b.box(x, 0.2, tz(j + dj), 0.06, 0.4, 0.06, "#3A3F47");
    b.box(x, 0.4, tz(j + dj), 0.42, 0.05, 0.42, dj < 0 ? "#3F7D6E" : "#C8553D", "solid", 0.02);
  }
  b.block(i, j);
  b.station(i, j - 1, UP, "sit_chair", "laptop", 0.42);
  b.station(i, j + 1, DOWN, "sit_chair", "laptop", 0.42);
}

/** Çay ocağı: tezgâh + bakır semaver + demlik; solundaki karo mola noktası. */
function teaStove(b: Builder, i: number, j: number) {
  const x = tx(i), z = tz(j);
  b.box(x, 0.45, z, 0.9, 0.9, 0.8, WOOD, "solid", 0.04);
  b.box(x, 0.92, z, 0.96, 0.06, 0.86, "#E9E1D0");
  b.box(x, 1.08, z, 0.3, 0.26, 0.3, COPPER, "solid", 0.03);
  b.box(x, 1.32, z, 0.38, 0.24, 0.38, COPPER, "solid", 0.03);
  b.box(x, 1.5, z, 0.2, 0.12, 0.2, "#F8FAFC");
  b.box(x + 0.3, 1.0, z + 0.2, 0.1, 0.12, 0.1, TEA, "glass");
  b.block(i, j);
  b.props.push({ k: "coffee", p: [x, 0, z], r: -Math.PI / 2, tile: [i - 1, j] });
}

/** Tavla masası (S48 `play`, PLAY_BOARD: iki ucu x boyunca yürünebilir). */
function tavla(b: Builder, i: number, j: number) {
  const x = tx(i), z = tz(j);
  b.box(x, 0.3, z, 0.08, 0.6, 0.08, "#3A3F47");
  b.box(x, 0.62, z, 0.8, 0.05, 0.7, "#E9E1D0", "solid", 0.02);
  b.box(x, 0.67, z, 0.62, 0.05, 0.44, "#8B5A2B");
  b.box(x, 0.7, z, 0.03, 0.02, 0.44, "#4A2F18");
  for (let q = 0; q < 6; q++) b.box(x - 0.27 + q * 0.108, 0.698, z + (q % 2 ? 0.12 : -0.12), 0.05, 0.012, 0.12, q % 2 ? "#F4EFE6" : "#5C2E1A");
  for (const dx of [-1, 1]) stool(b.box.bind(b), tx(i + dx), z, 0.385, 0.36, "#3F7D6E"); // CORE-WALK: yere basan tabure
  b.block(i, j);
  b.hook("play", i, j, PLAY_BOARD);
}

/** Simit arabası (camlı kasa, simit halkaları, tekerlek); satıcı istasyonu (i, j−1) ayakta, tablet (`seller` false: yalnız araba;
 *  dar rıhtımda satıcı ajanı yolu kapatmasın). ACTIVITY-FEEL (B5): kasa bir şasinin üstünde; şasi iki yandaki tekerleklere ve
 *  öndeki iki ayağa basar (eski: kasa 0,3 havadaydı, iki tekerlek yalnız arka kenarda — önden bakınca araba havada duruyordu). */
function simitCart(b: Builder, i: number, j: number, seller = true) {
  const x = tx(i), z = tz(j), IRON = "#3F4650";
  b.box(x, 0.33, z, 0.86, 0.06, 0.56, IRON, "solid", 0.02); // şasi (0,30–0,36)
  for (const s of [-1, 1]) {
    b.box(x + 0.22, 0.18, z + s * 0.25, 0.36, 0.36, 0.06, "#2F3640", "solid", 0); // tekerlek (zemin–şasi)
    b.box(x - 0.34, 0.15, z + s * 0.2, 0.06, 0.3, 0.06, IRON, "solid", 0); // dayanak ayağı
  }
  b.box(x + 0.22, 0.18, z, 0.05, 0.05, 0.5, IRON, "solid", 0); // dingil
  b.box(x, 0.58, z, 0.86, 0.44, 0.56, "#8B5A2B", "solid", 0.03); // dolap (0,36–0,80)
  b.box(x, 0.98, z, 0.8, 0.36, 0.5, "#D8EEF7", "glass");
  for (let q = 0; q < 3; q++) for (const dz of [-0.1, 0.1]) {
    const sx = x - 0.24 + q * 0.24, y = 0.9 + (dz > 0 ? 0.1 : 0);
    b.box(sx, y, z + dz, 0.18, 0.05, 0.05, "#C68A3E"); b.box(sx, y, z + dz, 0.05, 0.05, 0.16, "#C68A3E");
  }
  b.box(x, 1.185, z, 0.9, 0.05, 0.6, "#E9E1D0"); // saçak (camın üstüne oturur)
  b.box(x - 0.45, 0.62, z, 0.12, 0.05, 0.5, IRON, "solid", 0); // itme kolu (dolaba geçer)
  b.block(i, j);
  if (seller) marketStation(b, i, j);
}

/** CITY-PASS-IST — balık-ekmek teknesi (Eminönü tipi, özgün): rıhtıma bağlı ahşap gövde (su yüzünün altına iner), yaldız
 *  küpeşte ve kıç süsü, güvertede kor ızgarası (durağan `glow`), ızgarada balıklar, dört dikmeli kırmızı tente, rıhtım yanında
 *  dikmelere bağlı satış tahtası (üstü 0,9; balık-ekmek buradan uzatılır), rıhtıma halat.
 *  (x, z) gövde ortası; boy z boyunca 1,86 (iki karoya sığar). Yazı ve işletme adı yok. */
function fishBoat(b: Builder, x: number, z: number) {
  const HULL = "#7A3B2E", GOLD = "#C9A44C", DECK = "#B98A5A";
  b.box(x, -0.22, z, 0.74, 0.4, 1.5, HULL, "solid", 0.04);
  for (const s of [-1, 1]) b.box(x, -0.2, z + s * 0.83, 0.5, 0.34, 0.2, HULL, "solid", 0.04);
  b.box(x, 0.0, z, 0.8, 0.06, 1.56, GOLD, "solid", 0.02);
  b.box(x, 0.06, z, 0.66, 0.06, 1.4, DECK, "solid", 0.03);
  b.box(x, 0.17, z - 0.96, 0.3, 0.4, 0.06, GOLD, "solid", 0.02);
  // ızgara: kömür teknesi + kor + balıklar
  b.box(x, 0.28, z + 0.15, 0.5, 0.38, 0.56, "#3A3F47", "solid", 0.02);
  b.box(x, 0.48, z + 0.15, 0.42, 0.03, 0.48, "#F2793B", "glow", 0);
  for (const dz of [-0.12, 0.02, 0.16, 0.3]) b.box(x, 0.515, z + dz + 0.01, 0.3, 0.04, 0.08, "#B7C3CC", "solid", 0.03);
  // tente: dört dikme + kırmızı-beyaz örtü
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(x + sx * 0.33, 0.62, z + sz * 0.62, 0.05, 1.0, 0.05, "#5B3A29");
  b.box(x - 0.36, 0.87, z, 0.2, 0.06, 1.6, "#C9A27A", "solid", 0.02); // rıhtıma uzanan satış tahtası (dikmelere bağlı)
  b.box(x, 1.15, z, 0.8, 0.06, 1.4, "#B91C1C", "solid", 0.02);
  b.box(x, 1.21, z, 0.5, 0.06, 1.34, "#F8FAFC", "solid", 0.02);
  // rıhtıma bağlama halatı (rıhtım kenarına değer)
  b.box(x - 0.47, 0.06, z - 0.55, 0.22, 0.03, 0.03, "#C8B48A");
}

/** Açık pergola (seyrek çıtalar), köşe direkleri karo kenarında (engellemez). */
function pergola(b: Builder, i0: number, i1: number, j: number, c: string) {
  const x0 = tx(i0) - 0.45, x1 = tx(i1) + 0.45, z0 = tz(j) - 0.45, z1 = tz(j) + 0.45, h = 2.4;
  for (const px of [x0, x1]) for (const pz of [z0, z1]) b.box(px, h / 2, pz, 0.1, h, 0.1, WOOD);
  for (const pz of [z0, z1]) b.box((x0 + x1) / 2, h, pz, x1 - x0 + 0.3, 0.1, 0.1, WOOD);
  for (let x = x0 + 0.3; x < x1; x += 0.6) b.box(x, h + 0.08, tz(j), 0.08, 0.06, 1.2, c);
}

/** Pano (direk + tahta, engelli); önündeki karo araç noktası. */
function board(b: Builder, i: number, j: number, face: "+z" | "-z", c = "#E9D8A6") {
  const x = tx(i), z = tz(j), s = face === "+z" ? 1 : -1;
  b.box(x, 0.6, z, 0.1, 1.2, 0.1, WOOD);
  b.box(x, 1.3, z, 0.9, 0.7, 0.08, WOOD, "solid", 0.02);
  b.box(x, 1.3, z + s * 0.05, 0.76, 0.56, 0.02, c);
  b.block(i, j);
}

/** Yamaçta ahşap konak (2 × 2): taş set kaidesi (yükseklik `base`), pastel ahşap gövde, öne taşan cumba, kepenkli pencereler
 *  (gece yanar), kiremit kırma çatı. Ayak izini engeller. */
function konak(b: Builder, i0: number, j0: number, floors: number, wall: string, base: number) {
  const x = midX(i0, 2), z = midZ(j0, 2), front = z + 1, H = 1.35, top = base + floors * H;
  noteObject(b, "tower", [i0, j0], { w: 2, d: 2, floors, y: top, enclosed: true });
  if (base > 0.05) {
    b.box(x, base / 2, z, 2.0, base, 2.0, L.hillStone, "solid", 0.05);
    b.box(x, base + 0.03, front - 0.02, 2.04, 0.06, 0.1, "#C9BFAC");
  }
  b.box(x, base + (floors * H) / 2, z - 0.05, 1.86, floors * H, 1.8, wall, "solid", 0.03);
  b.box(x, base + 0.55, front - 0.13, 0.42, 1.0, 0.05, S.door);
  for (let f = 0; f < floors; f++) {
    const wy = base + f * H + H * 0.58;
    if (f > 0) b.box(x, base + f * H, front - 0.12, 1.92, 0.08, 0.1, S.trim);
    for (const sx of f === 0 ? [-0.55, 0.55] : [-0.6, 0, 0.6]) {
      b.box(x + sx, wy, front - 0.12 + (f ? 0.42 : 0), 0.32, H * 0.42, 0.05, S.window, "glass");
      b.props.push({ k: "window", p: [x + sx, wy, front - 0.08 + (f ? 0.42 : 0)], r: 0, s: [0.28, H * 0.38], c: S.windowLit });
    }
    // CITY-PASS-IST (REAL-FACADE): yan ve arka cephede de her katta kepenkli pencere (konak dört yüzden görünür)
    for (const sx of [-1, 1]) {
      b.box(x + sx * 0.945, wy, z - 0.05, 0.05, H * 0.42, 0.34, S.window, "glass");
      b.box(x + sx * 0.955, wy, z - 0.3, 0.03, H * 0.46, 0.1, S.trim);
      b.box(x + sx * 0.955, wy, z + 0.2, 0.03, H * 0.46, 0.1, S.trim);
    }
    for (const sx of [-0.45, 0.45]) b.box(x + sx, wy, z - 0.98, 0.32, H * 0.42, 0.05, S.window, "glass");
  }
  if (floors > 1) {
    const ch = (floors - 1) * H;
    b.box(x, base + H + ch / 2, front + 0.08, 1.7, ch, 0.42, wall, "solid", 0.03);
    b.box(x, base + H - 0.05, front + 0.08, 1.8, 0.1, 0.5, S.trim);
  }
  // kiremit kırma çatı: geniş saçak + dik mahya (CITY-PASS-IST: üst iki kademe dar → çatı, kat sanılmaz)
  [[2.5, 2.5, 0.2], [1.9, 1.9, 0.22], [0.9, 1.3, 0.22], [0.4, 0.8, 0.2]].forEach(([w, d, h], q) =>
    b.box(x, top + 0.1 + q * 0.21, z + 0.04, w, h, d, S.roofColor, "solid", 0.03));
  footprint(b, i0, j0, 2, 2);
}

export function buildIstanbul(): Built {
  const b = new Builder(1453, GW, GD);
  const strait = (i: number, j: number) => i >= 23 && i <= 27 && j <= 29;
  paintCity(b, S, (i, j) => (strait(i, j) ? "water"
    : i === 22 || i === 28 || j >= 30 ? "quay"
    : j <= 1 ? "street"
    : i >= 29 ? (j <= 15 ? "street" : j <= 19 ? "sidewalk" : "plaza")
    : i >= 10 && i <= 13 && j >= 2 && j <= 10 ? "grass"
    : j >= 20 && j <= 23 && i <= 14 ? "sidewalk"
    : i >= 1 && i <= 9 && j >= 24 && j <= 29 ? "grass"
    : "plaza"));

  // ---- Boğaz: su (i 23–27, j 0–29), arkada yürünür alçak köprü (kenar kapısı + olta), önde rıhtım güvertesi (j 30)
  waterBody(b, S, 23, 0, 27, 29, "sea");
  lowBridge(b, 23, 27, 0, 26);
  for (const i of [24, 26]) b.hook("fish", i, 1, 0);
  for (const [i, s] of [[24, -1], [26, 1]] as [number, number][]) b.box(tx(i) + s * 0.3, 0.9, tz(1) + 0.5, 0.03, 1.1, 0.03, "#3A3F47");
  quay(b, S, 23, 27, 30, "-z", [24, 26]);
  for (const [x, s] of [[tx(22) + 0.44, 1], [tx(28) - 0.44, -1]] as [number, number][]) {
    b.box(x, 0.06, (tz(2) + tz(29)) / 2, 0.12, 0.12, 28, S.ground.quay[1], "solid", 0.03);
    for (const j of [3, 8, 13, 22, 27]) b.box(x - s * 0.12, 0.2, tz(j), 0.18, 0.4, 0.18, "#3A3F47");
  }
  // rıhtım oltacıları (camilere ≥ 4 karo)
  for (const j of [15, 21]) b.hook("fish", 22, j, 2);
  for (const j of [12, 22, 27]) b.hook("fish", 28, j, 3);

  // ---- simgeler (çekirdeğin ortasında)
  ayasofya(b, 2, 3, 1.1);
  sultanahmet(b, 15, 3, 1.1);
  // SKY-FIX: Süleymaniye taban tahtasında yok (ızgara dışı ufukta havada duruyordu, ürün sahibi 2026-10-30); şehir haritasında tepesinde durur
  // (K2 simge eğrisi, sahne = eğri × 0,6): Galata ×0,9 (tepe 11,4 → 9,5; camilerden uzun), köprü kuleleri 7,2 → 10,6
  // (Boğaz'ın en uzun yapısı), Kız Kulesi kulesi 4,0 → 5,0
  galata(b, 30, 2, 0.9);
  // (WALK-CLEAR-001, ürün sahibi "köprü direkleri yürüyüşü zorlaştırıyor"): kuleler rıhtımda (i 22 / i 28) rıhtım yürüyüşünü
  // kesiyordu — kuleler suyun kenar karosunda (i 23 / i 27; vapur şeritleri i 24 / i 26 açık), ankrajlar karada (i 21 / i 29)
  bosphorusBridge(b, 18, 23, 27, 2);
  // Kız Kulesi benzeri ada Boğaz'ın ortasında, iki vapur şeridinin arasında; yanında doğu rıhtımı oltası (şamandıra i 27)
  maidenTower(b, 25, 25);
  b.hook("fish", 28, 25, 3);

  // ---- camiler arası bahçe (i 10–13): havuz, çınarlar, çiçek tarhları, çakıl yol
  fountain(b, (tx(11) + tx(12)) / 2, (tz(5) + tz(6)) / 2);
  for (const i of [11, 12]) for (const j of [5, 6]) b.block(i, j);
  for (const [i, j] of [[10, 2], [13, 2], [10, 9], [13, 9]] as [number, number][]) cityTree(b, i, j, "plane");
  b.box((tx(10) + tx(13)) / 2, 0.012, tz(1) + 4.5, 0.6, 0.024, 9, "#E9DFC9");
  for (const j of [3, 8]) for (const i of [11, 12]) {
    b.box(tx(i), 0.08, tz(j), 0.8, 0.16, 0.8, "#9C8B70", "solid", 0.03);
    for (let q = 0; q < 4; q++) b.box(tx(i) - 0.24 + q * 0.16, 0.22, tz(j) + (q % 2 ? 0.15 : -0.15), 0.12, 0.12, 0.12, S.awnings[(i + j + q) % 4]);
    b.block(i, j);
  }

  // ---- Sultanahmet meydanı + hipodrom benzeri alan (j 12–18): oval taş yol, dikilitaş, örme sütun, çeşme köşkü
  for (const z of [tz(13), tz(17)]) b.box((tx(3) + tx(19)) / 2, 0.012, z, 17, 0.024, 0.5, "#E9DFC9");
  for (const x of [tx(3), tx(19)]) b.box(x, 0.012, tz(15), 0.5, 0.024, 4.5, "#E9DFC9");
  b.box((tx(6) + tx(16)) / 2, 0.016, tz(15), 10.5, 0.03, 0.7, "#CDBFA6");
  fountainKiosk(b, 6, 15);
  obelisk(b, 11, 15);
  stoneColumn(b, 16, 15);
  for (const [i, j] of [[2, 12], [20, 13], [2, 18]] as [number, number][]) cityTree(b, i, j, "plane");
  for (const [i, j, f] of [[8, 13, "+z"], [14, 13, "+z"], [8, 17, "-z"], [14, 17, "-z"]] as [number, number, "+z" | "-z"][]) {
    cityBench(b, i, j, f); b.rest.push([i, f === "+z" ? j + 1 : j - 1]); // CITYFIX1: dinlenme bankın ÖNÜNDE, zeminde (bank tahtasına gömülmez)
  }
  simitCart(b, 12, 19);
  for (const [i, j] of [[4, 17], [18, 17], [11, 12]] as [number, number][]) streetLamp(b, S, i, j);
  b.box((tx(0) + tx(21)) / 2, 0.012, tz(11), 22, 0.024, 0.4, "#E9DFC9");

  // ---- kapalı çarşı sokağı (i 1–13, j 20–23): satıcılar kemer altında (j 22), tezgâhlar j 23; uçta sahaf (oku/yaz)
  grandBazaar(b, 1, 13, 20);
  ([[2, "crafts"], [4, "tea"], [6, "fruit"], [8, "flowers"], [10, "bread"]] as const).forEach(([i, kind]) => {
    marketStall(b, S, i, 23, kind); marketStation(b, i, 23);
  });
  marketStall(b, S, 12, 23, "books"); b.spot("read", 12, 22, UP); b.spot("write", 13, 22, LEFT);

  // ---- mısır çarşısı benzeri salon (i 15–20, j 20–22) + baharat tezgâhları
  spiceHall(b, 15, 20, 6);
  // CITY-PASS-IST (ritüel mekânı, CORE-WALK `city/venues.ts`): salonun önünde çay bahçesi — semaver tezgâhı (i 16–18, j 25),
  // önünde alçak tabureler, arkada alçak masa ve tabureler; `cay_bogaz` sipariş karosu (17, 26). Meyve tezgâhı yanda (19, 25).
  placeVenue(b.box.bind(b), "tea_garden", tx(17), tz(25), "+z", "scene");
  for (const [di, dj] of venueSolidTiles("tea_garden", "+z")) b.block(17 + di, 25 + dj);
  marketStall(b, S, 19, 25, "fruit", S.awnings[1]); marketStation(b, 19, 25);

  // ---- çay bahçesi (ön sol): alçak masalar (8 istasyon), çay ocağı (mola), tavla, çınarlar, fener dizisi
  for (const [i, j] of [[2, 25], [5, 25], [2, 28], [5, 28]] as [number, number][]) teaTable(b, i, j);
  teaStove(b, 8, 25);
  tavla(b, 8, 28);
  for (const [i, j] of [[1, 30], [7, 30]] as [number, number][]) cityTree(b, i, j, "plane");
  // CITY-PASS-IST (REAL-SUPPORT): fener dizisi iki ahşap direğe gerili telde; fenerler tele asılı (eski: tel ve fenerler havada)
  const zw = (tz(26) + tz(27)) / 2;
  for (let q = 0; q < 9; q++) {
    b.box(tx(1) + 0.2 + q * 0.9, q % 2 ? 2.4 : 2.47, zw, 0.12, 0.14, 0.12, "#FFD98A", "glow");
    if (q % 2) b.box(tx(1) + 0.2 + q * 0.9, 2.505, zw, 0.02, 0.07, 0.02, "#3A3F47");
  }
  b.box(tx(5), 2.55, zw, 8.4, 0.02, 0.02, "#3A3F47");
  for (const s of [-1, 1]) b.box(tx(5) + s * 4.2, 1.29, zw, 0.08, 2.58, 0.08, WOOD);
  b.hook("grass", 4, 29, 1);

  // ---- kafe terası (4 istasyon) + web panosu
  for (const i of [11, 13]) { cafeSet(b, i, 27); cafeStations(b, i, 27); }
  b.canopy(11, 11, 26, 28, S.awnings[0], 2.3, "#2F3640");
  b.canopy(13, 13, 26, 28, S.awnings[1], 2.3, "#2F3640");
  board(b, 10, 25, "+z", "#CFE3F0"); b.spot("web", 10, 26, DOWN);

  // ---- vapur iskelesi (batı rıhtımı): bilet otomatı (kabuk), saçak, duba, bank istasyonları
  b.terminal(21, 24, "+z"); b.spot("shell", 21, 25, DOWN);
  b.box(tx(23) - 0.25, -0.1, (tz(25) + tz(26)) / 2, 0.5, 0.12, 2, "#A0805A", "solid", 0.03); // vapur dubası (terminalin önü)
  // CITY-PASS-IST (ritüel mekânı `food_stand`, Eminönü usulü): iskelenin yanında rıhtıma bağlı ızgara teknesi (i 23, j 27–28) satış
  // tahtasını rıhtıma uzatır; müşteri rıhtımda tekneye dönük sipariş verir (sipariş karosu (22, 28)); rıhtımın gerisinde uzun alçak
  // masa (i 20–21, j 28) ve dört tabure. Rıhtım şeridi (i 22) yürünür ve oltacılara açık kalır. Eski bank istasyonları sahil
  // yoluna taşındı (16–17, 30).
  fishBoat(b, tx(23) - 0.02, (tz(27) + tz(28)) / 2);
  const mx = tx(20) + 0.6;
  for (const j of [27, 29]) for (const dx of [-0.3, 0.6]) stool(b.box.bind(b), mx + dx, tz(j) + (j < 28 ? 0.15 : -0.15), 0.465, 0.36, "#8B5A2B");
  b.box(mx, 0.75, tz(28), 1.5, 0.06, 0.62, "#A47148", "solid", 0.03);
  for (const dx of [-0.6, 0.6]) { b.box(mx + dx, 0.36, tz(28), 0.08, 0.72, 0.08, "#3A3F47"); b.box(mx + dx, 0.015, tz(28), 0.3, 0.03, 0.3, "#3A3F47"); }
  b.box(mx + 0.2, 0.8, tz(28) - 0.1, 0.16, 0.04, 0.1, "#E9D8A6");
  b.block(20, 28); b.block(21, 28);

  // ---- sahil yürüyüş yolu (j 30–31): lambalar, banklar (dinlenme), iskele bankları (istasyon), simit arabası
  for (const [i, j] of [[10, 30], [15, 30], [21, 30], [33, 30]] as [number, number][]) streetLamp(b, S, i, j);
  for (const i of [13, 19]) { cityBench(b, i, 30, "+z"); b.rest.push([i, 31]); } // CITYFIX1: dinlenme bankın önünde
  for (const i of [16, 17]) { cityBench(b, i, 30, "+z"); b.station(i, 30, UP, "sit_bench", "laptop", 0.46); }
  // CITY-PASS-IST: simit (`simit_marti`) iskele başındaki arabadan alınır — güney rıhtım (26, 31) ve doğu rıhtımı (29, 22).
  // ACTIVITY-FEEL (B5): arabalar ritüel konumlarının (25, 31) ve (29, 23) hemen yanında (eski (28, 31) ve (29, 21): arabanın
  // çevresinden ritüel 3 karo uzaktaydı — simit alınamıyordu)
  simitCart(b, 26, 31, false);
  simitCart(b, 29, 22, false);

  // ---- doğu yakası: Galata yamacı — basamaklı sokak (i 32) ve setler üstünde yükselen ahşap konaklar
  const climb: [number, number, number, number, number][] = [
    [30, 7, 3, 0, 0.8], [33, 7, 3, 2, 0.8], [30, 10, 2, 3, 0.45], [33, 10, 3, 1, 0.45], [30, 13, 2, 4, 0.15], [33, 13, 2, 0, 0.15]];
  for (const [i, j, f, wc, base] of climb) konak(b, i, j, f, S.walls[wc], base);
  for (let j = 7; j <= 15; j++) b.box(tx(32), 0.03, tz(j) - 0.3, 0.9, 0.06, 0.22, "#C9BFAC", "solid", 0.03);
  b.hook("roof", 30, 7); b.hook("window", 33, 10); b.hook("roof", 33, 13);
  streetLamp(b, S, 29, 9);

  // ---- doğu çay bahçesi (4 istasyon) + plan panosu + büfe (kahve/mola)
  // CITY-PASS-IST (ritüel mekânı): Boğaz kıyısında çay bahçesi (köprü ankrajının güneyi) — semaver tezgâhı (i 31, j 15–17; çaycı
  // arkada, mola noktası (32, 16)), önünde tabureler, kıyıda alçak masa (29, 16) ve tabureler; `cay_bogaz` sipariş karosu (30, 16).
  // Rıhtımda bir oltacı daha (28, 14).
  // (VENUE-CLEARANCE-001, ürün sahibi "köprü altında yeme-içme alanı köprü ayağına dayalı"): çay bahçesi asma köprü ankrajının
  // (29, 18) dibindeydi (masa sırası ayağa 0 karo) — aynı Boğaz kıyısında köprünün güneyinde, ankrajdan ≥ 2 boş karo uzakta (tezgâh
  // i 31 × j 24–26, sipariş (30, 25), masalar kıyıda i 29); simit arabası (29, 23) ve otel (32–33, 23) dışında
  placeVenue(b.box.bind(b), "tea_garden", tx(31), tz(25), "-x", "scene");
  for (const [di, dj] of venueSolidTiles("tea_garden", "-x")) b.block(31 + di, 25 + dj);
  b.props.push({ k: "coffee", p: [tx(31), 0, tz(25)], r: Math.PI / 2, tile: [32, 25] });
  b.hook("fish", 28, 14, 3);
  teaTable(b, 34, 18);
  board(b, 33, 16, "+z"); b.spot("plan", 33, 17, DOWN);

  // ---- HOTEL-SYS (E1): şehrin tek oteli — küçük ahşap konak (2 × 1, kapı güneyde (32, 24)); eski açık pansiyon (15 ranza) kalktı.
  //      Önünde konak bahçesi: çiçek tarhları, asmalı çardak altında iki bank (oturma), dinlenme karoları zeminde.
  placeHotel(b, "istanbul", { at: [32, 23], w: 2, d: 1, door: [32, 24] }, S);
  flowerBed(b, 30, 21, 2, 1, S.awnings); flowerBed(b, 34, 23, 1, 1, S.awnings); flowerBed(b, 30, 23, 1, 1, S.awnings);
  pergola(b, 30, 34, 27, S.awnings[0]);
  cityBench(b, 31, 27, "-z"); cityBench(b, 33, 27, "-z");
  b.rest.push([35, 25], [29, 29]);

  // ---- hareketli: iki vapur Boğaz'da gidip gelir, asma köprünün altından geçer (ızgara içinde). şeritler 0,15 dışa
  // alındı (i 24 / i 26 ± 0,05); gövde eni 0,87 → iç kenarlar x = tx(25) ± 0,61, Kız Kulesi adası (± 0,48) arada kalır.
  const z0 = tz(3) + 0.2, z1 = tz(28) - 0.2; // WATER-CLEAR: güney uç 0,6 içeri (vapur pruvası güney rıhtımına girmez). CITY-PASS-IST: köprü iki karo; vapur pruvası güvertenin (j 1) önünde döner
  addMover(b, { shape: "ferry", period: 70, mode: "pingpong", scale: 0.7, path: [[tx(24) - 0.05, -0.25, z0], [tx(24) - 0.05, -0.25, z1]] });
  addMover(b, { shape: "ferry", period: 80, mode: "pingpong", phase: 0.45, scale: 0.7, path: [[tx(26) + 0.05, -0.25, z1], [tx(26) + 0.05, -0.25, z0]] });
  fillSpotReach(b); // her istasyona ölçeklenmiş yarıçapta araç noktası
  return b.done();
}

/** Sahne tanımı alanları (scenes.ts kaydı: `scene({ id: "istanbul", core: CITY_CORE, ...ISTANBUL_ENV, build: buildIstanbul })`;
 *  büyük taban çekirdeği burada). */
export const ISTANBUL_ENV: Omit<SceneDef, "id" | "label" | "hint" | "build"> = {
  swatch: ["#D9CBB2", "#2E7FA8"], sky: "#BFDDF0", fog: [50, 120],
  hemi: ["#FFF7EC", "#C4B8A4", 1.15], sun: { color: "#FFF1DA", intensity: 1.8, pos: [-8, 15, 10] },
  tier: "city", pack: "world_tour_turkey", time: "auto", ip_risk: 1, culture_risk: 1,
  core: { i0: 0, j0: 0, w: GW, d: GD },
};
