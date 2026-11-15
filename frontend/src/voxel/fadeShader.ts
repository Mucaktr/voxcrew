/**
 * TOUR-VIEW (POP-IN-001) — titreşimli (dither) belirme/silinme gölgelendirici yaması ve uzak pus sınırı.
 *
 *  - `installTailFade`: örnek başına `tailFade` özniteliği (expanse/tail.ts anlamıyla: 0 → hep görünür, > 0 → belirme başlangıcı,
 *    < 0 → silinme başlangıcı, sn). Ekran uzayı 4 × 4 Bayer eşiği: belirmede eşik < ilerleme olan pikseller, silinmede tümleyeni
 *    çizilir — aynı anda biri belirip öteki silinince (uzak LOD ↔ yakın ayrıntı ↔ silüet) çapraz geçiş deliksiz ve çift kaplamasız.
 *    Malzeme opak kalır (saydam sıralama yok), çizim çağrısı değişmez. Kesit yaması (walk/cover.ts) bunun üstüne zincirlenir.
 *  - `installHazeCap`: doğrusal sisin katkısı `uHazeMax` ile sınırlı — silüet ve ufuk katmanı her uzaklıkta soluk bir siluet olarak
 *    görünür kalır (hava perspektifi; sis rengi gökyüzü rengidir, gece gece göğü).
 *
 * three r1xx yerleşik parçaları (`#include <common>`, `<begin_vertex>`, `<clipping_planes_fragment>`, `<fog_fragment>`) üzerinde
 * metin değiştirme; Lambert ve Basic malzemelerde aynı. Saf: yalnız three.
 */
import type * as THREE from "three";
import { tailFadeUniforms } from "./expanse/tail";

const NL = "\n";
export const TAIL_FADE_DECL = `uniform float uTailNow;${NL}uniform float uTailDur;${NL}varying float vTailFade;${NL}` +
  `float tvBayer(vec2 p) { vec2 q = floor(mod(p, 4.0)); float a = mod(q.x, 2.0), b = mod(q.y, 2.0), c = floor(q.x / 2.0), d = floor(q.y / 2.0);${NL}` +
  `  return (4.0 * mod(2.0 * a + 3.0 * b, 4.0) + mod(2.0 * c + 3.0 * d, 4.0) + 0.5) / 16.0; }`;
export const TAIL_FADE_BODY = `if (vTailFade != 0.0) { float tvT = clamp((uTailNow - abs(vTailFade)) / uTailDur, 0.0, 1.0); float tvB = tvBayer(gl_FragCoord.xy);${NL}` +
  `  if (vTailFade > 0.0 ? tvB >= tvT : tvB < tvT) discard; }`;

type Patchable = THREE.MeshLambertMaterial | THREE.MeshBasicMaterial;

/** Örnek başına `tailFade` titreşimli geçişi (bkz. dosya başı). */
export function installTailFade(m: Patchable): void {
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    Object.assign(shader.uniforms, tailFadeUniforms);
    shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>${NL}attribute float tailFade;${NL}varying float vTailFade;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>${NL}vTailFade = tailFade;`);
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>${NL}${TAIL_FADE_DECL}`)
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>${NL}${TAIL_FADE_BODY}`);
  };
  m.customProgramCacheKey = () => `${prevKey.call(m)}|tail-fade-1`;
}

/** Sis katkısı üst sınırı (0…1); `uniform` nesnesi paylaşılabilir. */
export function installHazeCap(m: Patchable, cap: { value: number }): void {
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    shader.uniforms.uHazeMax = cap;
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>${NL}uniform float uHazeMax;`)
      .replace("#include <fog_fragment>", `#ifdef USE_FOG${NL}  float hzF = smoothstep( fogNear, fogFar, vFogDepth );${NL}` +
        `  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, min( hzF, uHazeMax ) );${NL}#endif`);
  };
  m.customProgramCacheKey = () => `${prevKey.call(m)}|haze-cap-1`;
}
