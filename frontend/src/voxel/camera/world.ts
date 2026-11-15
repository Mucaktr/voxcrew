/**
 * CAMERA — kamera çarpışmasının dünya kaynağı (`BoxSource`): yürüme dünyasının gerçek blokları. React/three yok.
 *
 *  - Sahne (ofis, şehir sahneleri, büyümüş dünya): `built.blocks`.
 *  - Şehir haritası (`gateMapOf(built)`): varış meydanı blokları + kameranın çevresindeki semt parsellerinin yakın blokları
 *    (`districtParcel`, akışla aynı önbellek; çizilen yakın halkayla aynı bloklar). Örtü ızgarası (`coverGrid`) şehirde yalnız
 *    meydanı tanıdığı için eski çarpışma sokakta hiç çalışmıyordu (kamera binaların içine giriyordu).
 *  - Kutular 2 × 2 birimlik hücrelere kovalanır (blok dizisi başına bir kez, WeakMap); çok büyük kutular (zemin/su plakası)
 *    ayrı listede. Sorgu kare başına dizi üretmez (`out`a ekler; aynı kutu iki kez eklenebilir — süpürme için zararsız).
 */
import type { Built } from "../scenes";
import { gateMapOf } from "../citymap/shell";
import { parcelDistrict } from "../citymap/source";
import { districtCacheGen, districtParcel } from "../citymap/district";
import { hiresMapItems } from "../hires/items";
import { withoutManaged } from "../hires/registry";
import { HIRES_ENABLED } from "../hires/types";
import { CITY_PD, CITY_PW } from "../citymap/format";
import type { Box, BoxSource } from "./collide";

const CELL = 2;
interface Index { cells: Map<number, Box[]>; big: Box[] }
const indexes = new WeakMap<readonly Box[], Index>();
const ckey = (x: number, z: number) => (x + 8192) * 16384 + (z + 8192);

/** Blok dizisinin hücre dizini (bir kez). */
export function boxIndex(blocks: readonly Box[]): Index {
  let ix = indexes.get(blocks);
  if (ix) return ix;
  ix = { cells: new Map(), big: [] };
  for (const b of blocks) {
    if (b.g === "cloud" || b.g === "snow" || b.g === "water") continue;
    const x0 = Math.floor((b.p[0] - b.s[0] / 2) / CELL), x1 = Math.floor((b.p[0] + b.s[0] / 2) / CELL);
    const z0 = Math.floor((b.p[2] - b.s[2] / 2) / CELL), z1 = Math.floor((b.p[2] + b.s[2] / 2) / CELL);
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > 64) { ix.big.push(b); continue; }
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const k = ckey(x, z), l = ix.cells.get(k);
      if (l) l.push(b); else ix.cells.set(k, [b]);
    }
  }
  indexes.set(blocks, ix);
  return ix;
}

/** Dizinden dikdörtgen sorgusu (`out`a ekler). */
export function queryIndex(ix: Index, x0: number, z0: number, x1: number, z1: number, out: Box[]): void {
  for (const b of ix.big) out.push(b);
  const X0 = Math.floor(x0 / CELL), X1 = Math.floor(x1 / CELL), Z0 = Math.floor(z0 / CELL), Z1 = Math.floor(z1 / CELL);
  for (let x = X0; x <= X1; x++) for (let z = Z0; z <= Z1; z++) {
    const l = ix.cells.get(ckey(x, z));
    if (l) for (const b of l) out.push(b);
  }
}

/** Tek blok dizisinin kaynağı (test ve sahne). */
export function blockSource(blocks: readonly Box[]): BoxSource {
  const ix = boxIndex(blocks);
  return (x0, z0, x1, z1, out) => queryIndex(ix, x0, z0, x1, z1, out);
}

/** Parselin ÇİZİLEN blokları (hires yönetimli orta model yer tutucuları hariç; `?hires=0`'da hepsi) — önbellekli (dizin dizi başına). */
const drawn = new WeakMap<object, readonly Box[]>();
const drawnBlocks = (p: { near: { blocks: readonly Box[] } }): readonly Box[] => {
  let d = drawn.get(p);
  if (!d) { d = withoutManaged(p.near.blocks as never); drawn.set(p, d); }
  return d;
};

const sources = new WeakMap<object, BoxSource>();
/** Yürüme dünyasının kamera kaynağı (dünya başına bir kez; şehirde parseller sorgu anında, önbellekli). */
export function cameraSource(built: Pick<Built, "blocks">): BoxSource {
  let s = sources.get(built);
  if (s) return s;
  const base = boxIndex(built.blocks);
  const map = gateMapOf(built);
  if (!map) s = (x0, z0, x1, z1, out) => queryIndex(base, x0, z0, x1, z1, out);
  else {
    // parsel halkasının dizinleri aralık (C0, R0, C1, R1) başına önbellekli — kamera aynı karo/aralıkta kaldıkça her sorguda
    // parsel semti taraması, plan/parsel dize anahtarları ve WeakMap aramaları tekrarlanmaz. Semt planı önbelleği boşalınca/çıkarınca (kuşak) yeniden kurulur.
    const rings = new Map<number, Index[]>();
    let gen = -1;
    const ringOf = (C0: number, R0: number, C1: number, R1: number): Index[] => {
      const g = districtCacheGen();
      if (g !== gen) { rings.clear(); gen = g; }
      const k = ((C0 + 512) * 1024 + (R0 + 512)) * 4096 + (C1 - C0) * 64 + (R1 - R0); // aralık en çok 63 parsel (sorgu kutuları birkaç birim)
      let ring = rings.get(k);
      if (ring) return ring;
      ring = [];
      for (let cz = R0; cz <= R1; cz++) for (let cx = C0; cx <= C1; cx++) {
        const d = parcelDistrict(map, cx, cz);
        const p = d ? districtParcel(map, d, cx, cz) : null;
        if (p) ring.push(boxIndex(drawnBlocks(p)));
      }
      if (rings.size >= 256) rings.clear();
      rings.set(k, ring);
      return ring;
    };
    s = (x0, z0, x1, z1, out) => {
      queryIndex(base, x0, z0, x1, z1, out);
      // şehir karosu I = floor(x + 12) (transit/model.ts cityX = I − 11,5); parsel = 12 × 16 karo
      // bina bloğu merkezinin düştüğü (ya da komşuya taşınan, district.ts `facadeAlloc`) parselde durur; geniş duvar/kaya komşu parsele taşar —
      // yalnız kutunun parselini sormak kamerayı <city>'da kaya duvarın içine sokuyordu. Bir parsel çevre halkası da sorulur.
      const C0 = Math.floor(Math.floor(x0 + 12) / CITY_PW) - 1, C1 = Math.floor(Math.floor(x1 + 12) / CITY_PW) + 1;
      const R0 = Math.floor(Math.floor(z0 + 8) / CITY_PD) - 1, R1 = Math.floor(Math.floor(z1 + 8) / CITY_PD) + 1;
      if (C1 - C0 < 64 && R1 - R0 < 64) for (const ix of ringOf(C0, R0, C1, R1)) queryIndex(ix, x0, z0, x1, z1, out);
      else for (let cz = R0; cz <= R1; cz++) for (let cx = C0; cx <= C1; cx++) { // çok geniş sorgu (önbelleğe alınmaz)
        const d = parcelDistrict(map, cx, cz);
        const p = d ? districtParcel(map, d, cx, cz) : null;
        if (p) queryIndex(boxIndex(drawnBlocks(p)), x0, z0, x1, z1, out);
      }
      // INTEGQ (RIDE-CAM-001 <city>/teleferik portre): HiResLayer'ın çizdiği yüksek ayrıntılı simge blokları (orta model yalnız yer tutucu) kamerayı da durdurur —
      // eskiden kamera çizili hires yamaç/istasyon geometrisinin içine giriyordu, kapı (`cityWorld`) ise onu sayıyordu. Yalnız sorgu kutusuna (simge bölgesi + 14 birim pay; hires bloklar bölgenin dışına taşar) değen simgenin hi'si (tembel).
      if (HIRES_ENABLED) for (const it of hiresMapItems(map)) {
        let hit = false;
        for (const z of it.zone) if (x1 >= z[0] - 14 && x0 <= z[2] + 14 && z1 >= z[1] - 14 && z0 <= z[3] + 14) { hit = true; break; } // kapanışsız
        if (hit) queryIndex(boxIndex(it.hi()), x0, z0, x1, z1, out);
      }
    };
  }
  sources.set(built, s);
  return s;
}
