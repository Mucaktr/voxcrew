/**
 * WALK-EXPLORE — iç mekân çalışma durumu (React dışı okuma; ağır içe aktarma yok, lib/walk.ts konum kaydı kullanır).
 * `inside`: avatar bir iç mekân örneğinde mi; `outside`: dış dünyadaki dönüş pozu (dünya koordinatı ve taban göreli kayıt).
 */
import { cityRuntime } from "../citymap/runtime";

export const interiorRuntime: {
  inside: boolean;
  /** ARRIVAL-QA: `aim` — dönüşte takip kamerasının yaw'ı (şehir landmark çıkışı: kapının geçit perdesi kameranın arkasında kalmaz) */
  outside: { x: number; z: number; heading: number; bx: number; bz: number; aim?: number } | null;
} = { inside: false, outside: null };

/** Konum kaydı (lib/walk.ts): içerideyken dış dünyadaki taban göreli dönüş pozu; dışarıdaysa null. */
export function interiorSavePose(): { x: number; z: number; heading: number } | null {
  // şehir haritasındayken (iç mekânı dahil) ofisteki "Şehre çık" kapısının önü
  if (cityRuntime.active && cityRuntime.office) return cityRuntime.office;
  const o = interiorRuntime.outside;
  return interiorRuntime.inside && o ? { x: o.bx, z: o.bz, heading: o.heading } : null;
}
