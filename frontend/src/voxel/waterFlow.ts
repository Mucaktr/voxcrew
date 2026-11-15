/**
 * CEOGOZU — akan su efekti (ürün sahibi: "dere, nehir kanalı, çeşme, şelalede suya akış efekti"). Su mesh'i artık sallanmaz (kıyı/köprü yüzleriyle
 * titreşiyordu); hareket YALNIZ doku kayması: üst yüzde dünya koordinatında, kutunun uzun ekseni boyunca kayan açık dalga şeritleri
 * (shader yaması; kare başına CPU işi yok, ek çizim çağrısı yok). Hareket azaltmada zaman donar (şeritler durağan kalır).
 * Yama `installCutaway` ile aynı zincirleme düzenini kullanır (önceki onBeforeCompile korunur).
*/
import type * as THREE from "three";

/** Paylaşılan zaman tekeri (sn); `tickWaterFlow` her karede yazar. */
export const waterFlowUniforms = { uWfTime: { value: 0 }, uWfAmp: { value: 1 } };
/** Kareden kareye çağrılır (birden çok çağrı zararsız: aynı değer). `calm`: hareket azaltma → zaman 0'da donar. */
export function tickWaterFlow(t: number, calm: boolean): void {
  waterFlowUniforms.uWfTime.value = calm ? 0 : t;
}

const DECL_V = "varying vec3 vWfPos;\nvarying vec2 vWfDir;\nvarying float vWfUp;\nvarying float vWfFall;";
const BODY_V = `{
  vec4 wf = vec4(transformed, 1.0);
  vec2 wsc = vec2(1.0);
  float wsy = 1.0;
  #ifdef USE_INSTANCING
    wf = instanceMatrix * wf;
    wsc = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[2].xyz));
    wsy = length(instanceMatrix[1].xyz);
  #endif
  vWfPos = (modelMatrix * wf).xyz;
  vWfDir = wsc.x >= wsc.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vWfUp = normal.y;
  // BAROK-1: ince dikey su perdesi (çağlayan; bir yatay eksen ≤ 0,08, öteki ≥ 0,2, boy ≥ 0,1) yan yüzünde aşağı akan şeritler
  vWfFall = (min(wsc.x, wsc.y) <= 0.08 && max(wsc.x, wsc.y) >= 0.2 && wsy >= 0.1) ? 1.0 : 0.0;
}`;
const DECL_F = "uniform float uWfTime;\nuniform float uWfAmp;\nvarying vec3 vWfPos;\nvarying vec2 vWfDir;\nvarying float vWfUp;\nvarying float vWfFall;";
const BODY_F = `if (vWfUp > 0.5) {
  vec2 wp = vWfPos.xz;
  float al = dot(wp, vWfDir), ac = dot(wp, vec2(vWfDir.y, vWfDir.x));
  float wa = sin(al * 5.0 - uWfTime * 1.7 + sin(ac * 3.1 + uWfTime * 0.45) * 1.3);
  float wb = sin(al * 9.5 - uWfTime * 2.6 + ac * 2.3);
  float wf = smoothstep(0.5, 1.0, wa * 0.6 + wb * 0.4);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), wf * 0.16 * uWfAmp);
  diffuseColor.rgb *= 1.0 - 0.05 * (0.5 + 0.5 * wa) * uWfAmp;
} else if (vWfFall > 0.5 && abs(vWfUp) < 0.5) {
  float ac = dot(vWfPos.xz, vWfDir);
  float fa = sin(vWfPos.y * 9.0 + uWfTime * 4.2 + sin(ac * 6.3) * 2.1);
  float fb = sin(vWfPos.y * 17.0 + uWfTime * 6.1 + ac * 11.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), smoothstep(0.35, 1.0, fa * 0.6 + fb * 0.4) * 0.3 * uWfAmp);
}`;

export function patchWaterVertex(src: string): string {
  if (src.includes("vWfPos")) return src;
  return src.replace("#include <common>", `#include <common>\n${DECL_V}`).replace("#include <project_vertex>", `#include <project_vertex>\n${BODY_V}`);
}
export function patchWaterFragment(src: string): string {
  if (src.includes("vWfPos")) return src;
  return src.replace("#include <common>", `#include <common>\n${DECL_F}`).replace("#include <color_fragment>", `#include <color_fragment>\n${BODY_F}`);
}

/** Su malzemesine akış yaması (tek sefer; `installCutaway`'den ÖNCE ya da sonra çağrılabilir, zincir korunur). */
export function installWaterFlow(material: THREE.Material): void {
  if (material.userData.waterFlow) return;
  material.userData.waterFlow = true;
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    Object.assign(shader.uniforms, waterFlowUniforms);
    shader.vertexShader = patchWaterVertex(shader.vertexShader);
    shader.fragmentShader = patchWaterFragment(shader.fragmentShader);
  };
  material.customProgramCacheKey = () => `${prevKey.call(material)}|water-flow-2`;
  material.needsUpdate = true;
}
