/**
 * WALK-EXPLORE — iç mekân düzeneği (Canvas içinde, WalkRig'den SONRA bağlanır; hiçbir şey çizmez, +0 çizim çağrısı).
 *
 *  - Bekleyen varışı uygular: kat ya da dış dünya değişince (World.tsx `built` değişimi) WalkRig'in taban kayması etkisinden
 *    sonra avatarı varış karosuna koyar (kardeş etkileri sırayla çalışır). "Ofise dön" varışı dış dünyanın doğma karosudur.
 *  - Avatar karosu değişince (seyrek; depo pozu) tetikleyicileri çağırır: dışarıda kapı / POI / gizli köşe, içeride portal /
 *    seyir noktası / keşif parçası (components/world/walk/explore/actions.ts).
 *  - Girişte iç mekân keşif kaydı ve ekran okuyucu duyurusu; sahne değişince iç mekân biter.
 *  - Geliştirme kancası `window.__voxcrewInterior` (yalnız DEV): ekran görüntüsü betikleri için gir/kat/çık/durum.
 *  - INTERIOR-VIEW: merdiven tetikleri (`StairLink`; kararmasız, aynı x/z, y ± kat; kamera `shiftWalkCamera` ile sürer).
 *  - INTERIOR-VIEW: katın sahne kaydından kamera kuralı (`walk/cameraRule.ts`; oda/salon kesiti, salon geniş açı) ve varsayılan
 *    görünüm (güverte birinci şahıs; V değiştirir; dışarı çıkınca girişteki görünüm geri gelir), dış dünyanın gece/gündüz durumu
 *    (pencere ışığı; `setOutsideNight`) ve ses yatağı (`ambience.ts`).
 */
import { useEffect, useRef } from "react";
import { tx as tr } from "../../lib/i18n";
import { explore as XM } from "../../locales/explore";
import { announceWalk } from "../../components/world/walk/announce";
import { onExteriorTile, onInteriorTile, recordEnter, roomName, siteName } from "../../components/world/walk/explore/actions";
import { useSceneNight } from "../props/weather";
import { sceneDef, tx, tz, type Built, type SceneCore, type Tile } from "../scenes";
import { setWalkCameraRule, shiftWalkCamera, STREET_RULE, walkCamera } from "../walk/cameraRule";
import { framedReturn } from "../walk/spawnFrame";
import { withHires } from "../hires/items";
const hiresWorlds = new WeakMap<object, ReturnType<typeof withHires>>(); // FIXPACK-D: sahne dünyası (exterior) → hi-res'li dünya
function hiresWorldOf(scene: string, exb: Parameters<typeof withHires>[1]): ReturnType<typeof withHires> { let h = hiresWorlds.get(exb); if (!h) { h = withHires(scene, exb); hiresWorlds.set(exb, h); } return h; }
import { steadyCam } from "../walk/arrivalCam"; // kareyi WalkRig'in sabit durum kamerasıyla ölç
import { rayOpen, sceneSight } from "../walk/spawnView"; // ARRIVAL-QA
import { entryRoomy, interiorArrival, keepsArrivalAim } from "./arrivalFrame"; // HQA-FIX
import { officeDoor, officeDoorBlocks } from "../citymap/door";
import { cityForScene } from "../citymap/catalog";
import { roomShape } from "../walk/cover";
import type { WalkView } from "../walk/walkStore";
import { useInteriorAmbience } from "./ambience";
import { openSites } from "./catalog";
import { CUT_FLOOR_Y } from "./sceneModel";
import { baseOffset, createAvatar, GATE_CLEAR, navGrid, PORTAL_CLEAR, tileAt, unstick, walkable } from "../walk/controller";
import { inNarrowLane, openness } from "../camera/profiles"; // ferah varış karosu
import { cityRuntime, isCitySite } from "../citymap/runtime";
import { useWalkStore, walkRuntime } from "../walk/walkStore";
import { doorIntended } from "../citymap/doorEntity"; // HQA-FIX
import { spawnPose } from "../walk/WalkRig";
import { doorsInWorld, enterSite, goLevel, interiorRuntime, leaveInterior, resetInterior, setOutsideNight, stairSwap, useInterior } from "./store";

export interface InteriorRigProps {
  scene: string;
  /** şu an çizilen dünya (iç kat ya da dış dünya) */
  built: Built;
  /** dış dünya (doğma karosu ve kapılar için) */
  exterior: Built;
  core: SceneCore | null;
}

/** ARRIVAL-QA: dönüşte kaçınılan karolar — sahne iç mekân kapıları ve "Şehre çık" kapısı (dünya ızgarası; yeniden tetiklenmez). */
function exitAvoid(scene: string, exb: Built, ring = 0): (i: number, j: number) => boolean {
  const keys = new Set(doorsInWorld(scene, baseOffset(exb)).map((d) => `${d.tile[0]},${d.tile[1]}`));
  const gate = officeDoor(exb);
  if (gate) keys.add(`${gate.tile[0]},${gate.tile[1]}`);
  // HQA-FIX: `ring` — "Şehre çık" kapısına bu Chebyshev uzaklıktan yakın karolar da (şehirden dönüş ≥ GATE_CLEAR)
  const g = gate?.tile;
  return (i, j) => keys.has(`${i},${j}`) || (!!g && ring > 0 && Math.max(Math.abs(i - g[0]), Math.abs(j - g[1])) < ring);
}

// kamera–kapı perdesi yoklaması (eskiden avatarın 2,9 birim arkasındaki tahmini nokta) artık gerçek sabit durum kamerasıyla
// `framedReturn` içinde (`spawnFrame.ts camNearAvoid`)

export function InteriorRig({ scene, built, exterior, core }: InteriorRigProps) {
  const arrival = useInterior((s) => s.arrival);
  const view = useInterior((s) => s.view);
  const applied = useRef(0);
  const lastKey = useRef("");
  const lastTile = useRef<Tile | null>(null);
  const ext = useRef({ exterior, core, scene });
  ext.current = { exterior, core, scene };
  // INTERIOR-VIEW: dış dünyanın saati → pencere ışığı (iç kat sahne kaydı yeniden kurulur; aynı kat, kararma yok)
  const outsideNight = useSceneNight(sceneDef(scene));
  useEffect(() => { setOutsideNight(outsideNight); }, [outsideNight]);
  // INTERIOR-VIEW: kat → kamera kuralı ve varsayılan görünüm. Girişteki görünüm saklanır, dışarı çıkınca geri gelir.
  const levelKey = view?.level.key ?? "";
  const rec = view?.record ?? null;
  const entryView = useRef<WalkView | null>(null);
  useEffect(() => {
    const ws = useWalkStore.getState();
    if (!rec) {
      setWalkCameraRule(null);
      if (entryView.current && ws.active && ws.view !== entryView.current) ws.setView(entryView.current);
      entryView.current = null;
      return;
    }
    const c = rec.camera;
    const lv = useInterior.getState().view?.level;
    const room = lv ? roomShape(lv.shell ? { width: lv.built.width, depth: lv.built.depth, blocked: lv.shell } : navGrid(lv.built), lv.portals.map((p) => p.tile)) : null;
    setWalkCameraRule({ key: rec.id, space: c.space, dist: c.dist, fovAdd: c.fovAdd, cutaway: c.cutaway, minY: CUT_FLOOR_Y, room });
    if (entryView.current === null) entryView.current = ws.view;
    if (ws.view !== c.view) ws.setView(c.view);
  }, [levelKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => setWalkCameraRule(null), []);
  useInteriorAmbience(rec?.ambience.sound ?? null);

  // varış: WalkRig'in [built] etkisinden sonra (kardeş sırası) — avatar tam varış karosuna, yol temizlenir
  useEffect(() => {
    const a = arrival;
    if (!a || applied.current === a.token) return;
    applied.current = a.token;
    const av = walkRuntime.avatar;
    // `rel` — taban göreli dış poz (şehirden ofise dönüş: bugünkü taban kayması eklenir)
    const off = baseOffset(ext.current.exterior);
    const p = a.home ? spawnPose(ext.current.exterior, ext.current.core, null) : a.rel ? { x: a.x + off[0], z: a.z + off[1], heading: a.heading } : a;
    if (a.stair) {
      // INTERIOR-VIEW merdiven geçişi: aynı x/z, yeni kat y'si; yol temizlenir, unstick yok (basamak karosu engelli ama durulur)
      Object.assign(av, createAvatar(p.x, p.z, p.heading, a.stair.y));
      shiftWalkCamera(a.stair.dy);
    } else {
      // bütün avatar durumu sıfırlanır (WALK-PHYS dikey durumu dahil: ayak y'si, dikey hız, yerde) — kat zemini y = 0
      Object.assign(av, createAvatar(p.x, p.z, p.heading));
      const fix = unstick(navGrid(built), av);
      av.x = fix.x; av.z = fix.z;
      // HQA-FIX: iç mekâna giriş/kat varışı — avatar odanın içine (arkasında kamera payı, kapı/merdiven karosunda değil)
      // ilerletilir ve kamera bakış yönüne oturur; eskiden kamera şehirdeki yaw'da kalıp kapı duvarına düşüyor, W avatarı dışarı çıkarıyordu
      const lvIn = useInterior.getState().view?.level;
      if (lvIn) {
        const lb = lvIn.built, t0 = tileAt(av.x, av.z);
        const avoid = new Set([...lvIn.portals.map((p) => `${p.tile[0]},${p.tile[1]}`), ...lvIn.stairs.flatMap((s) => s.run.map((t) => `${t[0]},${t[1]}`)),
          // asansörden çıkan avatar çıkış kapısının önüne (bir adımda dışarı) bırakılmaz
          ...(a.lift ? lvIn.portals.map((p) => `${p.arrive[0]},${p.arrive[1]}`) : [])]);
        const lbNav = navGrid(lb), roomy = (t: Tile) => { const o = openness((a, b) => walkable(lbNav, a, b), t[0], t[1]); return !inNarrowLane(o.runX, o.runZ); };
        const pick = lvIn.arrive ?? interiorArrival(sceneSight(lb, t0), /* yazarın varış ipucu (kule: asansör F menzili / seyir manzarası) önceliklidir*/ (t) => t[0] >= 0 && t[1] >= 0 && t[0] < lb.width && t[1] < lb.depth && !lb.blocked.has(`${t[0]},${t[1]}`), avoid, t0, av.heading, entryRoomy(!!a.lift, lvIn.lifts?.length ?? 0) ? roomy : undefined); // ferah karo yalnız asansör varışında (kapıdan girişte avatar girişe yakın kalır: F asansör)
        av.x = tx(pick.tile[0]); av.z = tz(pick.tile[1]);
        walkCamera.aim = pick.heading;
        // arkası BACK_MIN karo açık varış karesi doğrulanmış kare — clearAimYaw kolu sokak boyunda (4,6) ölçüp küçük odada
        // kamerayı yana/öne çeviriyordu (Yerebatan: su üstünden yan, W korkuluğa; Topkapı avlusu: avatarın yüzü). Kol duvarda kısalır, yaw kalır.
        walkCamera.aimExact = keepsArrivalAim(pick as { back?: number }, !!lvIn.arrive);
      }
      // UXF-D: şehirden ofise dönüş — ilk kare açık olsun ( ölçüsü ≤ %15): kapı kemeri dahil ölçülür, avatar ve kamera
      // seçilen yöne bakar; kapının önü dar sahnede avatar en çok 3 karo içeri (aynı bileşen) bırakılır (eskiden kamera şehirdeki yaw'da kalıp kapıya yaslanıyordu)
      if (a.rel && !useInterior.getState().view) {
        const exb = ext.current.exterior, door = officeDoor(exb), map = cityForScene(ext.current.scene);
        // HQA-FIX: kare için kaydırılan dönüş karosu da kapıdan ≥ GATE_CLEAR (İstanbul, Londra, <city>, <city> 2 karoya iniyordu)
        const sight = sceneSight(exb, tileAt(av.x, av.z)), avoid = exitAvoid(ext.current.scene, exb, PORTAL_CLEAR);
        const arch = door ? officeDoorBlocks(door, map?.gate.kind) : [];
        const pick = framedReturn(exb, tileAt(av.x, av.z), p.heading, arch, avoid,
          (t, yaw) => rayOpen(sight, t, Math.round(Math.sin(yaw)), Math.round(Math.cos(yaw))) >= 3, 5, { camAt: steadyCam(exb, arch), strictCenter: true }); // (kamera-kapı yoklaması gerçek kamerayla: framedReturn camNearAvoid)
        av.x = tx(pick.tile[0]); av.z = tz(pick.tile[1]); av.heading = pick.yaw;
        walkCamera.aim = pick.yaw;
      } else if (a.aim !== undefined && !useInterior.getState().view) {
        // ARRIVAL-QA: şehir landmark çıkışı — 3/4 açı, kapının perdesi kameranın arkasında kalmaz. Sokak kuralı bu karede kurulur
        // (yoksa bir sonraki karede CityRig kuralı değiştirir, WalkRig yaw'ı avatarın yönüne çekip bu açıyı ezerdi)
        if (cityRuntime.active) setWalkCameraRule(STREET_RULE);
        walkCamera.aim = a.aim; walkCamera.aimExact = true; // landmark çıkış pozu arrival_check'te doğrulanmış (EXITS tablosu)
      } else if (!a.home && !useInterior.getState().view && !cityRuntime.active) {
        // ARRIVAL-QA: sahne iç mekânından/otelden çıkış da şehirden dönüş gibi kadrajlanır — kapıya sırtı dönük (±90°),
        // en çok 3 karo içinde, kameraya yakın cephe/direk karenin ≤ %15'i; kapı ve tetik karolarına bırakılmaz
        // "Şehre çık" kapısının GATE_CLEAR halkası da kaçınılır (kapıya 1–2 karoda inip ilk F şehre atıyordu)
        const exb = ext.current.exterior, t0 = tileAt(av.x, av.z), avoid = exitAvoid(ext.current.scene, exb, GATE_CLEAR);
        // kare çizilen (hi-res dahil) dünyada ölçülür — arrival_check ile aynı. FIXPACK-D: dünya sahne başına önbellekli (her çıkışta yeniden kurulmaz;
        // sceneSight önbelleği de aynı nesneye bağlı) ve bakış (sight) da bu dünyadan — eskiden ham dünyadan ölçülüyordu (kare/bakış tutarsız)
        const exH = hiresWorldOf(ext.current.scene, exb), sight = sceneSight(exH, t0);
        const pick = framedReturn(exH, t0, p.heading, [], avoid,
          (t, yaw) => rayOpen(sight, t, Math.round(Math.sin(yaw)), Math.round(Math.cos(yaw))) >= 3, 5, { camAt: steadyCam(exH), strictCenter: true });
        av.x = tx(pick.tile[0]); av.z = tz(pick.tile[1]); av.heading = pick.yaw;
        walkCamera.aim = pick.yaw;
      }
    }
    useWalkStore.getState().setTarget(null);
    const lv = useInterior.getState().view?.level;
    if (a.quiet && !lv) { lastKey.current = ""; lastTile.current = null; return; }
    if (lv) {
      const room = roomName(lv.name);
      announceWalk(lv.index === 0 && !lastKey.current.startsWith(`${lv.scene}:${lv.site}:`)
        ? tr(XM, "enter_ann", { site: siteName(lv.scene, lv.site), room })
        : tr(XM, "level_ann", { room, n: lv.index + 1, total: lv.count }));
      // şehir landmarkının iç mekânı keşif kataloğu dışıdır — şehir pasaportu damgası (citymap/store.ts)
      if (isCitySite(lv.site)) cityRuntime.onInteriorLevel?.({ scene: lv.scene, site: lv.site, index: lv.index, outdoor: lv.outdoor });
      else if (lv.index === 0) recordEnter(lv.scene, lv.site);
      lastKey.current = lv.key;
    } else {
      announceWalk(tr(XM, "leave_ann"));
      lastKey.current = "";
    }
    // UX-AUDIT: varış karosu son karo sayılır — kat seçiciyle merdiven sahanlığına varıp (F) boşluğun ağzına ilk adım da tetikler
    // (eskiden ilk karo değişimi yutuluyordu: "F: Merdiven: aşağı in" ağızda takılı kalıyordu)
    lastTile.current = tileAt(av.x, av.z);
  }, [arrival, built]);

  // karo değişimi tetikleyicileri
  useEffect(() => useWalkStore.subscribe((s, prev) => {
    if (!s.active || !prev.active || !s.pose || s.pose === prev.pose || s.world !== scene) return;
    if (s.photo || useInterior.getState().busy) return;
    const t = s.pose.tile;
    const last = lastTile.current;
    lastTile.current = t;
    if (!last || (last[0] === t[0] && last[1] === t[1])) return;
    const lv = useInterior.getState().view?.level;
    // INTERIOR-VIEW: merdiven tetiği (alt katta son basamak / üst katta boşluğun ağzı) → aynı noktada öteki kat
    const link = lv?.stairs.find((x) => x.tile[0] === t[0] && x.tile[1] === t[1]);
    if (lv && link) { if (!walkRuntime.avatar.route?.length || doorIntended(link.tile, walkRuntime.avatar.route)) stairSwap(link); return; } // PORTAL-INTENT-001: merdiven fiziksel yürünür (geçit değil), elle basış kat değiştirir; // HQA-FIX: geçen rota kat değiştirmez
    if (lv) onInteriorTile(lv, t);
    else if (!interiorRuntime.inside && !cityRuntime.active) onExteriorTile(scene, t);
  }), [scene]);

  // sahne değişince iç mekân biter
  useEffect(() => () => resetInterior(), [scene]);

  // geliştirme kancası (§10.3 deseni): ekran görüntüsü betikleri; üretim derlemesinde yok
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __voxcrewInterior?: unknown };
    w.__voxcrewInterior = {
      enter: (site: string) => enterSite(scene, site),
      /** INTERIOR-VIEW: sahnenin girilebilir yerleri (walk_perf --interior) */
      sites: () => openSites(scene).map(([site]) => site),
      go: (to: number) => goLevel(to),
      leave: (home = false) => leaveInterior(home),
      /** INTERIOR-VIEW: katın tam sahne kaydı (dünya biçimiyle uyumlu veri) */
      record: () => useInterior.getState().view?.record ?? null,
      state: () => {
        const s = useInterior.getState();
        const lv = s.view?.level;
        const r = s.view?.record;
        return lv ? { site: lv.site, index: lv.index, count: lv.count, name: lv.name, outdoor: lv.outdoor, w: lv.built.width, d: lv.built.depth,
          portals: lv.portals, spots: lv.spots, blocks: s.view?.built.blocks.length, fade: s.fade,
          // INTERIOR-VIEW: sahne kaydı özeti (alan, kamera, ışık, ses, bütçe)
          space: r?.space, camera: r?.camera, light: r?.light, ambience: r?.ambience, exterior: r?.exterior, budget: r?.budget,
          groups: s.view ? [...new Set(s.view.built.blocks.map((b) => b.g))].sort() : [] } : { inside: false, fade: s.fade };
      },
    };
    return () => { delete w.__voxcrewInterior; };
  }, [scene, view]);

  return null;
}
