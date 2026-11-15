/**
 * CITY-PACKS — şehir haritası katmanı: etkin paketlerin öğeleri, şehir tasarım katmanına (citymap/design.ts) **ek süs blokları**
 * ve **katı süs karoları** olarak eklenir. `citymap/designs.ts designOf` bu işlevden geçer; paket etkin değilse tasarım birebir
 * aynı nesnedir (ücretsiz şehir hiç değişmez).
 *
 *  - Çizim: bloklar konumlarına göre parsel yakın bütçesine dağılır (district.ts) → **+0 çizim çağrısı**; yalnız durağan gruplar
 *    (`solid/water/glass/glow`). Başka grup taşıyan öğe şehre girmez (canlı malzemeler yalnız dünya yapıcıda).
 *  - Çarpışma: `solid` öğelerin ayak izi tasarımın `solid` dikdörtgenidir (T_WALL; avatar içinden geçmez).
 *  - Ücretli öğe keşif damgası, görev ya da landmark kaydı ÜRETMEZ (katalog bloğuna girmez; pay-to-progress yok).
 *  - Etkin küme `setActiveCityPacks` ile değişir; çağıran semt önbelleğini boşaltır (lib/citypacks.ts). Değişiklik bir sonraki
 *    şehre girişte görünür.
 *  - Denetim kancası: `globalThis.__voxcrewCityPacksAll === true` bütün paketleri etkin sayar (yalnız node denetimi,
 *    frontend/scripts/citypacks.test.mjs; arayüz bu alanı yazmaz).
 *
 * Saf modül: React/three yok.
 */
import type { Block, Group } from "../scenes";
import type { CityDesign, CityRect, DecorCtx, DistrictDesign } from "../citymap/design";
import { CITY_ANCHORS, type CityAnchor } from "./anchors";
import { ITEM_BY_KEY } from "./catalog";
import { rotateBoxes } from "./kit";

export const CITY_STATIC_GROUPS: ReadonlySet<Group> = new Set<Group>(["solid", "water", "glass", "glow"]);

export const cityPackRuntime: { active: ReadonlySet<string>; version: number } = { active: new Set(), version: 0 };

/** etkin paket kümesi değişince (`version`) kendiliğinden boşalan önbellek (harita başına önbellekler paketsiz planda kalmasın).*/
export function packCache<T extends object>(make: () => T): () => T {
  let v = -1, c: T;
  return () => { if (v !== cityPackRuntime.version) { v = cityPackRuntime.version; c = make(); } return c; };
}

/** Etkin paketleri ayarlar; küme değiştiyse true (çağıran `clearDistrictCache()` çağırır). */
export function setActiveCityPacks(ids: Iterable<string>): boolean {
  const next = new Set(ids);
  const cur = cityPackRuntime.active;
  if (next.size === cur.size && [...next].every((x) => cur.has(x))) return false;
  cityPackRuntime.active = next;
  cityPackRuntime.version++;
  return true;
}

const allForCheck = () => (globalThis as { __voxcrewCityPacksAll?: unknown }).__voxcrewCityPacksAll === true;
const isActive = (pack: string) => allForCheck() || cityPackRuntime.active.has(pack);

/** Şehre çizilebilir mi: yalnız durağan gruplar. */
export function cityDrawable(key: string): boolean {
  const it = ITEM_BY_KEY.get(key);
  return !!it && it.boxes().every((b) => CITY_STATIC_GROUPS.has(b[7]));
}

/** Bir çapanın semt yerel süs blokları (dünya koordinatı) ve katı dikdörtgeni. */
export function anchorBlocks(a: CityAnchor, c: DecorCtx): { blocks: Block[]; rect: CityRect | null } {
  const it = ITEM_BY_KEY.get(`${a.pack}-${a.item}`);
  if (!it || !cityDrawable(it.key)) return { blocks: [], rect: null };
  const { boxes, w, d } = rotateBoxes(it.boxes(), it.w, it.d, a.rot ?? 0);
  const [li, lj] = a.at;
  const blocks = boxes.map(([dx, y, dz, bw, bh, bd, col, g]): Block => ({
    p: [c.ox + li + 0.5 + dx, y, c.oz + lj + 0.5 + dz], s: [bw, bh, bd], c: col, g, j: 0.03,
  }));
  return { blocks, rect: it.solid ? [li, lj, w, d] : null };
}

/** Haritanın etkin çapaları (semt → çapa listesi). */
function activeAnchors(mapId: string): Map<string, CityAnchor[]> {
  const out = new Map<string, CityAnchor[]>();
  for (const a of CITY_ANCHORS) {
    if (a.map !== mapId || !isActive(a.pack)) continue;
    (out.get(a.district) ?? out.set(a.district, []).get(a.district)!).push(a);
  }
  return out;
}

const memo = new Map<string, { key: string; out: CityDesign | null }>();

/** Tasarım + etkin paket katmanı. Etkin çapa yoksa `base` aynen döner. */
export function cityPackDesign(mapId: string, base: CityDesign | null): CityDesign | null {
  const anchors = activeAnchors(mapId);
  if (!anchors.size) return base;
  const key = `${allForCheck() ? "all" : cityPackRuntime.version}`;
  const hit = memo.get(mapId);
  if (hit && hit.key === key) return hit.out;
  const districts: Record<string, DistrictDesign> = { ...(base?.districts ?? {}) };
  for (const [did, list] of anchors) {
    const dd = districts[did] ?? {};
    const rects: CityRect[] = [];
    for (const a of list) {
      const r = anchorBlocks(a, { ox: 0, oz: 0 }).rect;
      if (r) rects.push(r);
    }
    const baseDecor = dd.decor;
    districts[did] = {
      ...dd,
      solid: [...(dd.solid ?? []), ...rects],
      decor: (c: DecorCtx) => [...(baseDecor ? baseDecor(c) : []), ...list.flatMap((a) => anchorBlocks(a, c).blocks)],
    };
  }
  const out: CityDesign = { districts, landmarks: base?.landmarks ?? {}, ...(base ? { moments: base.moments, unlock: base.unlock, quests: base.quests, rides: base.rides } : {}) };
  memo.set(mapId, { key, out });
  return out;
}

/** Paketin şehirde yerleştiği haritalar (mağaza kartı: "İstanbul, Kapadokya … haritalarında"). */
export function packCities(pack: string): string[] {
  return [...new Set(CITY_ANCHORS.filter((a) => a.pack === pack).map((a) => a.map))];
}
