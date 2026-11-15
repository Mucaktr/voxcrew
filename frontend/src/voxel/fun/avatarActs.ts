/**
 * W3 (WALK-FUN) — "Ben" avatarının dokunuşu: hayvan, ağaç, su, akvaryum, çiçek, lamba için
 * var olan `ambient` dokunma tepkileri (`taps`, mırlama, yuvarlanma, yaprak, sıçrama…). Yalnızca giriş: tepkinin kendisi
 * Ambient.tsx'te değişmeden çalışır. Oturma ve kendine kahve `walkRuntime.sit` / `walkRuntime.sip` ile (WALK-UX yazar).
 *
 * Ambient ayrıca Yakındakiler için hayvan ve dokunulabilir nesne listesini yayımlar (`ambientNearby`, ≈ 4 Hz).
*/
import { cableEntities, cablePoke } from "../transit/cableRide";
import { wheelEntities, wheelPoke } from "../transit/wheelRide";
import { ritualEntities, ritualPoke } from "./ritualRuntime";
import { guideEntities, guidePoke } from "./cityGuide";
import type { ProxEntity } from "../walk/controller";

export interface PokeRequest { x: number; z: number; at: number; done: boolean }
/** Bekleyen dokunuş (Ambient önce hayvanlarda, sonra durağan nesnelerde arar; 1 sn'de bulunamazsa düşer). */
export const avatarPokes: { req: PokeRequest | null } = { req: null };

/** Avatar (x, z) yakınındaki hayvana ya da nesneye dokunur. */
export function avatarPoke(x: number, z: number): void {
  avatarPokes.req = { x, z, at: performance.now(), done: false };
}

/** Yakındakiler girdisi: `animal:<n>` (tür "animal") ve `hot:<n>` (tür "prop"); `label` görünen ad (yerel dilde). */
export interface AmbientEntity extends ProxEntity { label: string; /** `hot:` nesnesinin cinsi (Yakındakiler adı; FIX-UX) */ type?: string }
export const ambientNearby: { animals: AmbientEntity[]; hot: AmbientEntity[] } = { animals: [], hot: [] };
/** Ambient'in yayımladığı tüm öğeler (aynı dizi örnekleri; kopyalamadan okuyun). binilebilir gözlem çarkının biniş
 * girdisi (`hot:wheel`, transit/wheelRide.ts) de buradan Yakındakiler'e girer. şehir ritüelleri (`hot:rt:<ritüel>:<n>`,
 * fun/ritualRuntime.ts) aynı desenle eklenir.*/
export function ambientEntities(): readonly AmbientEntity[] {
  const base = ambientNearby.animals.length ? (ambientNearby.hot.length ? [...ambientNearby.animals, ...ambientNearby.hot] : ambientNearby.animals) : ambientNearby.hot;
  const ride = [...wheelEntities(), ...cableEntities()];
  const rt = ritualEntities(ambientNearby.animals);
  const gd = guideEntities(); // ACTIVITY-FEEL (B4): şehir rehberi kioskü
  if (!ride.length && !rt.length && !gd.length) return base;
  return [...base, ...ride, ...rt, ...gd];
}
/** `animal:3` / `hot:7` kimliğinden dokunuş (WALK-UX F tuşu). Bilinmeyen kimlik → false. `hot:wheel` → binme.
 * `hot:rt:` → ritüel.*/
export function pokeEntity(id: string): boolean {
  if (cablePoke(id)) return true;
  if (wheelPoke(id)) return true;
  if (ritualPoke(id, ambientNearby.animals)) return true;
  if (guidePoke(id)) return true;
  const e = ambientEntities().find((x) => x.id === id);
  if (!e) return false;
  avatarPoke(e.x, e.z);
  return true;
}
