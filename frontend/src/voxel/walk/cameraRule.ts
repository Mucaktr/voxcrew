/**
 * INTERIOR-VIEW — yürüme kamerasının alan kuralı (React dışı, kare başı okuma; WalkRig okur, InteriorRig yazar).
 *
 * `null`: dış dünya (bugünkü takip kamerası: FOLLOW_DIST, taban görüş açısı, kesit yalnız örtülüyse). İç mekân katında
 * sahne kaydının kamera kuralı (interiors/sceneModel.ts `CAMERA_RULES`): takip mesafesi, görüş açısı eki ve oda/salon kesiti.
 * `key` değişince WalkRig kamerayı yeni alana oturtur (mesafe, yön; hareket azaltmada anlık, değilse kararma altında).
 */
import type { RoomShape } from "./cover";

export interface WalkCameraRule {
  /** kat anahtarı (`<sahne>:<yer>:<kat>`): değişince kamera yeni alana oturur */
  key: string;
  /** `street` — şehir haritası sokağı (üçüncü şahıs + otomatik kesit: UX-P2'den beri yalnız gerçek örtücü bloklar)*/
  space: "room" | "hall" | "deck" | "street" | "court"; // COURTYARD-PORTAL: court — duvarlı avlu sahnesi
  /** üçüncü şahıs takip mesafesi */
  dist: number;
  /** üçüncü şahısta taban görüş açısına eklenen derece */
  fovAdd: number;
  /** oda/salon kesiti (kamera–avatar arası duvarlar saydam) */
  cutaway: boolean;
  /** kesitte açılan parçaların en düşük dünya yüksekliği (zemin kalır) */
  minY: number;
  /** UX-AUDIT: iç mekân katının oda biçimi (kapı karoları hariç; walk/cover.ts `roomShape`) — kabuk kesiti bunun dışını açar */
  room?: RoomShape | null;
}

/**
 * `shift`: merdiven geçişinde dünyanın düşey kayması (yeni kat y = eski kat y + shift); WalkRig bir kez tüketir (kamera, bakış,
 * çizim yüksekliği aynı kadar kayar → geçiş görünmez). `carry`: kural değişimi merdiven geçişinden; yön/eğim korunur, oturtma yok.
 * `aim` (UXF-D): bir sonraki karede takip kamerasının oturacağı yaw (şehirden ofise dönüş karesi, `spawnFrame.ts framedYaw`);
 * WalkRig bir kez tüketir (yaw, varsayılan eğim ve mesafe; kayma yok — geçiş kararma altında).
 */
/** `aimExact`: `aim` zaten doğrulanmış bir kare (durak varış yönü) — WalkRig `clearAimYaw` ile döndürmez.*/
/** `aimHand`: kararma altında olsa da kamera `aim`e devirle (avatarın çevresinde, RIDE_HANDOFF sn) geçer — durak paneli çapraz sıçrayışı.*/
export const walkCamera: { rule: WalkCameraRule | null; shift: number; carry: boolean; aim: number | null; aimExact: boolean; aimHand: boolean } = { rule: null, shift: 0, carry: false, aim: null, aimExact: false, aimHand: false };

/** şehir sokağı ve seyir noktası kuralları (CityRig yazar; city_check CITY-MAP-OPAQUE-001 sokak pozlarını bununla kurar).*/
export const STREET_RULE: WalkCameraRule = { key: "city:street", space: "street", dist: 4.6, fovAdd: 4, cutaway: true, minY: 0.08 };
export const DECK_RULE: WalkCameraRule = { key: "city:deck", space: "deck", dist: 4.6, fovAdd: 0, cutaway: false, minY: 0 };

export function setWalkCameraRule(rule: WalkCameraRule | null): void { walkCamera.rule = rule; }
export function shiftWalkCamera(dy: number): void { walkCamera.shift += dy; walkCamera.carry = true; }
