/**
 * (ürün sahibi: "deniz ya da su olan yerler uzaktan taş gibi görünüyor yakınlaştıkça suya dönüyor") — uzak suyun malzemesi.
 *
 * - Silüet katmanı (`HorizonLayer`) su bloklarını opak silüet malzemesinden AYIRIR: yakın suyla aynı malzeme (`GROUP_ALPHA.water`
 * saydamlığı + `waterFlow` akış şeritleri), üstüne kuyruk geçişi ve pus sınırı (+1 çizim çağrısı).
 * - Kıyı şehrinin deniz düzlemi (`World.tsx`, `SceneDef.ocean`) aynı akış şeritlerini ve opak bloklarla aynı ışık tabanını taşır;
 * yakın su (saydam) bu düzlemin üstünde durduğundan iki yüzün şeritleri aynı dünya konumunda çakışır → dikiş okunmaz.
 * - Denetim: WATER-FAR-001 (scripts/water_far.test.mjs) bu fabrikaları ve parsel uzak LOD'unu doğrudan sürer.
*/
import * as THREE from "three";
import { GROUP_ALPHA } from "../blockAlpha";
import { AMBIENT_FLOOR } from "../props/fillLight";
import { installWaterFlow } from "../waterFlow";
import type { Block } from "../scenes";

/** Silüet bloklarını opak gövde ve su olarak ayırır (su kendi malzemesiyle çizilir). */
export function splitSilhouette(blocks: readonly Block[]): { solid: Block[]; water: Block[] } {
  const solid: Block[] = [], water: Block[] = [];
  for (const b of blocks) (b.g === "water" ? water : solid).push(b);
  return { solid, water };
}

/** Uzak (silüet) su malzemesi: yakın su grubuyla aynı saydamlık + akış. */
export function farWaterMaterial(): THREE.MeshLambertMaterial {
  const a = GROUP_ALPHA.water;
  const m = new THREE.MeshLambertMaterial({ transparent: a.transparent, opacity: a.opacity, depthWrite: a.depthWrite });
  installWaterFlow(m);
  return m;
}

/** Deniz düzlemi malzemesi: opak, ışık tabanı opak bloklarla aynı, yakın suyla aynı akış şeritleri. */
export function oceanMaterial(color: string): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ color, emissive: new THREE.Color(AMBIENT_FLOOR, AMBIENT_FLOOR, AMBIENT_FLOOR) });
  installWaterFlow(m);
  return m;
}

/** Deniz düzlemi geometrisi: önceden yatırılmış (nesne normali +y → akış yaması üst yüzü tanır). */
export function oceanGeometry(size: number): THREE.PlaneGeometry {
  return new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2);
}
