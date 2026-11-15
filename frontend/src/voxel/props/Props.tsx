/**
 * S33 — canlı dekor: sahne kurucunun bıraktığı işaretlerden (`Built.props`, scenes.ts `PropMark`) çizilir.
 *   · ekranlar: tek InstancedMesh + paylaşılan kod dokusu; sahibi çalışırken kod kayar (gölgelendiricide, CPU'suz),
 *     boştayken kısık; renk/hız yalnızca istasyon durumları değişince yazılır
 *   · LED'ler (sunucu dolabı, kahve makinesi): tek InstancedMesh, ≈ 8 Hz yanıp söner
 *   · sandalyeler: sandalyesi olmayan HER istasyona (her sahne, modüller, kullanıcı dünyaları) tek InstancedMesh
 *   · gece: lamba ve çalışan ekranların altında ışık havuzları + yanan pencereler + yıldızlar TEK InstancedMesh'te
 *     (SP-W1: toplamalı "gece parıltısı" katmanı; örnek başına tür `aGlow`: 0 dokulu havuz, 0–1 düz pencere (alfa),
 *     2 sissiz dokulu yıldız) + en çok 4 nokta ışık. Gece eskiden 3 çizim çağrısıydı (havuz, pencere, drei Stars); şimdi 1.
 *   · duvar skor panosu: tuval dokusu, en çok saniyede bir (yalnızca içerik değişince) yeniden çizilir
 * Hepsi tek useFrame'de; hareket azaltmada ekranlar durağan, LED'ler sabit yanar, lambalar titremez.
 */
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import * as THREE from "three";
import { currentLocale } from "../../lib/i18n";
import type { Mood } from "../../lib/types";
import { lampKey, lampSwitch } from "../ambient/lampSwitch";
import { reducedMotion } from "../motion";
import { rng, tx as tileX, tz, type Built, type PropMark } from "../scenes";
import { BOARD_H, BOARD_W, boardClock, boardSig, drawBoard, useBoardData } from "./scoreboard";

// ------------------------------------------------------------------ paylaşılan dokular
function rand(seed: number) {
  return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
}

let codeTex: THREE.CanvasTexture | null = null;
/** Koyu zeminde renkli kod satırları (dikey döşenir; ekran penceresi kayar). */
function codeTexture(): THREE.CanvasTexture {
  if (codeTex) return codeTex;
  const c = document.createElement("canvas");
  c.width = 64; c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#0B1220"; g.fillRect(0, 0, 64, 256);
  const r = rand(7);
  const COLORS = ["#7DD3FC", "#A78BFA", "#FBBF24", "#34D399", "#F472B6", "#E2E8F0", "#E2E8F0", "#94A3B8"];
  let indent = 4;
  for (let y = 3; y < 252; y += 6) {
    if (r() < 0.12) continue; // boş satır
    indent = Math.max(4, Math.min(22, indent + (r() < 0.3 ? 4 : r() < 0.3 ? -4 : 0)));
    let x = indent;
    const tokens = 1 + Math.floor(r() * 4);
    for (let k = 0; k < tokens && x < 58; k++) {
      const w = Math.min(58 - x, 4 + Math.floor(r() * 14));
      g.fillStyle = COLORS[Math.floor(r() * COLORS.length)];
      g.fillRect(x, y, w, 3);
      x += w + 3;
    }
  }
  codeTex = new THREE.CanvasTexture(c);
  codeTex.wrapS = THREE.ClampToEdgeWrapping;
  codeTex.wrapT = THREE.RepeatWrapping;
  codeTex.magFilter = THREE.NearestFilter;
  codeTex.minFilter = THREE.LinearFilter;
  codeTex.generateMipmaps = false;
  codeTex.colorSpace = THREE.SRGBColorSpace;
  return codeTex;
}

let poolTex: THREE.CanvasTexture | null = null;
function poolTexture(): THREE.CanvasTexture {
  if (poolTex) return poolTex;
  const c = document.createElement("canvas");
  c.width = 64; c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.45, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  poolTex = new THREE.CanvasTexture(c);
  return poolTex;
}

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const Y = new THREE.Vector3(0, 1, 0);
const FLAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const X = new THREE.Vector3(1, 0, 0);
const ORIGIN = new THREE.Vector3();
const _look = new THREE.Matrix4();

/** Ekran durumu: [r, g, b] çarpanı + kayma hızı (sn başına doku payı). */
const SCREEN: Record<Mood | "none", [number, number, number, number]> = {
  working: [1, 1, 1, 0.16], thinking: [0.72, 0.84, 1, 0.045], waiting: [1, 0.84, 0.48, 0], done: [0.78, 1, 0.78, 0],
  error: [1, 0.58, 0.52, 0], idle: [0.2, 0.22, 0.28, 0], offline: [0.07, 0.08, 0.1, 0], none: [0.07, 0.08, 0.1, 0],
};
const BUSY = new Set<Mood>(["working", "thinking", "waiting"]);

/** SP-W1: gece gökyüzü yıldızları (World.tsx; eskiden drei `<Stars>`, ayrı çizim çağrısı). Yarıçap + kalınlık + sayı. */
export interface StarField { radius: number; depth: number; count: number }

export interface PropsProps {
  built: Built;
  /** istasyon sırası → o istasyondaki ajanın durumu (yoksa null) */
  stationMood: (Mood | null)[];
  night: boolean;
  /** sahnenin sandalye tarzı */
  chair: "office" | "wood";
  /** panodaki aktif ajan sayısı (S35 verisi yoksa) */
  active: number;
  /** gece yıldızları (yoksa çizilmez); gece parıltısı katmanına katılır */
  stars?: StarField | null;
}

export function Props({ built, stationMood, night, chair, active, stars }: PropsProps) {
  const marks = built.props ?? EMPTY;
  const screens = useMemo(() => marks.filter((m) => m.k === "screen"), [marks]);
  const leds = useMemo(() => marks.filter((m) => m.k === "led"), [marks]);
  const lamps = useMemo(() => marks.filter((m) => m.k === "lamp"), [marks]);
  const boards = useMemo(() => marks.filter((m) => m.k === "board"), [marks]);
  const wins = useMemo(() => marks.filter((m) => m.k === "window"), [marks]);
  const starN = stars?.count ?? 0;
  // dokunuşla kapatılan lambalar: havuz ve nokta ışığı da söner
  const lampVer = useSyncExternalStore(lampSwitch.subscribe, lampSwitch.version);
  // ekran → en yakın istasyon (masadaki monitör; ≤ 1,6 birim)
  const owners = useMemo(() => screens.map((m) => {
    let best = -1, bd = 1.6;
    built.stations.forEach((s, i) => {
      const d = Math.hypot(tileX(s.tile[0]) - m.p[0], tz(s.tile[1]) - m.p[2]);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }), [screens, built]);
  // sandalyesi olmayan istasyonlar
  const seats = useMemo(() => {
    const chairs = marks.filter((m) => m.k === "chair");
    // S41: bank, şezlong, örtü ve ayakta konsol istasyonlarına ve kendi oturağını çizen (y verilmiş: tabure, kamp
    // sandalyesi) istasyonlara sandalye çizilmez
    return built.stations.filter((s) => (!s.pose || s.pose === "sit_chair") && s.y === undefined
      && !chairs.some((c) => Math.hypot(c.p[0] - tileX(s.tile[0]), c.p[2] - tz(s.tile[1])) < 0.45));
  }, [marks, built]);

  const time = useRef({ value: 0 });
  const screenRef = useRef<THREE.InstancedMesh>(null);
  const ledRef = useRef<THREE.InstancedMesh>(null);
  const chairRef = useRef<THREE.InstancedMesh>(null);
  const poolRef = useRef<THREE.InstancedMesh>(null);
  const blink = useRef({ at: -1, calm: false });

  // ---- malzemeler (paylaşılan; bileşen başına bir kez)
  const screenMat = useMemo(() => {
    const m = new THREE.MeshBasicMaterial({ map: codeTexture(), toneMapped: false });
    const uTime = time.current;
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uTime;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec2 aScr;\nuniform float uTime;")
        .replace("#include <uv_vertex>", "#include <uv_vertex>\n\tvMapUv = vec2(uv.x, uv.y * 0.3 + fract(aScr.x - uTime * aScr.y));");
    };
    m.customProgramCacheKey = () => "vc-screen-scroll";
    return m;
  }, []);
  const ledMat = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), []);
  const chairMat = useMemo(() => new THREE.MeshLambertMaterial(), []);
  const poolMat = useMemo(() => {
    const m = new THREE.MeshBasicMaterial({
      map: poolTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    });
    // SP-W1 gece parıltısı: aGlow 0 → dokulu havuz; 0 < aGlow < 1.5 → düz dikdörtgen (alfa = aGlow; pencere);
    // aGlow ≥ 1.5 → dokulu ve sissiz (uzak yıldız)
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float aGlow;\nvarying float vGlow;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\n\tvGlow = aGlow;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vGlow;")
        .replace("#include <map_fragment>", [
          "#ifdef USE_MAP",
          "\tvec4 sampledDiffuseColor = texture2D( map, vMapUv );",
          "\tdiffuseColor *= ( vGlow > 0.0 && vGlow < 1.5 ) ? vec4( 1.0, 1.0, 1.0, vGlow ) : sampledDiffuseColor;",
          "#endif",
        ].join("\n"))
        .replace("#include <fog_fragment>", "if ( vGlow < 1.5 ) {\n#include <fog_fragment>\n}");
    };
    m.customProgramCacheKey = () => "vc-night-glow";
    return m;
  }, []);
  useEffect(() => () => { screenMat.dispose(); ledMat.dispose(); chairMat.dispose(); poolMat.dispose(); }, [screenMat, ledMat, chairMat, poolMat]);

  const screenGeo = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1);
    g.setAttribute("aScr", new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, screens.length) * 2), 2));
    return g;
  }, [screens.length]);
  useEffect(() => () => screenGeo.dispose(), [screenGeo]);
  const glowCap = Math.max(1, lamps.length + screens.length + boards.length + wins.length + starN);
  const poolGeo = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1);
    g.setAttribute("aGlow", new THREE.InstancedBufferAttribute(new Float32Array(glowCap), 1));
    return g;
  }, [glowCap]);
  useEffect(() => () => poolGeo.dispose(), [poolGeo]);

  // ---- ekran matrisleri (yerleşim değişince)
  useEffect(() => {
    const mesh = screenRef.current;
    if (!mesh) return;
    screens.forEach((m, i) => {
      _q.setFromAxisAngle(Y, m.r);
      mesh.setMatrixAt(i, _m.compose(_p.set(...m.p), _q, _s.set(m.s?.[0] ?? 0.6, m.s?.[1] ?? 0.4, 1)));
    });
    mesh.count = screens.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [screens]);

  // ---- ekran durumları (yalnızca istasyon durumları değişince)
  const moodSig = owners.map((o) => (o >= 0 ? stationMood[o] ?? "none" : "none")).join(",");
  const calmNow = reducedMotion();
  useEffect(() => {
    const mesh = screenRef.current;
    if (!mesh) return;
    const attr = screenGeo.getAttribute("aScr") as THREE.InstancedBufferAttribute;
    owners.forEach((o, i) => {
      const mood = (o >= 0 ? stationMood[o] : null) ?? "none";
      const [r, g, b, speed] = SCREEN[mood];
      mesh.setColorAt(i, _c.setRGB(r, g, b));
      attr.setXY(i, ((i * 0.618) % 1), calmNow ? 0 : speed * (0.8 + ((i * 37) % 10) / 25));
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    attr.needsUpdate = true;
  }, [moodSig, calmNow, screenGeo]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- LED matrisleri
  useEffect(() => {
    const mesh = ledRef.current;
    if (!mesh) return;
    leds.forEach((m, i) => {
      _q.setFromAxisAngle(Y, m.r);
      mesh.setMatrixAt(i, _m.compose(_p.set(...m.p), _q, _s.set(0.05, 0.035, 0.02)));
      mesh.setColorAt(i, _c.set(m.c ?? "#34D399"));
    });
    mesh.count = leds.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    blink.current.at = -1;
  }, [leds]);

  // ---- çalışma anı sandalyeleri (istasyonun bakış yönüne göre; sırtlık arkada)
  useEffect(() => {
    const mesh = chairRef.current;
    if (!mesh) return;
    const seatC = chair === "office" ? "#2B2F3A" : "#8B5E3C";
    const baseC = chair === "office" ? "#111827" : "#6B4F3A";
    const PARTS: [number, number, number, number, number, number, string][] = [
      [0, 0.03, 0, 0.5, 0.05, 0.08, baseC], [0, 0.03, 0, 0.08, 0.05, 0.5, baseC], [0, 0.15, 0.06, 0.07, 0.22, 0.07, "#4B5563"],
      [0, 0.27, 0.08, 0.56, 0.08, 0.52, seatC], [0, 0.56, -0.2, 0.54, 0.5, 0.08, seatC],
    ];
    let n = 0;
    const off = new THREE.Vector3();
    for (const s of seats) {
      _q.setFromAxisAngle(Y, s.face);
      for (const [x, y, z, w, h, d, c] of PARTS) {
        off.set(x, y, z).applyQuaternion(_q);
        mesh.setMatrixAt(n, _m.compose(_p.set(tileX(s.tile[0]) + off.x, y, tz(s.tile[1]) + off.z), _q, _s.set(w, h, d)));
        mesh.setColorAt(n, _c.set(c));
        n++;
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [seats, chair]);

  // ---- gece ışık havuzları
  useEffect(() => {
    const mesh = poolRef.current;
    if (!mesh || !night) return;
    let n = 0;
    const kind = (poolGeo.getAttribute("aGlow") as THREE.InstancedBufferAttribute).array as Float32Array;
    const put = (x: number, z: number, radius: number, color: string, k: number) => {
      mesh.setMatrixAt(n, _m.compose(_p.set(x, 0.02 + n * 0.0004, z), FLAT, _s.set(radius * 2, radius * 2, 1)));
      mesh.setColorAt(n, _c.set(color).multiplyScalar(k));
      kind[n] = 0;
      n++;
    };
    for (const l of lamps) if (!lampSwitch.isOff(lampKey(l.p[0], l.p[2]))) put(l.p[0], l.p[2], l.s?.[0] ?? 1.6, l.c ?? "#FDE68A", 0.55);
    screens.forEach((m, i) => {
      const o = owners[i];
      const mood = o >= 0 ? stationMood[o] : null;
      if (!mood || !BUSY.has(mood)) return;
      const back = Math.sin(m.r) * 0.45, fwd = Math.cos(m.r) * 0.45;
      put(m.p[0] + back, m.p[2] + fwd, 1.05, "#6FB7FF", 0.5);
    });
    for (const b of boards) put(b.p[0], b.p[2] + 1.3, 2.2, "#5EEAD4", 0.22);
    // S42 yanan pencereler (çok katlı binalar, vitrinler): cam önünde sıcak, düz, yarı saydam dikdörtgen
    for (const w of wins) {
      _q.setFromAxisAngle(Y, w.r);
      mesh.setMatrixAt(n, _m.compose(_p.set(w.p[0], w.p[1], w.p[2]), _q, _s.set(w.s?.[0] ?? 0.7, w.s?.[1] ?? 1, 1)));
      mesh.setColorAt(n, _c.set(w.c ?? "#FFD98A"));
      kind[n++] = 0.55;
    }
    // yıldızlar: dünya merkezli küre kabuğu (belirlenimci), düzlem merkeze bakar; sis yok
    if (stars && starN) {
      const r = rng(4242);
      for (let k = 0; k < starN; k++) {
        const u = r() * 2 - 1, a = r() * Math.PI * 2, rad = stars.radius + r() * stars.depth, h = Math.sqrt(1 - u * u);
        _p.set(Math.cos(a) * h * rad, u * rad, Math.sin(a) * h * rad);
        _look.lookAt(ORIGIN, _p, Math.abs(u) > 0.98 ? X : Y);
        _q.setFromRotationMatrix(_look);
        const size = 0.55 + r() * 0.9;
        mesh.setMatrixAt(n, _m.compose(_p, _q, _s.set(size, size, 1)));
        mesh.setColorAt(n, _c.setRGB(1, 1, 1).multiplyScalar(0.7 + r() * 1.3));
        kind[n++] = 2;
      }
    }
    (poolGeo.getAttribute("aGlow") as THREE.InstancedBufferAttribute).needsUpdate = true;
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [night, lamps, screens, boards, owners, moodSig, wins, stars, starN, poolGeo, lampVer]); // eslint-disable-line react-hooks/exhaustive-deps

  // gece nokta ışıkları: önce ayaklı lambalar, sonra masa lambaları (en çok 4; gölgelendirici bütçesi)
  const nightLights = useMemo(() => [...lamps].sort((a, b) => (b.s?.[0] ?? 0) - (a.s?.[0] ?? 0)).slice(0, 4), [lamps]);

  // ---- skor panosu
  const board = useBoardData(active);
  const boardTex = useMemo(() => {
    if (!boards.length) return null;
    const c = document.createElement("canvas");
    c.width = BOARD_W; c.height = BOARD_H;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, [boards.length]);
  const boardMat = useMemo(() => (boardTex ? new THREE.MeshBasicMaterial({ map: boardTex, toneMapped: false }) : null), [boardTex]);
  useEffect(() => () => { boardTex?.dispose(); boardMat?.dispose(); }, [boardTex, boardMat]);
  const boardState = useRef({ sig: "", at: -10, data: board });
  boardState.current.data = board;

  // ---- tek kare döngüsü
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const calm = reducedMotion();
    if (!calm) time.current.value = t;
    // LED: ≈ 8 Hz, her LED kendi ritminde (hareket azaltmada sabit yanar)
    const lm = ledRef.current;
    if (lm && leds.length) {
      const b = blink.current;
      if (calm) {
        if (!b.calm) { leds.forEach((m, i) => lm.setColorAt(i, _c.set(m.c ?? "#34D399"))); if (lm.instanceColor) lm.instanceColor.needsUpdate = true; b.calm = true; }
      } else if (t - b.at > 0.125) {
        b.at = t; b.calm = false;
        leds.forEach((m, i) => {
          const rate = 1.5 + ((i * 7919) % 13) / 2.2;
          const h = Math.sin((Math.floor(t * rate) + i * 17.17) * 12.9898) * 43758.5453;
          const on = h - Math.floor(h) > 0.32;
          lm.setColorAt(i, _c.set(m.c ?? "#34D399").multiplyScalar(on ? 1 : 0.16));
        });
        if (lm.instanceColor) lm.instanceColor.needsUpdate = true;
      }
    }
    // pano: saniyede en çok bir kez, yalnızca içerik değişince
    const bs = boardState.current;
    if (boardTex && t - bs.at >= 1) {
      bs.at = t;
      const clock = boardClock();
      const sig = boardSig(bs.data, clock, currentLocale());
      if (sig !== bs.sig) {
        bs.sig = sig;
        const ctx = (boardTex.image as HTMLCanvasElement).getContext("2d");
        if (ctx) { drawBoard(ctx, bs.data, clock); boardTex.needsUpdate = true; }
      }
    }
  });

  return (
    <>
      {screens.length > 0 && (
        <instancedMesh key={`s${screens.length}`} ref={screenRef} args={[screenGeo, screenMat, screens.length]} />
      )}
      {leds.length > 0 && <instancedMesh key={`l${leds.length}`} ref={ledRef} args={[unitBox, ledMat, leds.length]} />}
      {seats.length > 0 && (
        <instancedMesh key={`c${seats.length}:${chair}`} ref={chairRef} args={[unitBox, chairMat, seats.length * 5]} castShadow receiveShadow />
      )}
      {night && (
        <instancedMesh key={`p${glowCap}`} ref={poolRef} args={[poolGeo, poolMat, glowCap]} renderOrder={2} frustumCulled={false} />
      )}
      {/* kapalı lambada ışık sayısı aynı kalır (gölgelendirici yeniden derlenmez), yalnız şiddet 0 */}
      {night && nightLights.map((l, i) => (
        <pointLight key={`nl${i}`} position={[l.p[0], l.p[1] + 0.2, l.p[2]]} color={l.c ?? "#FDE68A"}
          intensity={lampSwitch.isOff(lampKey(l.p[0], l.p[2])) ? 0 : (l.s?.[0] ?? 1) >= 2 ? 5 : 2.6}
          distance={(l.s?.[0] ?? 1) >= 2 ? 7 : 4} decay={1.6} />
      ))}
      {boardMat && boards.map((b, i) => (
        <mesh key={`b${i}`} position={b.p} rotation-y={b.r} material={boardMat}>
          <planeGeometry args={[b.s?.[0] ?? 2.2, b.s?.[1] ?? 1]} />
        </mesh>
      ))}
    </>
  );
}

const EMPTY: PropMark[] = [];

