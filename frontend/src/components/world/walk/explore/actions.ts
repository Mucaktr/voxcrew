/**
 * WALK-EXPLORE — keşif eylemleri ve adları: kapıdan girme, merdiven, çıkış, seyir noktası, keşif parçası, POI notu, gizli köşe.
 * Tetikleyiciler: avatar karosu değişince (`InteriorRig` → `onExteriorTile` / `onInteriorTile`) ve F / Yakındakiler
 * (`exploreInteract`). Hiçbiri yalnız yakınlıkla panel açmaz; POI notu yalnızca POI'nin yanına gelince küçük bir kart olarak açılır
 * ve uzaklaşınca kapanır. Kutsal (sessiz) iç mekânda toplanabilir yoktur (generate.ts), burada da ödül tetiklenmez.
 */
import { create } from "zustand";
import { tx } from "../../../../lib/i18n";
import { explore as XM } from "../../../../locales/explore";
import { walk as WM } from "../../../../locales/walk";
import { enterId, hiddenId, HOTEL_SITE, poiId, sceneExplore, vpId } from "../../../../voxel/interiors/catalog";
import { cityRuntime, isCitySite } from "../../../../voxel/citymap/runtime";
import { city as CM } from "../../../../locales/city";
import { doorIntended, goCityGate, isCityDoorId, isCityGateId } from "../../../../voxel/citymap/doorEntity";
import { openCityStop, parseCityStopId } from "../../../../voxel/citymap/stopEntity";
import { goCityLm, parseCityLmId } from "../../../../voxel/citylife/lmDoors";
import { lookThroughCityVp, parseCityVpId } from "../../../../voxel/citymap/vpEntity";
import { goWorkZoneDoor, isWorkZoneDoorId, workZoneDoorName } from "../../../../voxel/workzones/doors";
import { citylife as LFM } from "../../../../locales/citylife";
import { landmarkName, stopName } from "../../../../voxel/citymap/store";
import { cityDoor } from "../../../../voxel/citymap/store";
import { exploreEntity } from "../../../../voxel/interiors/entities";
import type { InteriorLevel } from "../../../../voxel/interiors/generate";
import { scenePlaces, shift } from "../../../../voxel/interiors/placement";
import { enterSite, fadeBusy, interiorRuntime, leaveInterior, rideLift, useInterior } from "../../../../voxel/interiors/store";
import { liftNeedsPicker, openLiftPicker } from "../../../../voxel/interiors/liftPick"; // LIFTFLOOR
import type { Tile } from "../../../../voxel/scenes";
import { useWalkStore, walkRuntime } from "../../../../voxel/walk/walkStore";
// NONCITY-QA: dürbün (seyir noktası) F ile manzara kipini açar/kapatır — dürbünün baktığı yere kadraj (interiors/lookout.ts)
import { landmarkView, startLandmarkView, stopLandmarkView } from "../../../../voxel/walk/landmarkView";
import { lookoutAim, lookoutTarget, vpEye } from "../../../../voxel/interiors/lookout";
import { gazeAngles, startViewTurn } from "../../../../voxel/walk/viewTurn";
import { announceWalk } from "../announce";
import { sceneLabel } from "../progress/actions";
import { discoverExplore, isFound } from "./exploreStore";

// ------------------------------------------------------------------ adlar
/** Yerin adı: simgeyse `locales/walk.ts` simge adı, değilse keşif yer adı. */
export function siteName(scene: string, site: string): string {
  // şehir haritası landmarkı (yer kimliği `city_…`)
  const city = isCitySite(site) ? cityRuntime.siteLabel?.(site) : null;
  if (city) return city;
  const lmKey = `lm_${scene}_${site}`;
  const lm = tx(WM, lmKey as "lm_found_title");
  if (lm !== lmKey) return lm;
  if (site === HOTEL_SITE) return tx(XM, sceneExplore(scene)?.poi ? "site_otel" : "site_lodge"); // HOTEL-SYS
  const k = `site_${site}`;
  const v = tx(XM, k as "site_teras");
  return v === k ? tx(XM, "site_unknown") : v; // CORE-WALK: ham kimlik değil, genel ad
}
/** Ham anahtar ekranda görünmez: çevirisi yoksa genel ad. */
/** `index` (0 tabanlı kat): çevirisi olmayan kat "Oda" yerine "{n}. kat" olur (aynı adlı satırlar ayırt edilsin). */
export const roomName = (key: string, index?: number) => {
  const v = tx(XM, key as "room_lobby");
  return v !== key ? v : index === undefined ? tx(XM, "room_unknown") : tx(XM, "floor_n", { n: index + 1 });
};
/** çevirisi olan oda adı mı (çevirisiz odada çip katın adında kalır, "Oda" yazmaz).*/
export const hasRoomName = (key: string) => tx(XM, key as "room_lobby") !== key;
export const kesifName = (model: string | undefined) => tx(XM, `kesif_${model ?? "map"}` as "kesif_map");
function poiNear(scene: string, n: number): string {
  const p = scenePlaces(scene).pois.find((x) => x.id === n);
  return p && p.near !== "spawn" ? siteName(scene, p.near) : sceneLabel(scene);
}
export const poiText = (scene: string, n: number) => tx(XM, `poi_${scene}_${n}` as "poi_istanbul_1");

/** Yakındakiler adı (WorldPage `walkName`); keşif öğesi değilse null. */
export function exploreName(id: string): string | null {
  // UXF-B: ofis tabanındaki "Şehre çık" kapısı
  if (isCityDoorId(id)) return tx(CM, "door_name");
  // CORE-WALK: şehir haritasındaki geri dönüş geçidi
  if (isCityGateId(id)) return tx(CM, "gate_name");
  // UXF-E: ulaşım durağı
  const cs = parseCityStopId(id);
  if (cs) return tx(CM, "stop_near", { stop: stopName(cs[0], cs[1]) });
  // CITYLIFE (B1): şehir haritasındaki iç mekânlı landmark kapısı
  const lmd = parseCityLmId(id);
  if (lmd) return tx(LFM, "lm_door", { name: landmarkName(lmd.city, lmd.lm) });
  if (parseCityVpId(id)) return tx(XM, "vp_name");
  // WORK-ZONES: şehir ofis binası kapısı ("<ofis> · giriş")
  const wzn = workZoneDoorName(id);
  if (wzn) return wzn;
  const e = exploreEntity(id);
  const scene = useWalkStore.getState().world ?? "";
  if (!e) return null;
  switch (e.type) {
    case "door": return tx(XM, "door_name", { name: siteName(scene, e.site) });
    case "poi": return `${tx(XM, "poi_name")}: ${poiNear(scene, e.n)}`;
    case "portal": return tx(XM, "portal_exit");
    case "stair": return tx(XM, e.dir === "up" ? "portal_up" : "portal_down");
    case "lift": { // kat seçimi — her durak hedef katın adıyla
      const to = useInterior.getState().plan?.levels[e.to];
      return to ? tx(XM, "lift_to", { room: roomName(to.name, e.to) }) : tx(XM, "lift_name");
    }
    case "vp": return tx(XM, "vp_name");
    case "kesif": return kesifName(e.model);
  }
}

// ------------------------------------------------------------------ POI notu (küçük kart; F ya da yanına gelince)
export interface ExploreNote { title: string; text: string; x: number; z: number }
export const useExploreNote = create<{ note: ExploreNote | null }>(() => ({ note: null }));
export const closeExploreNote = () => useExploreNote.setState({ note: null });

/** not yalnız uzaklaşınca kapanıyordu — kuş bakışında/yerinde durunca ~1 dk ekranda kaldı. Bu süre sonra kendiliğinden kapanır
 * ve aynı nokta, avatar 3 karodan fazla uzaklaşıp dönmeden yeniden açılmaz.*/
export const NOTE_TTL_MS = 12_000;
let noteTimer: ReturnType<typeof setTimeout> | undefined;
let quietPoi: Tile | null = null;
function openPoi(scene: string, n: number, tile: Tile) {
  const title = `${tx(XM, "poi_name")}: ${poiNear(scene, n)}`;
  const text = poiText(scene, n);
  const note = { title, text, x: tile[0], z: tile[1] };
  useExploreNote.setState({ note });
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { if (useExploreNote.getState().note === note) { quietPoi = tile; closeExploreNote(); } }, NOTE_TTL_MS);
  discoverExplore(scene, poiId(scene, n), null);
}

// ------------------------------------------------------------------ eylemler
function currentLevel(): InteriorLevel | null { return useInterior.getState().view?.level ?? null; }

function takePortal(lv: InteriorLevel, pid: string): boolean {
  const p = lv.portals.find((x) => x.id === pid);
  if (!p) return false;
  return leaveInterior(false);
}

/** INTERIOR-VIEW: merdiven (F / Yakındakiler) — ışınlama yok: avatar tıkla-git ile merdivenin tepesine (ya da boşluğun ağzına)
 *  yürür; basamakları fiziksel çıkar/iner, kat tetik karosunda değişir (InteriorRig). */
function takeStair(lv: InteriorLevel, id: string): boolean {
  const st = lv.stairs.find((x) => x.id === id);
  if (!st) return false;
  useWalkStore.getState().setTarget(st.tile);
  return true;
}

/** (ürün sahibi 2026-10-31 "asansöre binilmiyor"): F asansör kapısının önünde → kapanma kararması, hedef kattaki kapının önüne
 * varış (kapıya sırtı dönük); uzaktaysa önce kapının önüne yürür (tıkla-git), sonra F ile biner.*/
function takeLift(lv: InteriorLevel, id: string, direct = false): boolean {
  const l = lv.lifts.find((x) => x.id === id);
  if (!l) return false;
  const pose = useWalkStore.getState().pose;
  if (pose && Math.max(Math.abs(pose.tile[0] - l.tile[0]), Math.abs(pose.tile[1] - l.tile[1])) > 1) { useWalkStore.getState().setTarget(l.tile); return true; }
  if (!direct && liftNeedsPicker(lv, l)) { openLiftPicker(lv.key, l); return true; } // LIFTFLOOR: çok katlı kapı → kat seçici
  if (!rideLift(l)) return false;
  // duyuru tek: kat değişince InteriorRig `level_ann` okur (eskiden burada ikinci bir lift_ann vardı)
  return true;
}

/** LIFTFLOOR: kat seçicide hedef seçildi — seçici açmadan biner (aynı geçiş ve duyuru). */
export function takeLiftDirect(id: string): boolean { const lv = currentLevel(); return !!lv && takeLift(lv, id, true); }

function hitVp(lv: InteriorLevel) {
  if (lv.spots.some((s) => s.kind === "vp" && s.free)) return; // HORIZON: şehir haritası iç mekânı — dürbün kayıt yazmaz
  if (!isFound(enterId(lv.scene, lv.site))) recordEnter(lv.scene, lv.site);
  const id = vpId(lv.scene, lv.site);
  discoverExplore(lv.scene, id, { kind: "visa", title: tx(XM, "found_vp", { site: siteName(lv.scene, lv.site) }), text: tx(XM, "found_vp_text") });
}
/** NONCITY-QA (ürün sahibi 2026-10-29 "dürbün hiçbir şey yapmıyor"): F dürbünde → manzara kipi dürbünün baktığı yere (çevre, ufuk
 * silüeti); kip açıksa F kapatır. Hedef yoksa (boşluk) duyuru. Keşif kaydı (`hitVp`) ayrıca ilk kez düşer.*/
export function lookThroughVp(lv: InteriorLevel): boolean {
  if (landmarkView.active || landmarkView.request) { stopLandmarkView(); return true; }
  const spot = lv.spots.find((s) => s.kind === "vp");
  const view = useInterior.getState().view;
  const t = spot && view && view.level === lv ? lookoutTarget(lv, spot.tile, view.built.blocks, view.def.ocean?.y ?? null) : null;
  if (t && startLandmarkView(t)) return true;
  announceWalk(tx(XM, "vp_none"));
  return false;
}
/** (karar 2026-10-31): dürbün/seyir karosuna gelince karakter dürbünün baktığı hedefe (`lookoutAim.center`, F ile
 * açılan manzara kipiyle AYNI) yumuşak döner; kamera kadrajlar (WalkRig `viewTurn`). Hedef yoksa dönmez.*/
export function aimAtVp(lv: InteriorLevel, tile: Tile): boolean {
  const view = useInterior.getState().view;
  const a = view && view.level === lv ? lookoutAim(lv, tile, view.built.blocks, view.def.ocean?.y ?? null) : null;
  if (!a) return false;
  const eye = vpEye(tile), g = gazeAngles({ x: eye[0], y: eye[1], z: eye[2] }, { x: a.center[0], y: a.center[1], z: a.center[2] });
  startViewTurn(g.yaw, g.pitch, `${lv.site}:${tile[0]},${tile[1]}`);
  return true;
}
function hitKesif(lv: InteriorLevel, id: string) {
  const s = lv.spots.find((x) => x.id === id);
  if (!s || lv.quiet) return;
  if (!isFound(enterId(lv.scene, lv.site))) recordEnter(lv.scene, lv.site);
  discoverExplore(lv.scene, id, { kind: "souvenir", title: tx(XM, "found_k", { name: kesifName(s.model) }) });
}

/** F / Enter / Yakındakiler: keşif öğesiyse işler ve true döner. */
export function exploreInteract(id: string): boolean {
  // REVFIX1: kararma sürerken F / Yakındakiler hiçbir geçişi başlatmaz (durak paneli, kapı, portal, asansör) — tutulur, sonra yeniden basılır
  if (fadeBusy()) return true;
  // UXF-B: kapının yanında F / Yakındakiler → şehir haritası (uzaktaysa Yakındakiler önce oraya yürütür)
  if (isCityDoorId(id)) { cityDoor.go?.(); return true; }
  if (isCityGateId(id)) { if (goCityGate()) announceWalk(tx(CM, "gate_go_ann")); return true; }
  // UXF-E: durak — yanındaysa biniş paneli, uzaktaysa durağa yürü
  if (parseCityStopId(id)) return openCityStop(id);
  // CITYLIFE (B1): landmark kapısı — avatar kapıya yürür, karoya basınca iç mekâna geçilir (CityRig)
  if (parseCityLmId(id)) { goCityLm(id); return true; }
  // şehir seyir karosu — F dürbün (manzara kipi), olta değil
  if (parseCityVpId(id)) return lookThroughCityVp(id, () => announceWalk(tx(XM, "vp_none")));
  // WORK-ZONES: ofis kapısı — avatar kapıdan salona yürür (cam çatı kesitle açılır)
  if (isWorkZoneDoorId(id)) { goWorkZoneDoor(id); return true; }
  const e = exploreEntity(id);
  if (!e) return false;
  const scene = useWalkStore.getState().world;
  if (!scene) return true;
  const lv = currentLevel();
  switch (e.type) {
    case "door": enterSite(scene, e.site); return true;
    case "poi": {
      const p = scenePlaces(scene).pois.find((x) => x.id === e.n);
      if (p) openPoi(scene, e.n, shift(p.tile, walkRuntime.baseOffset));
      return true;
    }
    case "portal": if (lv) takePortal(lv, e.id); return true;
    case "stair": if (lv) takeStair(lv, e.id); return true;
    case "lift": if (lv) takeLift(lv, e.id); return true;
    case "vp": if (lv) { hitVp(lv); lookThroughVp(lv); } return true; // NONCITY-QA: kayıt + dürbün görüşü
    case "kesif": if (lv) hitKesif(lv, e.id); return true;
  }
}

const cheb = (a: Tile, b: Tile) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
const hinted = new Set<string>();

/** Dış dünyada avatar karosu değişti: kapı (girer), POI (not + kayıt), gizli köşe (kayıt; 2 karo yakında ipucu). */
export function onExteriorTile(scene: string, tile: Tile) {
  if (!sceneExplore(scene)) return;
  const off = walkRuntime.baseOffset;
  const pl = scenePlaces(scene);
  for (const d of pl.doors) {
    if (!d.open) continue;
    const t = shift(d.tile, off);
    // HQA-FIX: başka bir hedefe giden rota kapı karosundan yalnız geçiyorsa girilmez (rota zaten kaçınır; tek geçitte susar)
    if (t[0] === tile[0] && t[1] === tile[1]) { if (doorIntended(t, walkRuntime.avatar.route)) enterSite(scene, d.site); return; }
  }
  const note = useExploreNote.getState().note;
  if (note && cheb([note.x, note.z], tile) > 3) closeExploreNote();
  if (quietPoi && cheb(quietPoi, tile) > 3) quietPoi = null;
  for (const p of pl.pois) {
    const t = shift(p.tile, off);
    if (quietPoi && quietPoi[0] === t[0] && quietPoi[1] === t[1]) continue;
    if (cheb(t, tile) <= 1 && (!note || note.x !== t[0] || note.z !== t[1])) { openPoi(scene, p.id, t); break; }
  }
  pl.hidden.forEach((h, k) => {
    const t = shift(h, off);
    const id = hiddenId(scene, k + 1);
    if (isFound(id)) return;
    if (t[0] === tile[0] && t[1] === tile[1]) {
      discoverExplore(scene, id, { kind: "souvenir", title: tx(XM, "found_gz"), text: tx(XM, "found_gz_text", { scene: sceneLabel(scene) }) });
    } else if (cheb(t, tile) <= 2 && !hinted.has(id)) {
      hinted.add(id);
      announceWalk(tx(XM, "gz_hint"));
      useExploreNote.setState({ note: { title: tx(XM, "gz_hint"), text: "", x: t[0], z: t[1] } });
    }
  });
}

/** İç katta avatar karosu değişti: portal (kat/çıkış), seyir noktası (karo ya da 4-komşu), keşif parçası (karo). */
export function onInteriorTile(lv: InteriorLevel, tile: Tile) {
  for (const p of lv.portals) if (p.tile[0] === tile[0] && p.tile[1] === tile[1]) { if (doorIntended(p.tile, walkRuntime.avatar.route)) takePortal(lv, p.id); return; } // HQA-FIX
  if (lv.quiet) return;
  for (const s of lv.spots) {
    const d = Math.abs(s.tile[0] - tile[0]) + Math.abs(s.tile[1] - tile[1]);
    if (s.kind === "vp" && d <= 1) { hitVp(lv); if (d === 0) aimAtVp(lv, s.tile); } // karoya basınca hedefe dön
    else if (s.kind === "k" && d === 0) hitKesif(lv, s.id);
  }
}

/** Girişte iç mekânı keşif olarak kaydeder (ilk kez: tost). */
export function recordEnter(scene: string, site: string) {
  if (site === HOTEL_SITE) return; // HOTEL-SYS: otel lobisi keşif kaydı değil (her şehirde aynı geçit; katalogda yok)
  discoverExplore(scene, enterId(scene, site), { kind: "visa", title: tx(XM, "found_in", { site: siteName(scene, site) }) });
}

/** "Ofise dön" içeriden: çık ve doğma noktasına. */
export const leaveToHome = () => leaveInterior(true);
export const leaveToDoor = () => leaveInterior(false);
export const isInside = () => interiorRuntime.inside;
