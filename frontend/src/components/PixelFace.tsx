import clsx from "clsx";
import { useEffect, useRef } from "react";
import type { Avatar, Mood } from "../lib/types";
import { normalizeAvatar } from "../voxel/avatar";
import { drawHeadIcon, MOOD_FACE } from "../voxel/pixels";

/** 3B karakterle aynı piksel çizimini kullanan 2B kafa ikonu. */
export function PixelFace({ avatar, mood = "idle", size = 40, ring, className }:
  { avatar?: Partial<Avatar> | null; mood?: Mood; size?: number; ring?: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const a = normalizeAvatar(avatar);
  const sig = JSON.stringify(a) + mood;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    drawHeadIcon(ctx, a, MOOD_FACE[mood], 4);
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <span className={clsx("relative inline-grid place-items-center shrink-0 rounded-lg", className)}
      style={{ width: size, height: size, background: ring ? `color-mix(in srgb, ${ring} 18%, transparent)` : undefined,
               boxShadow: ring ? `inset 0 0 0 2px ${ring}` : undefined }}>
      <canvas ref={ref} width={112} height={112} className="pixelated" style={{ width: size * 0.86, height: size * 0.86 }} />
    </span>
  );
}
