/**
 * Piksel sanatı çizimlerinden (pixels.ts) üretilen three.js dokuları. 2B ikon yolu (PixelFace) three'yi
 * yüklemesin diye ayrı dosyadadır; çizim fonksiyonları ortaktır.
 */
import * as THREE from "three";
import type { Avatar } from "../lib/types";
import { drawBody, drawFace, drawSnout, painter, type Face } from "./pixels";

type Px = Parameters<typeof drawSnout>[0];

const cache = new Map<string, THREE.CanvasTexture>();

function texture(key: string, w: number, h: number, draw: (px: Px) => void): THREE.CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  draw(painter(ctx));
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  if (cache.size > 400) cache.clear();
  cache.set(key, tex);
  return tex;
}

export function faceTexture(a: Avatar, face: Face) {
  return texture(`f|${a.species}|${a.skin}|${a.hairColor}|${face}`, 20, 20, (px) => drawFace(px, a, face));
}
export function snoutTexture(face: Face) {
  return texture(`s|${face}`, 8, 6, (px) => drawSnout(px, face));
}
export function bodyTexture(a: Avatar) {
  return texture(`b|${a.outfit}|${a.outfitColor}|${a.accent}|${a.skin}`, 16, 16, (px) => drawBody(px, a));
}
