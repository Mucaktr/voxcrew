/**
 * Doku atlası (S13): yüz (20×20), burun (8×6) ve gövde ön yüzü (16×16) piksel çizimleri tek bir tuvale
 * yerleşir; kalabalık çizici bütün dokulu dörtgenleri tek InstancedMesh + örnek başına UV ile çizer.
 * Çizim fonksiyonları pixels.ts ile aynıdır, bu yüzden tek karakter (Character.tsx) ve kalabalık birebir aynı görünür.
 */
import * as THREE from "three";
import type { Avatar } from "../lib/types";
import { drawBody, drawFace, drawSnout, type Face } from "./pixels";

export const TILE = 20;
const SIZE = 1024;
const COLS = Math.floor(SIZE / TILE);
const CAPACITY = COLS * COLS;

/** [u0, v0, su, sv] — PlaneGeometry uv'si bununla ölçeklenip kaydırılır (flipY dikkate alınmıştır). */
export type UvRect = [number, number, number, number];

type Px = (x: number, y: number, c: string, a?: number) => void;

export class TextureAtlas {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private slots = new Map<string, UvRect>();
  private used = 0;
  private dirty = false;
  /** atlas sıfırlanınca artar; eski UV'ler geçersizdir */
  generation = 0;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    this.ctx = this.canvas.getContext("2d")!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false;
  }

  private alloc(key: string, w: number, h: number, draw: (px: Px) => void): UvRect {
    const hit = this.slots.get(key);
    if (hit) return hit;
    if (this.used >= CAPACITY) {
      // dolunca sıfırla: karakterler bir sonraki karede UV'lerini yeniden ister
      this.ctx.clearRect(0, 0, SIZE, SIZE);
      this.slots.clear();
      this.used = 0;
      this.generation++;
    }
    const i = this.used++;
    const ox = (i % COLS) * TILE, oy = Math.floor(i / COLS) * TILE;
    const ctx = this.ctx;
    draw((x, y, c, a = 1) => {
      ctx.globalAlpha = a;
      ctx.fillStyle = c;
      ctx.fillRect(ox + x, oy + y, 1, 1);
      ctx.globalAlpha = 1;
    });
    // flipY: doku v ekseni tuvalin alt kenarından başlar
    const rect: UvRect = [ox / SIZE, 1 - (oy + h) / SIZE, w / SIZE, h / SIZE];
    this.slots.set(key, rect);
    this.dirty = true;
    return rect;
  }

  face(a: Avatar, face: Face): UvRect {
    return this.alloc(`f|${a.species}|${a.skin}|${a.hairColor}|${face}`, TILE, TILE, (px) => drawFace(px, a, face));
  }
  snout(face: Face): UvRect {
    return this.alloc(`s|${face}`, 8, 6, (px) => drawSnout(px, face));
  }
  body(a: Avatar): UvRect {
    return this.alloc(`b|${a.outfit}|${a.outfitColor}|${a.accent}|${a.skin}`, 16, 16, (px) => drawBody(px, a));
  }

  /** Kare sonunda bir kez çağrılır: yeni çizim varsa GPU'ya yüklenir. */
  flush() {
    if (this.dirty) { this.texture.needsUpdate = true; this.dirty = false; }
  }

  dispose() { this.texture.dispose(); }
}
