/**
 * gözlem çarkına binme (yürüme modu; React dışı). Saf matematik `transit/wheel.ts`.
 *
 * - Yakındakiler: sahnenin kendi tabanında (şehir haritası ve iç mekân değil) biniş karosunda tek girdi `hot:wheel`
 * (`fun/avatarActs.ts ambientEntities` ekler; F/Enter "git ve dokun" → oraya yürür → `wheelPoke`). Yolculukta listede yok.
 * - Biniş: yolculuk kancası (`walkRuntime.ride`) kullanılır — WalkRig adım, çarpışma ve girdi yerine çağırır, sahne
 * saatini (`t`, Blocks.tsx dönen blok saati) verir. Avatar bekler → kabinle bir tam tur → biniş karosuna iner; yolda
 * yürüyemez, tıkla-git yok sayılır, kamera avatarı (kabini) izler. Hareket azaltmada durağan çarkın tepe kabininde kısa seyir.
 * - Yürüme modundan çıkılırsa ya da sahne değişirse yolculuk biter, avatar biniş karosuna konur. Poz mutlak saatten
 * hesaplanır: fotoğraf modu ya da gizli sekme sonrası kabin kaldığı yerden değil çarkın o anki yerinden sürer.
 * - Duyuru: dünyada kısa etiket + kibar canlı bölge (`fun/announce.ts say`).
*/
import { tx as t9n } from "../../lib/i18n";
import { walk as WM } from "../../locales/walk";
import { cityRuntime } from "../citymap/runtime";
import { say } from "../fun/announce";
import { interiorRuntime } from "../interiors/runtime";
import { reducedMotion } from "../motion";
import type { ProxEntity } from "../walk/controller";
import { useWalkStore, walkRuntime } from "../walk/walkStore";
import { stationXZ, wheelRidePlan, wheelRidePose, WHEELS, type WheelRidePlan, type WheelSpec } from "./wheel";

export const WHEEL_ENTITY_ID = "hot:wheel";
/** Biniş için avatarın biniş karosuna en çok uzaklığı (birim; Yakındakiler "git ve dokun" menzili 1,85 + pay). */
export const BOARD_RANGE = 2.6;

interface Active {
  spec: WheelSpec;
  scene: string;
  plan: WheelRidePlan | null;
  own: number;
  hook: NonNullable<typeof walkRuntime.ride>;
  unsub: () => void;
}
let active: Active | null = null;

/** Yolculuk durumu (canlı denetim ve testler için; kopya). */
export function wheelRideState(): { scene: string; plan: WheelRidePlan | null } | null {
  return active ? { scene: active.scene, plan: active.plan ? { ...active.plan } : null } : null;
}

const NONE: readonly (ProxEntity & { label: string; type?: string })[] = Object.freeze([]) as never;
// UXF-E: `far` — çark yarıçap dışında da Yakındakiler'de ("Gözlem çarkına bin · N adım"; girişten ~15 karo uzakta)
const ent: ProxEntity & { label: string; type?: string } = { id: WHEEL_ENTITY_ID, kind: "prop", x: 0, z: 0, label: "", type: "wheel", far: true };
const list = [ent];

/** Şu anki sahnenin çarkı (yalnız sahnenin kendi tabanında, yürürken). */
function currentSpec(): { spec: WheelSpec; scene: string } | null {
  const st = useWalkStore.getState();
  if (!st.active || !st.world || interiorRuntime.inside || cityRuntime.active) return null;
  const spec = WHEELS[st.world];
  return spec ? { spec, scene: st.world } : null;
}

/** Yakındakiler girdisi (yolculukta ve çarksız sahnede boş; aynı nesne yeniden kullanılır). */
export function wheelEntities(): readonly (ProxEntity & { label: string; type?: string })[] {
  if (active) return NONE;
  const cur = currentSpec();
  if (!cur) return NONE;
  const [x, z] = stationXZ(cur.spec, walkRuntime.baseOffset);
  ent.x = x; ent.z = z; ent.label = t9n(WM, "ride_wheel");
  return list;
}

/** F / Enter / Yakındakiler: biniş karosundaysa bin. Bizim kimliğimiz değilse false (Ambient dokunuşu dener). */
export function wheelPoke(id: string): boolean {
  if (id !== WHEEL_ENTITY_ID) return false;
  startWheelRide();
  return true;
}

/** Binişi başlatır (biniş karosunun yakınında, yolculuk yokken). Başarılıysa true. */
export function startWheelRide(): boolean {
  if (active || walkRuntime.ride) return false;
  const cur = currentSpec();
  if (!cur) return false;
  const a = walkRuntime.avatar, off = walkRuntime.baseOffset;
  const [sx, sz] = stationXZ(cur.spec, off);
  if (Math.hypot(a.x - sx, a.z - sz) > BOARD_RANGE) return false;
  walkRuntime.sit = null;
  const hook: Active["hook"] = (av, dt, t) => {
    const r = active;
    if (!r || r.hook !== hook) return;
    r.own += dt;
    const now = t ?? r.own;
    const calm = reducedMotion();
    if (!r.plan) r.plan = wheelRidePlan(r.spec, now, calm);
    const p = wheelRidePose(r.spec, r.plan, now, calm, walkRuntime.baseOffset);
    if (p.phase === "done") { finish(true); return; }
    av.x = p.x; av.z = p.z; av.heading = p.heading; av.speed = 0; av.route = null;
    if (p.phase === "ride") { av.y = p.y; av.ground = p.y; }
    av.vy = 0; av.grounded = true;
  };
  const unsub = useWalkStore.subscribe((s) => {
    if (active && (!s.active || s.world !== active.scene)) finish(true);
  });
  active = { spec: cur.spec, scene: cur.scene, plan: null, own: 0, hook, unsub };
  walkRuntime.ride = hook;
  say(t9n(WM, "ride_wheel_on"), sx, 1.4, sz);
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
  const [sx, sz] = stationXZ(r.spec, walkRuntime.baseOffset);
  const a = walkRuntime.avatar;
  a.x = sx; a.z = sz; a.y = 0; a.ground = 0; a.vy = 0; a.grounded = true; a.route = null; a.speed = 0; a.heading = Math.PI;
  walkRuntime.drawY = 0;
  say(t9n(WM, "ride_wheel_off"), sx, 1.4, sz);
}

/** Dışarıdan iptal (yolculuk yoksa etkisiz). */
export function cancelWheelRide(land = true): void {
  finish(land);
}
