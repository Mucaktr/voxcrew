/**
 * alt sayfa açıkken kadraj kaydırma. Dikey telefonda durak paneli (HUD `dock` yuvası) sahne bandının ortasına
 * biniyor ve avatarı örtüyordu (8/8 şehir). Kamera yerinden oynamaz: izdüşüm `setViewOffset` ile yalnız dikeyde kaydırılır, görüntü
 * yukarı kayar ve avatar panelin üstünde kalır. Panel kapanınca ofset kalkar. Etiketler ("Ben"), ışın seçimi ve `avatarBox` aynı
 * izdüşüm matrisini kullandığı için tutarlıdır. Hareket azaltmada geçiş yok (anında), değilse kısa yumuşatma.
 * Yürüme kapalı, birinci şahıs ya da fotoğraf modunda ofset hiç uygulanmaz. Saf hesap: `sheetLift.ts` (scripts/hud_fit.test.mjs).
*/
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { reducedMotion } from "../motion";
import { CHIBI_HEIGHT } from "./scale";
import { frameLift } from "./sheetLift";
import { useWalkStore, walkRuntime } from "./walkStore";

export function FrameLift() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const cur = useRef(0);
  const p = useRef(new THREE.Vector3());
  useEffect(() => () => { camera.clearViewOffset(); }, [camera]);
  useFrame(() => {
    const ws = useWalkStore.getState();
    let target = 0;
    const r = gl.domElement.getBoundingClientRect();
    const sheet = ws.active && ws.view !== "first" && !ws.photo
      ? (document.querySelector<HTMLElement>('[data-hud-zone="dock"]')?.firstElementChild as HTMLElement | null) : null;
    if (sheet && r.height > 0) {
      const sr = sheet.getBoundingClientRect();
      const a = walkRuntime.avatar, foot = walkRuntime.drawY, head = foot + CHIBI_HEIGHT * walkRuntime.humanScale;
      camera.updateMatrixWorld();
      const sy = (y: number) => { p.current.set(a.x, y, a.z).project(camera); return ((1 - p.current.y) / 2) * r.height + cur.current; };
      const top = sy(head), bottom = sy(foot);
      // panel avatarın sütununda değilse (geniş ekran, yan panel) kaydırma yok
      const ax = ((p.current.x + 1) / 2) * r.width + r.left;
      if (sr.height > 0 && sr.left <= ax && sr.right >= ax) {
        const host = gl.domElement.closest("section");
        const bar = parseFloat(host?.style.getPropertyValue("--walk-top") ?? "") || 56;
        target = frameLift(top, bottom, sr.top - r.top, bar, r.height);
      }
    }
    const next = reducedMotion() || Math.abs(target - cur.current) < 1 ? target : cur.current + (target - cur.current) * 0.25;
    const v = camera.view;
    if (next === cur.current && (!v || !v.enabled || (v.fullWidth === r.width && v.fullHeight === r.height))) return;
    cur.current = next;
    if (next < 0.5) camera.clearViewOffset();
    else camera.setViewOffset(r.width, r.height, 0, next, r.width, r.height);
  });
  return null;
}
