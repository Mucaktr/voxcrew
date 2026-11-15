// UXF-A — Kariyer "Son kazanımlar" satır metni (CareerView). Saf; AlbumView ile aynı ad çözücüleri (aynı parça).
import type { FeedEntry } from "../../lib/game";
import { tx } from "../../lib/i18n";
import { explore as XM } from "../../locales/explore";
import { walk as WM } from "../../locales/walk";
import { parseExploreId } from "../../voxel/interiors/catalog";
import { siteName } from "../world/walk/explore/actions";
import { landmarkLabel, sceneLabel, souvenirLabel } from "../world/walk/progress/actions";
import { parseSouvenirId } from "../world/walk/progress/logic";

type FeedKey = "feed_visa" | "feed_explore" | "feed_explore_quest" | "feed_souvenir" | "feed_album" | "feed_fish" | "plus_coins";

/**
 * UXF-A: yürüme kazanımları sunucuda ham kimlikle yazılır ("Vize: istanbul:sultanahmet", "Hatıra bulundu: istanbul:h4");
 * `data` alanından (landmark / item / album / fish) okunur ad çözülür ve dile göre yazılır. Çözülemezse sunucu metni kalır.
*/
export function feedText(f: Pick<FeedEntry, "kind" | "text" | "amount" | "data">, t: (k: FeedKey, v?: Record<string, string | number>) => string): string {
  const d = f.data ?? {};
  if (f.kind !== "walk") return f.text;
  const coins = typeof f.amount === "number" && f.amount > 0 ? t("plus_coins", { n: f.amount }) : "";
  // UXF-E: keşif kimliği ("istanbul:poi:1") → "Keşif: Bilgi noktası · İstanbul"; keşif görevi ("istanbul:q:vp") aynı biçimde
  if (typeof d.explore === "string") {
    const p = parseExploreId(d.explore);
    if (p) {
      const kind = tx(XM, `log_kind_${p.kind}` as "log_kind_in");
      return t("feed_explore", { what: p.site ? `${kind}: ${siteName(p.scene, p.site)}` : kind, scene: sceneLabel(p.scene) }) + coins;
    }
  }
  if (typeof d.explore_quest === "string") {
    const m = /^([a-z0-9_]+):q:(in|vp|k|poi|gz)$/.exec(d.explore_quest);
    if (m) return t("feed_explore_quest", { what: tx(XM, `log_kind_${m[2]}` as "log_kind_in"), scene: sceneLabel(m[1]) }) + coins;
  }
  if (typeof d.landmark === "string") return t("feed_visa", { name: landmarkLabel(d.landmark) });
  if (typeof d.item === "string") {
    const p = parseSouvenirId(d.item);
    if (p) return t("feed_souvenir", { name: souvenirLabel(p.n), scene: sceneLabel(p.scene) }) + coins;
  }
  if (d.album === true && typeof d.world === "string") return t("feed_album", { scene: sceneLabel(d.world) });
  if (typeof d.fish === "string") {
    const key = `mg_fish_${d.fish}`;
    const name = key in WM.tr ? tx(WM, key as "mg_fish_hamsi") : d.fish;
    return t("feed_fish", { name }) + coins;
  }
  return f.text;
}
