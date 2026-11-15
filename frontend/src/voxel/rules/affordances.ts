/**
 * S45 — affordance sözlüğü (rehber §6.2) ↔ VoxCrew istasyon alanları (`Station.pose` / `device` / `bed`, S41).
 *
 * Yeni alan EKLENMEDİ: bugünkü üç alan rehberin gerektirdiği ayrımı taşıyor (oturma türü, cihaz, uyku yüzeyi). Rehberdeki
 * "exclusive slot" = bir istasyon (bir ajan); "interaction anchor" = istasyon/araç/uyku karosu; "reservation" = koltuk
 * ataması (`assignSeats`). Çok katlı yürünebilirlik (tasarım b) gelince `Station.floor?` eklenecek.
*/
import type { BedKind, Device, Pose, Station } from "../scenes";

/** Rehberin eylem/affordance kimlikleri (İngilizce sabit; arayüzde gösterilmez). */
export type Affordance =
  | "sit" | "sit_at_table" | "lounge" | "stand_work" | "lie"
  | "work_with_laptop" | "use_desktop" | "use_console" | "use_tablet"
  | "sleep" | "rest" | "use_tool";

export const POSE_AFFORDANCES: Record<Pose, readonly Affordance[]> = {
  sit_chair: ["sit", "sit_at_table"],
  sit_bench: ["sit"],
  sit_ground: ["sit"],
  lounge: ["sit", "lounge"],
  stand: ["stand_work"],
  lie: ["lie"],
};

export const DEVICE_AFFORDANCES: Record<Device, readonly Affordance[]> = {
  laptop: ["work_with_laptop"],
  tablet: ["use_tablet", "work_with_laptop"],
  desktop: ["use_desktop"],
  console: ["use_console"],
  none: [],
};

/** Uyku yüzeyi → uyku duruşu (Builder.sleep ile aynı eşleme; CORE-ASSET-001 bunu denetler). */
export const BED_POSE: Record<BedKind, "lie" | "lounge"> = {
  bed: "lie", bunk: "lie", cot: "lie", tent: "lie", mat: "lie",
  hammock: "lounge", lounger: "lounge", sofa: "lounge",
  hotel: "lie", // HOTEL-SYS: otel kapısı geçidi (görünür yatak yok; ajan içeride, görünmez)
};

export const POSES = Object.keys(POSE_AFFORDANCES) as Pose[];
export const DEVICES = Object.keys(DEVICE_AFFORDANCES) as Device[];
export const BEDS = Object.keys(BED_POSE) as BedKind[];

/** İstasyonun sunduğu affordance'lar (varsayılanlar: sit_chair + desktop — bugünkü görünüm). */
export function stationAffordances(s: Station): Affordance[] {
  const pose = s.pose ?? "sit_chair", device = s.device ?? "desktop";
  return [...POSE_AFFORDANCES[pose], ...DEVICE_AFFORDANCES[device]];
}

/** Uyku noktasının affordance'ları. */
export function sleepAffordances(s: Station): Affordance[] {
  const bed = s.bed;
  return bed ? ["sleep", BED_POSE[bed] === "lie" ? "lie" : "lounge"] : [];
}

/** Rehber §6.1 görev kontratının VoxCrew karşılığı: etkinlik → gerekli affordance'lar (hepsi) + en az biri. */
export interface ActivityContract {
  id: string;
  /** hepsi gerekli */
  all: readonly Affordance[];
  /** en az biri gerekli */
  any: readonly Affordance[];
}

export const ACTIVITIES: Record<string, ActivityContract> = {
  // dizüstüyle çalışma: masa ŞART DEĞİL (rehber T01/T07) — bank, örtü, şezlong, ayakta bar da olur
  work_with_laptop: { id: "work_with_laptop", all: ["work_with_laptop"], any: ["sit", "lounge", "stand_work"] },
  // masaüstü/konsol işi masada ya da konsol başında
  work_at_desk: { id: "work_at_desk", all: [], any: ["use_desktop", "use_console"] },
  sleep: { id: "sleep", all: ["sleep"], any: ["lie", "lounge"] },
};

/** Etkinlik bu istasyonda yapılabilir mi? */
export function canPerform(activity: ActivityContract, aff: readonly Affordance[]): boolean {
  return activity.all.every((a) => aff.includes(a)) && (!activity.any.length || activity.any.some((a) => aff.includes(a)));
}
