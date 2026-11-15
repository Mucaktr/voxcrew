/**
 * yolculukta görüş konisi titreşimi (LOS dither) kapalı.
 *
 * Sorun: yürüme kesitinin gövde yoklaması (`walkCutPlan` → `uCutStreet` + `uCutLos`, camera/occlusion.ts `LOS_GLSL`) kamerayla
 * avatar arasındaki örtücüyü ekran uzayında 4 × 4 Bayer titreşimiyle deliyordu. Yolculukta avatar aracın içinde oturduğundan
 * örtücü aracın kendisidir: Londra otobüsünün tavanında/arka camında, <city> metrosunun yan duvarında, İstanbul vapurunun
 * küpeştesinde araçla birlikte kayan, karıncalanan noktalı bir daire açılıyordu.
 * Karar (TL; ile güncellendi: yoklama açık, örtücü bütün blok): yolculuk boyunca görüş konisi kapalı; yolculuk kamera profilleri (transit/rideCam.ts) görüşü
 * yerleşimle açık tutar, kamera katıya girmez (camera/collide.ts). Kamera kabarcığı (`near`) açık kalır ve büyük bloğu yine
 * yalnız kamera çevresinde açar (`los` korunur → `uCutNearBig` = 1; `writeCutPlan` koniyi yalnız yoklama varken yazar).
 * Yalnız şehir yolculuğu (`rideRuntime.ride`); dönme dolap kabini (`walkRuntime.ride`, rideRuntime değil) değişmez.
 * Saf modül → Node testinde yüklenir (scripts/render2.test.mjs).
*/
import type { CutPlan } from "./cover";

/** Yolculukta kesit planı: görüş konisi titreşimi kapalı; kabarcık, kabuk ve eşik aynen kalır.
 * (TL kararı): gövde yoklaması AÇIK — kapalı vagonda (metro, tramvay, otobüs) avatar yan duvarın/tavanın arkasında
 * kalıyordu (her en/boyda, telefonda göze batıyordu). Avatarı örten araç bloğu (yoklama doğrusunu kesen) titreşimsiz BÜTÜN blok açılır;
 * avatarı örtmeyen blok açılmaz (delik yok). örtücü blok bütün değil, keskin kenarlı görüş konisi kadar açılır (`losHard`).*/
export function rideCutPlan(plan: CutPlan, riding: boolean): CutPlan {
  if (!riding || !plan.probes) return plan;
  // bütün blok yerine keskin kenarlı görüş penceresi — kapalı vagonun çatısı/yan duvarı bütün kalkıyordu (üstü açık kutu)
  return { ...plan, losHard: true, side: 0 }; // yan kesiti yolculukta kapalı (önceki gibi)
}

/**
 * birinci şahıs kamerası göz hizasında, yani aracın gövde bloklarının İÇİNDE kalır (tramvay, metro: ekran düz gri).
 * Şehir yolculuğu boyunca görünüm üçüncü şahsa çevrilir (yolculuk kamerası transit/rideCam.ts araç dışında); varışta tercih geri gelir.
*/
export function firstPersonOn(view: string, photo: boolean, riding: boolean): boolean { return view === "first" && !photo && !riding; }
