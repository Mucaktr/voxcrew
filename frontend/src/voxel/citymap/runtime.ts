/**
 * şehir kipi çalışma durumu (React dışı okuma; ağır içe aktarma yok). İç mekân ve konum kaydı modülleri döngüsel
 * içe aktarma olmadan buradan okur:
 * - `active`: avatar şehir haritasında (ya da onun bir landmark iç mekânında).
 * - `office`: ofis tabanındaki dönüş pozu ("Şehre çık" kapısının önü; taban göreli). Konum kaydı (lib/walk.ts →
 * `interiorSavePose`) şehirdeyken bunu yazar: yürüme modundan şehirde çıkılırsa ofiste kapının önüne dönülür.
 * - `exit`: "Ofise dön" (iç mekândan da) — store.ts kaydeder.
 * - `onInteriorLevel` / `siteLabel`: şehir landmarkı iç mekânının damgası ve adı (InteriorRig, keşif adları).
*/
export interface CityInteriorLevel { scene: string; site: string; index: number; outdoor: boolean }

export const cityRuntime: {
  active: boolean;
  office: { x: number; z: number; heading: number } | null;
  exit: (() => void) | null;
  onInteriorLevel: ((lv: CityInteriorLevel) => void) | null;
  siteLabel: ((site: string) => string | null) | null;
} = { active: false, office: null, exit: null, onInteriorLevel: null, siteLabel: null };

/** İç mekân yeri bir şehir landmarkı mı (yer kimliği `city_` ile başlar; keşif kataloğuna girmez). */
export const isCitySite = (site: string | null | undefined) => !!site && site.startsWith("city_");
