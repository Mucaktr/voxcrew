/**
 * W5 (WALK-W5) — yürüme modunda dokunma jestleri:
 * - iki parmak çevirme ya da yatay sürükleme → kamerayı döndür (`walkRuntime.yawDelta`)
 * - kıstırma → takip mesafesi (`walkRuntime.zoomMul`; fotoğraf modunda fotoğraf kamerası)
 * - tek parmakla uzun basma (≥ 550 ms, ≤ 10 px kayma) → emote çarkı; bırakınca doğan "oraya yürü" dokunuşu iptal edilir
 *
 * Yalnızca dünya tuvaline (`role="application"`) başlayan dokunuşlar sayılır: joystick, Etkileşim düğmesi ve paneller
 * etkilenmez. Yakalama aşamasında dinler; varsayılan davranışı engellemez (tuval `touch-action: none`). Fare ve kalem yok.
*/
import { useEffect, type RefObject } from "react";
import { useWalkStore, walkRuntime } from "../../../voxel/walk/walkStore";

const LONG_MS = 550;
const SLOP_PX = 10;
const DRAG_YAW = 0.008;
const DRAG_PITCH = 0.006;

interface Pt { x: number; y: number; x0: number; y0: number }

/** İki parmak durumundan dönüş ve ölçek farkı (saf; test edilebilir). */
export function twoFinger(a0: { x: number; y: number }, b0: { x: number; y: number }, a1: { x: number; y: number }, b1: { x: number; y: number }) {
  const ang0 = Math.atan2(b0.y - a0.y, b0.x - a0.x), ang1 = Math.atan2(b1.y - a1.y, b1.x - a1.x);
  let dAng = ang1 - ang0;
  if (dAng > Math.PI) dAng -= Math.PI * 2;
  if (dAng < -Math.PI) dAng += Math.PI * 2;
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y), d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  const mid = { dx: (a1.x + b1.x - a0.x - b0.x) / 2, dy: (a1.y + b1.y - a0.y - b0.y) / 2 };
  return { dAng, scale: d1 > 1 && d0 > 1 ? d0 / d1 : 1, mid };
}

export function useWalkGestures(host: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const el = host.current;
    if (!el || !enabled) return;
    const pts = new Map<number, Pt>();
    let longTimer = 0;
    let longFired = false;
    const inWorld = (t: EventTarget | null) => {
      const n = t as Element | null;
      return !!n?.closest?.('[role="application"], [data-walk-surface]') && !n.closest('button, a, input, select, textarea, [role="dialog"], [role="menu"], [role="toolbar"]');
    };
    const clearLong = () => { window.clearTimeout(longTimer); longTimer = 0; };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || !inWorld(e.target)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
      longFired = false;
      if (pts.size === 1) {
        const st = useWalkStore.getState();
        if (st.active && !st.photo) {
          longTimer = window.setTimeout(() => {
            longTimer = 0;
            const s = useWalkStore.getState();
            if (pts.size !== 1 || !s.active || s.photo) return;
            longFired = true;
            s.setEmoteWheel(true);
          }, LONG_MS);
        }
      } else clearLong();
    };
    const move = (e: PointerEvent) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      if (pts.size === 1 && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > SLOP_PX) clearLong();
      if (pts.size === 2) {
        const [ida, idb] = [...pts.keys()];
        const a = pts.get(ida)!, b = pts.get(idb)!;
        const a1 = e.pointerId === ida ? { x: e.clientX, y: e.clientY } : a;
        const b1 = e.pointerId === idb ? { x: e.clientX, y: e.clientY } : b;
        const g = twoFinger(a, b, a1, b1);
        walkRuntime.yawDelta += -g.dAng - g.mid.dx * DRAG_YAW;
        // WALK-SCALE: iki parmak dikey sürükleme bakışı eğer (yukarı sürükle → yukarı bak); fotoğraf modunda WalkRig yok sayar
        walkRuntime.lookDelta += -g.mid.dy * DRAG_PITCH;
        walkRuntime.zoomMul *= g.scale;
      }
      p.x = e.clientX; p.y = e.clientY;
    };
    const up = (e: PointerEvent) => {
      if (!pts.delete(e.pointerId)) return;
      clearLong();
      if (longFired) {
        // uzun basma çarkı açtı: aynı dokunuşun "oraya yürü" tıklaması iptal (R3F tıklaması bu olaydan sonra gelir)
        longFired = false;
        // parmağın altında açılan çarkın düğmesine "tıklama" düşmesin (çark parmağın altında açılır)
        const stop = (ev: Event) => { ev.preventDefault(); ev.stopPropagation(); };
        window.addEventListener("click", stop, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 600);
        window.setTimeout(() => { const s = useWalkStore.getState(); if (s.target) s.setTarget(null); walkRuntime.avatar.route = null; }, 0);
      }
    };
    // WALK-ZOOM: fare tekerleği takip mesafesini, profil sınırının ötesinde (açık havada) kuş bakışını değiştirir (WalkRig tüketir).
    // Fotoğraf modunun kendi tekerleği var (PhotoMode); panel/düğme üstünde sayfa kayar.
    const wheel = (e: WheelEvent) => {
      const st = useWalkStore.getState();
      if (!st.active || st.photo || e.ctrlKey || !inWorld(e.target)) return;
      e.preventDefault(); e.stopPropagation();
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      walkRuntime.zoomMul *= Math.exp(Math.max(-120, Math.min(120, dy)) * 0.0014);
    };
    el.addEventListener("wheel", wheel, { capture: true, passive: false });
    el.addEventListener("pointerdown", down, true);
    el.addEventListener("pointermove", move, true);
    el.addEventListener("pointerup", up, true);
    el.addEventListener("pointercancel", up, true);
    return () => {
      el.removeEventListener("wheel", wheel, { capture: true });
      clearLong();
      el.removeEventListener("pointerdown", down, true);
      el.removeEventListener("pointermove", move, true);
      el.removeEventListener("pointerup", up, true);
      el.removeEventListener("pointercancel", up, true);
    };
  }, [host, enabled]);
}
