/**
 * CITY-PACKS — yapı paketleri (kamu malı tarihî yapıların stilize voxel yorumları + "esinli yapılar").
 *
 * Kurallar (karar 2026-10-25 "andırması yeterli"):
 * - Kamu malı tarihî yapılar (mimarı/heykeltıraşı 70+ yıl önce ölmüş) sadık olabilir; adları yine **genel betimleyici**dir
 * (bina adı marka olabilir: arayüzde, dosya adında ve kimlikte gerçek ad yok).
 * - "Esinli yapı" (`esinli`): adı, ışığı ya da görüntüsü korunan yapılar yerine özgün tasarım — birkaç tanımlayıcı özellik
 * (oran, imza öğelerinin sayısı/dizilişi, süs, renk, malzeme) bilerek değiştirilir; satıştan önce avukat incelemesi.
 * - Yazı, logo, bayrak, dinî simge, gerçek kişi ya da heykel portresi yok. Desenli/animasyonlu simge ışığı yok.
 * - Şehir haritasında kullanılan öğeler yalnız durağan gruplar taşır (`solid/water/glass/glow`; CITY-MAP-BUDGET-001).
*/
import { Kit, type Box } from "../kit";

// ------------------------------------------------------------------------------------------ İstanbul tarihî yapılar
const STONE = "#C9B79A", STONE_D = "#A8957A", BAND = "#A0583F", MOSS = "#6E8F4E";

/** Su kemeri (4. yy <city>; iki katlı kemer sırası, tuğla kuşaklar, tepede yer yer ot). 10 × 2.*/
export function aqueduct(): Box[] {
  const k = new Kit(10, 2);
  k.arcade(0, 10, 0, 0.5, 1, 5, 0.8, 3.2, STONE, BAND);
  k.arcade(0, 10, 3.71, 0.55, 0.9, 8, 0.5, 2.1, STONE_D, BAND);
  k.b(0, 6.15, 0.6, 10, 0.25, 0.8, STONE);
  for (const x of [1.2, 3.6, 6.8, 8.9]) k.b(x, 6.4, 0.75, 0.6, 0.22, 0.5, MOSS);
  return k.done();
}

/** Yangın gözetleme kulesi (1828; beyaz taş gövde, şerefe, fener odası, kurşun külah). 3 × 3. */
export function fireTower(): Box[] {
  const k = new Kit(3, 3), W = "#EFEAE0", W2 = "#D9D2C3", LEAD = "#6E7B86";
  k.c(1.5, 0, 1.5, 3, 0.6, 3, W2).c(1.5, 0.6, 1.5, 2.2, 0.5, 2.2, W2);
  k.c(1.5, 1.1, 1.5, 1.8, 6.6, 1.8, W);
  for (const y of [2.8, 4.6, 6.4]) k.c(1.5, y, 1.5, 1.9, 0.12, 1.9, W2);
  for (const y of [2.0, 3.7, 5.5]) k.c(1.5, y, 2.42, 0.32, 0.6, 0.06, "#5C6670");
  k.c(1.5, 7.7, 1.5, 2.6, 0.2, 2.6, W2);
  k.oct(1.5, 7.9, 1.5, 1.4, 1.5, W);
  k.c(1.5, 8.3, 2.2, 0.5, 0.5, 0.06, "#FFE7B0", "glow");
  k.c(1.5, 9.4, 1.5, 1.6, 0.18, 1.6, W2);
  k.oct(1.5, 9.58, 1.5, 1.1, 0.5, LEAD).oct(1.5, 10.08, 1.5, 0.7, 0.45, LEAD).c(1.5, 10.53, 1.5, 0.14, 0.5, 0.14, LEAD);
  return k.done();
}

/** Anıt sütun (4. yy; porfir tambur gövde, bilezik kuşaklar, kaide). 2 × 2. */
export function honorColumn(): Box[] {
  const k = new Kit(2, 2), POR = "#7B3B36", RING = "#B08D57";
  k.c(1, 0, 1, 1.9, 0.9, 1.9, "#BDB3A3").c(1, 0.9, 1, 1.4, 0.35, 1.4, "#CFC6B6");
  k.oct(1, 1.25, 1, 1.0, 6.2, POR);
  for (let n = 1; n <= 6; n++) k.c(1, 1.25 + n * 0.95 - 0.05, 1, 1.06, 0.1, 1.06, RING);
  k.c(1, 7.45, 1, 1.25, 0.4, 1.25, "#CFC6B6");
  return k.done();
}

/** Hisar kapısı (15. yy sur kapısı: iki çokgen kule, mazgallı perde duvar, kemerli kapı). 6 × 2. */
export function fortressGate(): Box[] {
  const k = new Kit(6, 2), WALL = "#B9AE98", W2 = "#A39883";
  k.b(0.8, 0, 0.5, 4.4, 4, 1, WALL);
  k.b(2.35, 0, 1.47, 1.3, 2.4, 0.06, "#3A3128");
  k.b(2.2, 2.4, 1.48, 1.6, 0.22, 0.08, W2).b(2.45, 2.62, 1.48, 1.1, 0.18, 0.08, W2);
  k.crenel(0.8, 5.2, 4, 0.5, 1, W2, 0.73);
  for (const x of [0.9, 5.1]) {
    k.oct(x, 0, 1, 1.8, 5.2, WALL);
    k.oct(x, 5.2, 1, 1.95, 0.3, W2);
    for (const [dx, dz] of [[-0.7, 0], [0.7, 0], [0, -0.7], [0, 0.7]]) k.c(x + dx, 5.5, 1 + dz, 0.4, 0.36, 0.4, W2);
    k.c(x, 2.6, 1.92, 0.18, 0.7, 0.06, "#3A3128");
  }
  return k.done();
}

// ------------------------------------------------------------------------------------------ Kapadokya kervan yolu
const TUFF = "#D9BFA0", TUFF_D = "#C4A47F", SAND = "#D8B48A";

/** Kervansaray (13. yy; dikdörtgen avlu, yüksek taç kapı, kademeli niş, avluda revak ve çeşme). 8 × 6. */
export function caravanserai(): Box[] {
  const k = new Kit(8, 6), S2 = "#C59F74";
  k.b(0, 0, 0, 8, 3, 0.6, SAND).b(0, 0, 0.6, 0.6, 3, 4.8, SAND).b(7.4, 0, 0.6, 0.6, 3, 4.8, SAND);
  k.b(0, 0, 5.4, 2.8, 3, 0.6, SAND).b(5.2, 0, 5.4, 2.8, 3, 0.6, SAND);
  k.b(0.6, 0, 0.6, 6.8, 0.06, 4.8, "#CDB38F");
  k.arcade(0.6, 7.4, 0, 0.6, 0.7, 5, 0.4, 2.1, SAND, S2);
  // taç kapı: çıkıntılı kütle, kademeli niş (mukarnas izlenimi), koyu kapı açıklığı
  k.b(2.6, 0, 5.2, 2.8, 4.6, 0.9, S2);
  k.b(3.0, 0.4, 6.06, 2.0, 3.8, 0.06, SAND);
  for (let n = 0; n < 3; n++) k.b(3.2 + n * 0.15, 2.6 + n * 0.35, 6.1, 1.6 - n * 0.3, 0.3, 0.05, n % 2 ? S2 : "#E3C59B");
  k.b(3.45, 0, 6.12, 1.1, 2.1, 0.04, "#4A3A2C");
  // köşe payandaları ve avlu çeşmesi
  for (const [x, z] of [[0, 0], [7.4, 0], [0, 5.4], [7.4, 5.4]]) k.b(x - 0.1, 0, z - 0.1, 0.8, 3.3, 0.8, S2);
  k.c(4, 0.06, 3.4, 1.2, 0.4, 1.2, "#BBA27E").c(4, 0.46, 3.4, 0.9, 0.06, 0.9, "#4EA3C8", "water");
  return k.done();
}

/** Kaya kalesi (doğal tüf kütlesi, oyma pencereler, basamaklı taraçalar). 4 × 4. */
export function rockCastle(): Box[] {
  const k = new Kit(4, 4), DARK = "#3B2E25";
  k.b(0, 0, 0, 4, 3, 4, TUFF).b(0.4, 3, 0.3, 3.2, 2.6, 3.4, TUFF_D).b(0.8, 5.6, 0.6, 2.4, 2.2, 2.6, TUFF);
  k.b(1.2, 7.8, 1.0, 1.6, 1.4, 1.8, TUFF_D).b(1.5, 9.2, 1.3, 1.0, 0.8, 1.1, TUFF);
  k.b(3.3, 0, 0.2, 1.0, 1.6, 2.2, TUFF_D).b(-0.3, 0, 1.6, 0.6, 2.2, 1.8, TUFF_D);
  for (const [x, y, z] of [[0.6, 1.2, 4], [1.6, 1.8, 4], [2.8, 1.0, 4], [1.0, 3.8, 3.7], [2.4, 4.4, 3.7], [1.4, 6.4, 3.2], [2.3, 6.9, 3.2], [1.8, 8.4, 2.8]])
    k.b(x, y, z - 0.02, 0.35, 0.45, 0.06, DARK);
  k.b(1.7, 0, 3.98, 0.6, 1.0, 0.06, DARK);
  for (let n = 0; n < 3; n++) k.b(3.0 + n * 0.25, 0, 3.6 - n * 0.4, 0.5, 0.3 + n * 0.3, 0.4, "#CDB18E");
  return k.done();
}

/** Taş kemer köprü (Selçuklu tipi tek büyük kemer, kambur güverte, korkuluk). 6 × 2. */
export function humpBridge(): Box[] {
  const k = new Kit(6, 2), ST = "#B8A386", ST2 = "#A18C70";
  k.b(0, 0, 0.4, 1.4, 1.0, 1.2, ST).b(4.6, 0, 0.4, 1.4, 1.0, 1.2, ST);
  k.b(1.4, 0.4, 0.4, 0.45, 1.1, 1.2, ST).b(4.15, 0.4, 0.4, 0.45, 1.1, 1.2, ST);
  k.b(1.85, 1.2, 0.4, 0.5, 0.5, 1.2, ST2).b(3.65, 1.2, 0.4, 0.5, 0.5, 1.2, ST2).b(2.35, 1.5, 0.4, 1.3, 0.35, 1.2, ST);
  const deck: [number, number, number][] = [[0, 1.0, 1.4], [1.4, 1.5, 0.45], [1.85, 1.7, 0.5], [2.35, 1.85, 1.3], [3.65, 1.7, 0.5], [4.15, 1.5, 0.45], [4.6, 1.0, 1.4]];
  for (const [x, y, w] of deck) {
    k.b(x, y, 0.4, w, 0.14, 1.2, ST2);
    k.b(x, y + 0.14, 0.4, w, 0.35, 0.12, ST).b(x, y + 0.14, 1.48, w, 0.35, 0.12, ST);
  }
  return k.done();
}

// ------------------------------------------------------------------------------------------ Londra Viktorya dönemi
const GLASS = "#CFE8EE", RIB = "#F4F4EF";

/** Cam palmiye serası (1848; dökme demir kaburga, yüksek orta nef, iki kanat, içeride palmiyeler). 8 × 4. */
export function palmHouse(): Box[] {
  const k = new Kit(8, 4);
  k.b(0, 0, 0, 8, 0.3, 4, "#D9D4C8");
  for (const x of [3.2, 4.4]) { k.c(x, 0.3, 2, 0.18, 2.6, 0.18, "#7A5A3A"); k.c(x, 2.9, 2, 1.1, 0.25, 1.1, "#3E8E4A"); }
  for (const x of [1.4, 6.6]) { k.c(x, 0.3, 2, 0.14, 1.4, 0.14, "#7A5A3A"); k.c(x, 1.7, 2, 0.8, 0.2, 0.8, "#3E8E4A"); }
  k.b(2.5, 0.3, 0.4, 3, 3.2, 3.2, GLASS, "glass").b(2.8, 3.5, 0.6, 2.4, 0.6, 2.8, GLASS, "glass").b(3.3, 4.1, 0.9, 1.4, 0.4, 2.2, GLASS, "glass");
  k.b(0.3, 0.3, 0.8, 2.2, 2.0, 2.4, GLASS, "glass").b(0.5, 2.3, 1.0, 1.8, 0.4, 2.0, GLASS, "glass");
  k.b(5.5, 0.3, 0.8, 2.2, 2.0, 2.4, GLASS, "glass").b(5.7, 2.3, 1.0, 1.8, 0.4, 2.0, GLASS, "glass");
  for (const x of [2.5, 3.2, 3.95, 4.7, 5.42]) k.b(x, 0.3, 3.6, 0.08, 3.25, 0.08, RIB);
  for (const x of [0.3, 1.0, 1.75, 2.42, 5.5, 6.25, 7.0, 7.62]) k.b(x, 0.3, 3.2, 0.08, 2.05, 0.08, RIB);
  k.b(2.5, 3.5, 3.55, 3, 0.08, 0.1, RIB).b(0.3, 2.3, 3.15, 2.2, 0.08, 0.1, RIB).b(5.5, 2.3, 3.15, 2.2, 0.08, 0.1, RIB);
  k.b(3.75, 4.5, 0.9, 0.5, 0.25, 2.2, RIB);
  return k.done();
}

/** Kubbeli konser salonu (1871; oval tuğla tambur, pişmiş toprak friz, cam-demir kubbe). Genel ad. 6 × 6. */
export function domedHall(): Box[] {
  const k = new Kit(6, 6), BR = "#A7513F", FR = "#D9BE8E";
  k.oct(3, 0, 3, 5.6, 3.4, BR);
  for (const [x, z] of [[3, 5.82], [0.18, 3], [5.82, 3], [3, 0.18]]) k.c(x, 0.8, z, x === 3 ? 0.5 : 0.06, 1.2, x === 3 ? 0.06 : 0.5, "#5C3A30");
  k.oct(3, 3.4, 3, 5.75, 0.4, FR).oct(3, 3.8, 3, 5.2, 0.8, BR);
  k.dome(3, 4.6, 3, 2.4, 1.6, "#8FA3AE", 3);
  k.oct(3, 6.2, 3, 0.8, 0.45, "#8FA3AE").c(3, 6.65, 3, 0.16, 0.3, 0.16, "#6C7E88");
  k.b(2.1, 0, 5.4, 1.8, 2.6, 0.7, FR).b(2.0, 2.6, 5.35, 2.0, 0.3, 0.8, BR);
  for (const x of [2.25, 3.75]) k.c(x, 0, 6.05, 0.22, 2.6, 0.22, "#E9DDBF");
  return k.done();
}

/** Mermer zafer kemeri (1827; üç açıklık, sütunlar, attik). 4 × 2. */
export function triumphalArch(): Box[] {
  const k = new Kit(4, 2), M = "#EEEDE8", M2 = "#D7D5CE";
  k.b(0, 0, 0.3, 4, 0.3, 1.4, M2);
  for (const [x, w] of [[0, 0.6], [1.1, 0.5], [2.4, 0.5], [3.4, 0.6]]) k.b(x, 0.3, 0.4, w, 3, 1.2, M);
  k.b(0.6, 2.1, 0.4, 0.5, 1.2, 1.2, M).b(2.9, 2.1, 0.4, 0.5, 1.2, 1.2, M).b(1.6, 2.7, 0.4, 0.8, 0.6, 1.2, M);
  for (const x of [0.3, 1.35, 2.65, 3.7]) k.c(x, 0.3, 1.66, 0.18, 2.9, 0.14, M2);
  k.b(-0.05, 3.3, 0.35, 4.1, 0.18, 1.3, M2).b(0.2, 3.48, 0.45, 3.6, 0.6, 1.1, M);
  return k.done();
}
