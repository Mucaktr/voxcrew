/**
 * (ürün sahibi 2026-10-29 "şehir portallarından geçince çıkan yapılar … kamera açıları … her şey kusursuz olsun") — şehir
 * haritasında ölçülerek seçilmiş varış pozları (veri).
 *
 * Durak varışı (`store.ts stopArrival`: hızlı seyahat, iniş) ve landmark kapısından çıkış (`doorExit.ts landmarkExit`) kuralla
 * seçilir (görüş ızgarası: bakış ışını, yer). Kural kameranın arkasını bilmez: iskele saçağı, istasyon binası, köprü gövdesi,
 * simgenin kendi cephesi takip kamerasının önüne girip karenin %15–94'ünü kaplıyordu (`scripts/arrival_check.mjs`
 * ARRIVAL-CAM-001 / ARRIVAL-VIEW-001). Kuralın pozu denetimden geçmeyen duraklar ve kapılar için poz burada sabitlenir:
 * karo + bakış yönü (8 yön, k × 45°; 0 = +z, 2 = +x) ve çıkışta kamera yaw'ı. Pozlar `scripts/arrival_poses.mjs --write` ile
 * varış denetiminin kendi ölçüsüyle (WalkRig kamera çözümü: profil, yaylı kol, kesit) seçilir; elle yazılmaz.
 *
 * Durak pozu biniş panelinin açıldığı komşulukta kalır (Chebyshev ≤ 1; olmazsa ≤ 2). Saf modül: React/three yok.
*/
import type { CityTile } from "./format";
import { FULL_EXITS, FULL_STOPS } from "../../full/arrivalPoses";

/** durak karosu "i,j" → [i, j, yön k] */
type StopRow = readonly [number, number, number];
/** landmark kapı karosu "i,j" → [çıkış i, j, yön k, kamera yön k] */
type ExitRow = readonly [number, number, number, number];

// BEGIN GENERATED (scripts/arrival_poses.mjs --write; kept cities here, the rest in src/full/arrivalPoses.ts)
const BASE_STOPS: Readonly<Record<string, Readonly<Record<string, StopRow>>>> = {
  "istanbul": { "-10,50": [-9,50,0], "-10,64": [-9,63,0], "-32,36": [-32,36,5], "-4,-1": [-3,0,6], "-52,11": [-52,11,7], "104,4": [104,4,3], "110,18": [109,19,4], "110,8": [109,9,4], "14,-5": [14,-5,6], "65,128": [66,129,4] },
  "kapadokya": { "15,4": [15,4,3], "24,52": [25,53,7], "30,-46": [30,-46,2], "96,-76": [95,-77,1] },
  "londra": { "-12,10": [-13,9,7], "-12,36": [-12,36,6], "-12,78": [-12,78,3], "-50,36": [-50,36,2], "22,24": [22,23,2], "24,84": [24,84,5], "47,43": [48,43,7], "47,91": [46,92,0] }
};
const BASE_EXITS: Readonly<Record<string, Readonly<Record<string, ExitRow>>>> = {
  "istanbul": { "-23,-2": [-24,-1,0,0], "-5,-39": [-7,-39,6,7], "-9,-19": [-9,-21,4,3], "101,9": [102,11,0,1], "15,-21": [13,-21,6,5], "49,119": [48,118,4,3] },
  "londra": { "-37,29": [-38,31,6,5], "44,29": [44,28,2,1] }
};
// END GENERATED
const STOPS: Readonly<Record<string, Readonly<Record<string, StopRow>>>> = { ...BASE_STOPS, ...FULL_STOPS };
const EXITS: Readonly<Record<string, Readonly<Record<string, ExitRow>>>> = { ...BASE_EXITS, ...FULL_EXITS };

const yawOf = (k: number) => Math.atan2(Math.sin((k * Math.PI) / 4), Math.cos((k * Math.PI) / 4));

/** Durağın ölçülmüş varış pozu (yoksa null: kural `stopArrival` geçerli). */
export function stopPose(mapId: string, t: CityTile): { tile: CityTile; heading: number } | null {
  const r = STOPS[mapId]?.[`${t[0]},${t[1]}`];
  return r ? { tile: [r[0], r[1]], heading: yawOf(r[2]) } : null;
}

/** Landmark kapısının ölçülmüş çıkış pozu (yoksa null: kural `landmarkExit` geçerli). */
export function exitPose(mapId: string, door: CityTile): { out: CityTile; heading: number; aim: number } | null {
  const r = EXITS[mapId]?.[`${door[0]},${door[1]}`];
  return r ? { out: [r[0], r[1]], heading: yawOf(r[2]), aim: yawOf(r[3]) } : null;
}

/** Üretici ve test için: tablonun kayıt sayıları. */
export const arrivalPoseCounts = () => ({
  stops: Object.values(STOPS).reduce((n, m) => n + Object.keys(m).length, 0),
  exits: Object.values(EXITS).reduce((n, m) => n + Object.keys(m).length, 0),
});
