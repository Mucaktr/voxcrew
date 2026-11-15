/**
 * taban sahne teleferiğine F ile binme (yürüme modu; React dışı). `wheelRide.ts` ile aynı desen: yolculuk kancası
 * (`walkRuntime.ride`) avatarı sahne saatiyle (`t`) kabinin ÇİZİLEN yolunda (yürüme uyumu `moverFitList`) taşır.
 *
 * - Yakındakiler: sahnenin kendi tabanında (şehir haritası ve iç mekân değil) biniş karosunda `hot:cablecar` ("Teleferiğe bin");
 * yolculukta kabin alt istasyondayken ("Teleferikten in") — F/Enter. Yolculukta başka yerde girdi yok.
 * - Biniş: kabin alt istasyona gelene dek bekler (`CABLE_PERIOD` sn'de bir; en çok bir dönem), kabinle gidiş-dönüş bir tur, alt
 * istasyonda biniş karosuna iner. Üst istasyon sur tepesindedir (yürünür değil): tek iniş yeri alt istasyondur. İstasyondayken F
 * ile erken inilir. Hareket azaltmada kabin alt istasyonda durağan çizilir (SceneFx t = 0): avatar kabinde `CABLE_CALM_S` sn
 * oturur ("Teleferikten in" hep açık), sonra iner.
 * - Yürüme modundan çıkılırsa ya da sahne değişirse yolculuk biter, avatar biniş karosuna konur.
*/
import { tx as t9n } from "../../lib/i18n";
import { walk as WM } from "../../locales/walk";
import { CABLE_PERIOD, FULL_CABLES } from "../../full/cableRide";
import { cityRuntime } from "../citymap/runtime";
import { say } from "../fun/announce";
import { interiorRuntime } from "../interiors/runtime";
import { reducedMotion } from "../motion";
import { samplePath } from "../props/movers";
import { tx, tz, type Mover } from "../scenes";
import type { ProxEntity } from "../walk/controller";
import { startViewTurn } from "../walk/viewTurn";
import { moverFitList, moverFitOf, walkSampler } from "../walk/moverFit";
import { useWalkStore, walkRuntime } from "../walk/walkStore";

export const CABLE_ENTITY_ID = "hot:cablecar";
/** Biniş karosuna en çok uzaklık (birim; Yakındakiler "git ve dokun" menzili 1,85 + pay). */
export const CABLE_BOARD_RANGE = 2.6;
/** Kabin biniş karosuna bu kadar yakınsa ("istasyonda") inilebilir. */
export const CABLE_DOCK_R = 2.6;
/** biniş anında kamera yaw'ı (kabin yönünden sapma, rad) ve eğimi (− kamera yukarıda): kabin ve içindeki avatar karede.*/
export const CABLE_VIEW_YAW = 0.7;
export const CABLE_VIEW_PITCH = -0.22;
/** Hareket azaltmada seyir süresi (sn). */
export const CABLE_CALM_S = 6;
/** Binilebilir teleferikler (yerleşik sahne kimliği → biniş karosu). Yalnız sahnenin kendi tabanında. */
export const CABLES: Readonly<Record<string, { board: readonly [number, number] }>> = FULL_CABLES;

interface Active {
  scene: string;
  mover: Mover;
  own: number;
  tIn: number | null;
  tOut: number;
  hook: NonNullable<typeof walkRuntime.ride>;
  unsub: () => void;
}
let active: Active | null = null;

/** Yolculuk durumu (canlı denetim ve testler için; kopya). */
export function cableRideState(): { scene: string; tIn: number | null; tOut: number } | null {
  return active ? { scene: active.scene, tIn: active.tIn, tOut: active.tOut } : null;
}

/** Kabinin şu anki (çizilen) konumu ve taban yüzü: yürüme uyumuyla (SceneFx ile aynı: ölçek × fit, yürüme yolu). */
function cabinAt(m: Mover, t: number, off: readonly [number, number]): { x: number; y: number; z: number; yaw: number } {
  const fit = moverFitOf(m), o = { x: 0, y: 0, z: 0, yaw: 0 }; // liste kopyası yerine doğrudan eşlem (aynı sonuç)
  samplePath(m).at(t, o);
  if (fit && fit.mover !== m) { const w = { x: 0, y: 0, z: 0, yaw: 0 }; walkSampler(fit).at(t, w); o.x = w.x; o.y = w.y; o.z = w.z; }
  const sy = (m.scale ?? 1) * (fit?.fy ?? 1);
  // kabin tabanının üst yüzü: parça y −1,0, kalınlık 0,1 → −0,95 × ölçek
  return { x: o.x + off[0], y: o.y - 0.95 * sy, z: o.z + off[1], yaw: o.yaw };
}

function currentCable(): { scene: string; mover: Mover } | null {
  const st = useWalkStore.getState();
  if (!st.active || !st.world || interiorRuntime.inside || cityRuntime.active) return null;
  if (!CABLES[st.world]) return null;
  const mover = moverFitList().map(([m]) => m).find((m) => m.shape === "cablecar");
  return mover ? { scene: st.world, mover } : null;
}

const boardXZ = (scene: string, off: readonly [number, number]): [number, number] => {
  const b = CABLES[scene].board;
  return [tx(b[0] + off[0]), tz(b[1] + off[1])];
};

/** Kabinin çizildiği sahne saati: SceneFx hareket azaltmada taban saatini 0'da tutar (`reduced ? 0 : clock`); yolculuk pozu ve
 *  "Teleferikten in" girdisi aynı saati kullanır (hareket azaltma yolculukta açılıp kapansa da). */
export const cableDrawnT = (t: number, calm: boolean): number => (calm ? 0 : t);
const drawnT = (t: number) => cableDrawnT(t, reducedMotion());

const NONE: readonly (ProxEntity & { label: string; type?: string })[] = Object.freeze([]) as never;
const ent: ProxEntity & { label: string; type?: string } = { id: CABLE_ENTITY_ID, kind: "prop", x: 0, z: 0, label: "", type: "cablecar", far: true };
const list = [ent];

/** Yakındakiler girdisi: biniş karosunda "Teleferiğe bin"; yolculukta yalnız kabin istasyondayken "Teleferikten in". */
export function cableEntities(): readonly (ProxEntity & { label: string; type?: string })[] {
  if (active) {
    if (active.tIn === null || active.own < active.tIn) return NONE;
    const off = walkRuntime.baseOffset, [bx, bz] = boardXZ(active.scene, off);
    const c = cabinAt(active.mover, drawnT(active.own), off); // kabinin ÇİZİLDİĞİ an (hareket azaltmada 0)
    if (Math.hypot(c.x - bx, c.z - bz) > CABLE_DOCK_R) return NONE;
    ent.x = walkRuntime.avatar.x; ent.z = walkRuntime.avatar.z; ent.label = t9n(WM, "ride_cable_off");
    return list;
  }
  const cur = currentCable();
  if (!cur) return NONE;
  const [x, z] = boardXZ(cur.scene, walkRuntime.baseOffset), a = walkRuntime.avatar;
  // biniş menzilinde girdi avatarın üstünde durur — bakış konisi (birinci şahıs F) ve mesafe sıralaması onu hep bulur; eskiden
  // istasyonda bakış başka yöne ise F "Dağ suru ve gözcü kulesi" simgesini seçiyordu (kart açılıyor, biniş kartın arkasında)
  const near = Math.hypot(a.x - x, a.z - z) <= CABLE_BOARD_RANGE;
  ent.x = near ? a.x : x; ent.z = near ? a.z : z; ent.label = t9n(WM, "ride_cable");
  return list;
}

/** F / Enter / Yakındakiler: biniş karosundaysa bin; yolculukta istasyondaysa in. Bizim kimliğimiz değilse false. */
export function cablePoke(id: string): boolean {
  if (id !== CABLE_ENTITY_ID) return false;
  if (active) { finish(true); return true; }
  startCableRide();
  return true;
}

/** Binişi başlatır (biniş karosunun yakınında, yolculuk yokken). Başarılıysa true. */
export function startCableRide(): boolean {
  if (active || walkRuntime.ride) return false;
  const cur = currentCable();
  if (!cur) return false;
  const a = walkRuntime.avatar, off = walkRuntime.baseOffset;
  const [sx, sz] = boardXZ(cur.scene, off);
  if (Math.hypot(a.x - sx, a.z - sz) > CABLE_BOARD_RANGE) return false;
  walkRuntime.sit = null;
  useWalkStore.getState().setPanel(null); // açık simge/bilgi kartı yolculuğu kapatmaz
  const calm = reducedMotion();
  const hook: Active["hook"] = (av, dt, t) => {
    const r = active;
    if (!r || r.hook !== hook) return;
    const now = t ?? r.own + dt;
    r.own = now;
    if (r.tIn === null) {
      // kabin alt istasyona yanaşana dek (t ≡ 0 mod periyot; hareket azaltmada hemen) biniş karosunda bekle
      r.tIn = calm ? now : (Math.floor(now / CABLE_PERIOD) + 1) * CABLE_PERIOD;
      r.tOut = r.tIn + (calm ? CABLE_CALM_S : CABLE_PERIOD);
      say(t9n(WM, "ride_cable_wait"), sx, 1.4, sz);
    }
    if (now < r.tIn) { av.x = sx; av.z = sz; av.speed = 0; av.route = null; av.vy = 0; av.grounded = true; return; }
    if (now >= r.tOut) { finish(true); return; }
    // avatar kabinin ÇİZİLEN pozunda — hareket azaltmada SceneFx kabini t = 0'da (alt istasyon) durağan çizer;
    // eskiden avatar periyot / 2'ye (üst istasyon) konuyordu: kabin altta, avatar havada
    const c = cabinAt(r.mover, drawnT(now), walkRuntime.baseOffset);
    av.x = c.x; av.z = c.z; av.heading = c.yaw; av.speed = 0; av.route = null; av.y = c.y; av.ground = c.y; av.vy = 0; av.grounded = true;
    if (now - r.tIn < dt + 0.05) {
      say(t9n(WM, "ride_cable_on"), c.x, c.y + 1.4, c.z);
      // kamera kabini kadrajlar — kabinin yan-arkasından, hafif yukarıdan (kullanıcı çevirirse döndürme biter)
      startViewTurn(c.yaw + CABLE_VIEW_YAW, CABLE_VIEW_PITCH, `cable:${r.scene}`);
    }
  };
  const unsub = useWalkStore.subscribe((s) => { if (active && (!s.active || s.world !== active.scene)) finish(true); });
  active = { scene: cur.scene, mover: cur.mover, own: 0, tIn: null, tOut: 0, hook, unsub };
  walkRuntime.ride = hook;
  return true;
}

/** Yolculuğu bitirir: `land` → avatar biniş karosuna (yerde) konur ve iniş duyurulur. */
function finish(land: boolean): void {
  const r = active;
  if (!r) return;
  active = null;
  r.unsub();
  if (walkRuntime.ride === r.hook) walkRuntime.ride = null;
  if (!land) return;
  const [sx, sz] = boardXZ(r.scene, walkRuntime.baseOffset);
  const a = walkRuntime.avatar;
  a.x = sx; a.z = sz; a.y = 0; a.ground = 0; a.vy = 0; a.grounded = true; a.route = null; a.speed = 0; a.heading = Math.PI;
  walkRuntime.drawY = 0;
  say(t9n(WM, "ride_cable_done"), sx, 1.4, sz);
}

/** Dışarıdan iptal (yolculuk yoksa etkisiz). */
export function cancelCableRide(land = true): void { finish(land); }
