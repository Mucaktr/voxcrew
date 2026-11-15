/**
 * ACTIVITY-FEEL (B7, B8) — eylem kamerası: olta ve şehir ritüelinde takip kamerası eylemi **yandan 45°** gösterir (ürün sahibi: "olta
 * atınca kamera karakterin arkasına gidiyor; 45 derece sağ/sol açılardan gösterse daha iyi").
 *
 * - Adaylar: bakışın +45° ve −45° yanı (önce), sonra ±60°, en son tam arka (eski davranış; yan açıların ikisi de duvara
 * gömülüyse). Her aday için takip kamerasının yörünge konumu (`scale.ts orbitPose` ile aynı hesap) kurulur.
 * - Puan: kamera ile göğüs pivotu ve kamera ile her hedef (şamandıra, tezgâh, oturak) arasındaki doğrunun geçtiği katı/cam blok
 * örnekleri (duvar, ağaç gövdesi, tente; zemin ve ince direk sayılmaz) + kadraj dışı kalan hedef (yatay görüş yarı açısı).
 * En düşük puanlı yan seçilir; eşitse hedefleri ortaya daha yakın tutan, o da eşitse `prefer` yanı (sağ).
 * - Saf modül (three/React/depo yok): WalkRig olta ve ritüel başlangıcında bir kez çağırır; kayma WalkRig'in yaw yumuşatmasıdır
 * (hareket azaltmada anlık). Test: scripts/feel_camera.test.mjs.
*/
import type { BlockQuery } from "./landmarkView";

/** Yan açı (rad). */
export const ACTION_SIDE = Math.PI / 4;
/** Kadraj denetiminin yatay yarı açısı (rad; dar telefon ekranında da güvenli). */
export const ACTION_HALF_FOV = (32 * Math.PI) / 180;

export interface ActionCamInput {
  /** avatar ayak noktası */
  x: number; z: number;
  /** ayak yüzeyi (yükselti) */
  footY?: number;
  /** eylemin yönü (avatarın bakışı; `AvatarState.heading`: 0 → +z) */
  face: number;
  /** kadrajda kalması gereken noktalar (şamandıra, tezgâh, oturak) */
  targets?: readonly { x: number; z: number; y?: number }[];
  /** takip mesafesi ve eğim (WalkRig `s.dist`, `s.pitch`) */
  dist: number;
  pitch: number;
  /** göğüs pivot yüksekliği (ayak üstü; `scale.ts LOOK_Y`) */
  pivotY: number;
  /** yörüngenin en düşük yükselişi (`scale.ts ORBIT_MIN`) */
  orbitMin?: number;
  /** eşitlikte tercih edilen yan: +1 sağ (bakışa göre saat yönü), −1 sol */
  prefer?: 1 | -1;
}
export interface ActionCamPick { yaw: number; side: number; score: number; cam: { x: number; y: number; z: number } }

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Takip kamerasının konumu (`scale.ts orbitPose`): pivot − yön · mesafe; yükseliş en az `orbitMin`. */
export function camAt(px: number, py: number, pz: number, yaw: number, pitch: number, dist: number, orbitMin = 0.18) {
  const elev = Math.max(orbitMin, -pitch), c = Math.cos(elev);
  return { x: px - Math.sin(yaw) * c * dist, y: py + Math.sin(elev) * dist, z: pz - Math.cos(yaw) * c * dist };
}

/** (a → b) doğrusunun geçtiği katı/cam blok örneği sayısı (uçlardaki 0,35 birim hariç; zemin, su, bulut, ince direk sayılmaz). */
export function segmentHits(q: BlockQuery, a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, floorY = 0): number {
  const L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  if (L < 0.8) return 0;
  const near = [...q(Math.min(a.x, b.x) - 0.5, Math.min(a.z, b.z) - 0.5, Math.max(a.x, b.x) + 0.5, Math.max(a.z, b.z) + 0.5)]
    .filter((r) => (r.g === undefined || r.g === "solid" || r.g === "glass") && r.p[1] + r.s[1] / 2 > floorY + 0.12 && Math.max(r.s[0], r.s[2]) >= 0.12);
  if (!near.length) return 0;
  let n = 0;
  const steps = Math.ceil(L / 0.2);
  for (let k = 1; k < steps; k++) {
    const u = k / steps, d = u * L;
    if (d < 0.35 || L - d < 0.35) continue;
    const x = a.x + (b.x - a.x) * u, y = a.y + (b.y - a.y) * u, z = a.z + (b.z - a.z) * u;
    for (const r of near) {
      if (Math.abs(x - r.p[0]) <= r.s[0] / 2 && Math.abs(y - r.p[1]) <= r.s[1] / 2 && Math.abs(z - r.p[2]) <= r.s[2] / 2) { n++; break; }
    }
  }
  return n;
}

/** Hedefin kamera bakışına göre yatay açısı (rad, mutlak). */
export function offAxis(cam: { x: number; z: number }, yaw: number, t: { x: number; z: number }): number {
  return Math.abs(wrap(Math.atan2(t.x - cam.x, t.z - cam.z) - yaw));
}

/**
 * Eylem kamerasının yaw'ı: ±45° yanlardan engelsiz ve hedefleri kadrajda tutan; olmazsa ±60°, en son tam arka.
 */
export function actionCamYaw(q: BlockQuery, inp: ActionCamInput): ActionCamPick {
  const foot = inp.footY ?? 0, py = foot + inp.pivotY, prefer = inp.prefer ?? 1;
  const targets = inp.targets ?? [];
  const sides: number[] = [prefer * ACTION_SIDE, -prefer * ACTION_SIDE, prefer * (Math.PI / 3), -prefer * (Math.PI / 3), 0];
  let best: ActionCamPick | null = null, bestCenter = Infinity;
  sides.forEach((side, rank) => {
    const yaw = wrap(inp.face + side);
    const cam = camAt(inp.x, py, inp.z, yaw, inp.pitch, inp.dist, inp.orbitMin);
    let score = segmentHits(q, cam, { x: inp.x, y: py, z: inp.z }, foot) * 3;
    let center = 0;
    for (const t of targets) {
      const ty = t.y ?? foot + 0.4;
      score += segmentHits(q, cam, { x: t.x, y: ty, z: t.z }, foot);
      const off = offAxis(cam, yaw, t);
      if (off > ACTION_HALF_FOV) score += 4;
      center += off;
    }
    // yan açılar (45°) tercih: ±60° hafif, tam arka belirgin ceza (yalnız ikisi de kapalıysa seçilir)
    score += rank < 2 ? 0 : rank < 4 ? 1.5 : 5;
    if (!best || score < best.score - 1e-9 || (Math.abs(score - best.score) <= 1e-9 && center < bestCenter - 1e-6)) {
      best = { yaw, side, score, cam }; bestCenter = center;
    }
  });
  return best!;
}

/**
 * İstenen eylem kamerası pozu (CAMERA ekibinin çarpışma/örtme çözücüsü bunu girdi alır; bu modül çarpışma çözmez, yalnız kadraj
 * yanını seçer). `key` her yeni istekte artar; `kind` null → eylem kamerası yok (takip kamerası kendi kuralında).
 */
export const actionCamPose: { key: number; kind: "fish" | "ritual" | null; yaw: number; side: number; pitch: number | null; cam: { x: number; y: number; z: number } | null } =
  { key: 0, kind: null, yaw: 0, side: 0, pitch: null, cam: null };

/** Eylem kamerasını ister: yanı seçer, `actionCamPose`'a yazar ve yaw'ı döner (WalkRig yumuşak kaydırır; hareket azaltmada anlık). */
export function requestActionCam(kind: "fish" | "ritual", q: BlockQuery, inp: ActionCamInput, pitch: number | null = null): number {
  const pick = actionCamYaw(q, inp);
  actionCamPose.key++; actionCamPose.kind = kind; actionCamPose.yaw = pick.yaw; actionCamPose.side = pick.side;
  actionCamPose.pitch = pitch; actionCamPose.cam = pick.cam;
  return pick.yaw;
}
/** Eylem bitti (olta bırakıldı / ritüel bitti): istek temizlenir. */
export function clearActionCam(): void { actionCamPose.kind = null; actionCamPose.cam = null; actionCamPose.pitch = null; }
