/**
 * SP-W0 — sahne set parçaları: hareketli nesneler (`Built.movers`, props/movers.ts) ve hava durumu parçacıkları
 * (`SceneDef.weather`, props/weather.ts) TEK örneklenmiş kutu dizisinde, tek `useFrame` ile. Sahnede ikisi de yoksa hiçbir
 * şey çizilmez (+0); varsa +1 çizim çağrısı. Matrisler doğrudan Float32 dizisine yazılır (kare başına nesne üretilmez).
 * - Hareket azaltma: hareketli nesneler `phase` konumunda durağan, parçacıklar kapalı, aurora durağan.
 * - Gece: hareketli nesnelerin pencereleri yanar (örnek rengi HDR çarpanı; ayrı malzeme yok), `dayOnly` (balon) gizlenir;
 * aurora yalnız gece görünür.
 * Parçacık hacmi kamerayı izler (40 × 30 birim): büyümüş dünyanın her yerinde aynı yoğunluk, sabit maliyet.
 * W3a-INT: `nightOnly` (SceneDef.weatherNightOnly) türleri gündüz gizli (aurora her zaman yalnız gece). Sis (`mist`) opak
 * levha görünmesin diye AYRI, ucuz yarı saydam dizide çizilir (yalnız sisli sahnede +1 çağrı; derinlik yazmaz, gölgesiz).
 * hava anı (props/weather.ts `momentNow`, `place` yer kimliği): sağanak ve kar taneleri AYNI dizide ek yuva (sahnede
 * dizi varsa +0 çağrı); sis anı parçacık değil, sahne sisinin mesafesini yaklaştıran durağan ton (+0). Sağanakta yerde su halkası
 * ve karda/kumda ayak izi `fx` havuzunda (fun/fx.ts; Crowd'un mevcut dizisi). Mini oyunda an yok; hareket azaltmada an
 * parçacığı, halka ve iz yok (sis tonu durağan kalır).
*/
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { waveY } from "../Blocks";
import { useReducedMotion } from "../motion";
import type { Mover, WeatherKind } from "../scenes";
import { DEFAULT_COLORS, samplePath, SHAPES, type Part } from "./movers";
import { MOMENT, momentNow, momentParticles, particleBudget, rainLevel, SNOW_GROUND, useWeatherFx, useWeatherMoments, type MomentKind } from "./weather";
import { createTrace, puddle, stepTrace, type FxState, type TraceSurface } from "../fun/fx";
import { useMinigame } from "../fun/minigames";
import { tileOf, type AmbientHook } from "../scenes";
import { walkProgress } from "../walk/scale";
import { moverFitOf, walkSampler } from "../walk/moverFit";
import { walkRuntime } from "../walk/walkStore";
import { flushDiff } from "../instanceDirty";

const unit = new THREE.BoxGeometry(1, 1, 1);
const VOL_W = 40, VOL_D = 30, VOL_H = 10;
const WET: ReadonlySet<string> = new Set(["ferry", "boat", "felucca"]);

interface Slot { kind: WeatherKind; n: number; from: number; moment?: boolean }
/** yarı saydam dizide çizilen türler (opak kutu olarak kötü görünenler) */
const SOFT: ReadonlySet<WeatherKind> = new Set<WeatherKind>(["mist"]);

function hash(n: number) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

/** an türü → parçacık türü (sis parçacık değil)*/
const MOMENT_FX: Record<MomentKind, WeatherKind | null> = { shower: "rain", flurry: "snow", mist: null };

export function SceneFx({ movers, weather, night, nightOnly, place, fx, ambient }: { movers?: Mover[]; weather?: readonly WeatherKind[]; night: boolean;
  nightOnly?: readonly WeatherKind[]; place?: string | null; fx?: FxState; ambient?: readonly AmbientHook[] }) {
  const reduced = useReducedMotion();
  // hava anı (5 sn'de bir yoklanır; kare başına yoğunluk useFrame'de). Hava ya da anlar kapalıysa yok.
  const weatherOn = useWeatherFx((s) => s.on), momentsOn = useWeatherMoments((s) => s.on);
  const [moment, setMoment] = useState<MomentKind | null>(null);
  useEffect(() => {
    if (!place || !weatherOn || !momentsOn) { setMoment(null); return; }
    const poll = () => setMoment(useMinigame.getState().kind ? null : momentNow(place)?.kind ?? null);
    poll();
    const id = window.setInterval(poll, 5000);
    return () => window.clearInterval(id);
  }, [place, weatherOn, momentsOn]);
  const momentKind = moment ? MOMENT_FX[moment] : null;
  const momentN = momentKind ? momentParticles(weather, moment) : 0;
  const list = movers ?? [];
  const parts = useMemo(() => list.map((m) => SHAPES[m.shape] ?? []), [list]); // eslint-disable-line react-hooks/exhaustive-deps
  const samplers = useMemo(() => list.map(samplePath), [list]); // eslint-disable-line react-hooks/exhaustive-deps
  const moverN = parts.reduce((s, p) => s + p.length, 0);
  const [slots, soft] = useMemo<[Slot[], Slot[]]>(() => {
    let from = moverN, sf = 0;
    const hard: Slot[] = [], sl: Slot[] = [];
    for (const [kind, n] of particleBudget(weather)) {
      if (SOFT.has(kind)) { sl.push({ kind, n, from: sf }); sf += n; } else { hard.push({ kind, n, from }); from += n; }
    }
    if (momentKind && momentN > 0) hard.push({ kind: momentKind, n: momentN, from, moment: true });
    return [hard, sl];
  }, [weather, moverN, momentKind, momentN]);
  const total = slots.reduce((s, x) => s + x.n, moverN);
  const softN = soft.reduce((s, x) => s + x.n, 0);
  const nightKey = (nightOnly ?? []).join(",");
  const nightSet = useMemo(() => new Set<WeatherKind>(["aurora", ...(nightKey ? nightKey.split(",") as WeatherKind[] : [])]), [nightKey]);
  const ref = useRef<THREE.InstancedMesh>(null);
  const softRef = useRef<THREE.InstancedMesh>(null);
  const material = useMemo(() => new THREE.MeshLambertMaterial(), []);
  const softMaterial = useMemo(() => new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.32, depthWrite: false }), []);
  useEffect(() => () => { material.dispose(); softMaterial.dispose(); }, [material, softMaterial]);
  const tmp = useMemo(() => ({ o: { x: 0, y: 0, z: 0, yaw: 0 }, w: { x: 0, y: 0, z: 0, yaw: 0 }, c: new THREE.Color(), d: new THREE.Vector3() }), []);
  // an yoğunluğu, sis tonu tabanı, su halkası birikimi, ayak izi durumu; kum alanları (sahne `sand` kancaları)
  const scene = useThree((s) => s.scene);
  const mx = useMemo(() => ({ level: 0, poll: -1e9, fog: null as THREE.Fog | null, near: 0, far: 0, k: 1, acc: 0, trace: createTrace() }), []);
  const sand = useMemo(() => (ambient ?? []).filter((h) => h.kind === "sand"), [ambient]);
  const snowGround = !!place && SNOW_GROUND.has(place);
  useEffect(() => () => {
    // sis tonu bırakılırken taban mesafe geri yazılır
    if (mx.fog && mx.k !== 1) { mx.fog.near = mx.near; mx.fog.far = mx.far; }
    mx.fog = null; mx.k = 1;
  }, [mx, scene]);

  // renkler: hareketli parçalar (gece pencere HDR), parçacıklar (tür rengi; kıvılcım ve aurora parlak)
  useLayoutEffect(() => {
    const sm = softRef.current;
    if (sm && softN) {
      for (const s of soft) for (let i = 0; i < s.n; i++) sm.setColorAt(s.from + i, tmp.c.set(night ? "#7D8BA6" : "#E8EEF2"));
      if (sm.instanceColor) sm.instanceColor.needsUpdate = true;
    }
    const mesh = ref.current;
    if (!mesh || !total) return;
    const c = tmp.c;
    let k = 0;
    list.forEach((m, mi) => {
      const [body, accent] = [m.color ?? DEFAULT_COLORS[m.shape][0], m.accent ?? DEFAULT_COLORS[m.shape][1]];
      for (const p of parts[mi]) {
        const role = p[6];
        if (role === "lit") { c.set(night ? "#FFD98A" : "#5E7A90"); if (night) c.multiplyScalar(3.2); }
        else c.set(role === "body" ? body : role === "accent" ? accent : role);
        mesh.setColorAt(k++, c);
      }
    });
    for (const s of slots) for (let i = 0; i < s.n; i++) {
      switch (s.kind) {
        case "rain": c.set(night ? "#6F8FB0" : "#A9C7E8"); break;
        case "snow": c.set("#FFFFFF"); break;
        case "mist": c.set("#E8EEF2"); break;
        case "bubbles": c.set("#DFF6FF").multiplyScalar(1.3); break;
        case "embers": c.set(i % 3 ? "#FFD27A" : "#C8F07A").multiplyScalar(night ? 3.5 : 1.6); break;
        case "aurora": c.set(i % 3 === 2 ? "#B28DFF" : "#5CFFB0").multiplyScalar(2.4); break;
        case "petals": c.set(i % 3 ? "#F9C6D3" : "#F4A7B9"); break;
      }
      mesh.setColorAt(s.from + i, c);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [list, parts, slots, soft, softN, total, night, tmp]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame(({ clock, camera }, delta) => {
    const t = reduced ? 0 : clock.elapsedTime;
    // parçacık hacmi kameranın 10 birim önünde (yatay bakış yönü). Genel bakış kamerası −z'ye baktığından eski (x, z − 10) ile aynı;
    // yürümede kamera her yöne döner, hacim bakılan yerde kalsın
    camera.getWorldDirection(tmp.d);
    const fl = Math.hypot(tmp.d.x, tmp.d.z), fx0 = fl > 0.2 ? tmp.d.x / fl : 0, fz0 = fl > 0.2 ? tmp.d.z / fl : -1;
    const cx = camera.position.x + fx0 * 10, cz = camera.position.z + fz0 * 10;
    // ---- an yoğunluğu (mini oyun başlarsa hemen söner)
    const mg = !!useMinigame.getState().kind;
    if (moment && !mg && clock.elapsedTime - mx.poll > 1) { mx.poll = clock.elapsedTime; mx.level = momentNow(place)?.level ?? 0; }
    if (!moment || mg) { mx.level = 0; mx.poll = -1e9; }
    applyMist(scene.fog, mx, moment === "mist" ? mx.level : 0);
    if (fx) {
      const wr = walkRuntime, av = wr.avatar, walking = wr.live && wr.humanScale < 0.999;
      // su halkaları: sağanakta, avatarın (yürürken) ya da kamera odağının çevresinde
      if (moment === "shower" && mx.level > 0.3 && !reduced && !fx.calm) {
        mx.acc += MOMENT.ripples * mx.level * Math.min(delta, 0.1);
        const ox = walking ? av.x : cx, oz = walking ? av.z : cz, oy = walking ? av.ground : 0;
        while (mx.acc >= 1) {
          mx.acc -= 1;
          const a = Math.random() * 6.283, r = 0.6 + Math.random() * (walking ? 3 : 8);
          puddle(fx, ox + Math.cos(a) * r, oy, oz + Math.sin(a) * r);
        }
      } else mx.acc = 0;
      // ayak izleri: karda ya da kumda (hareket azaltmada yok)
      let surf: TraceSurface | null = null;
      if (walking && av.grounded && !reduced) {
        if (snowGround) surf = "snow";
        else if (sand.length) {
          const [ti, tj] = tileOf(av.x, av.z);
          if (sand.some((h) => Math.max(Math.abs(h.tile[0] - ti), Math.abs(h.tile[1] - tj)) <= (h.r ?? 1))) surf = "sand";
        }
      }
      stepTrace(fx, mx.trace, av.x, av.ground, av.z, surf, clock.elapsedTime);
    }
    const sm = softRef.current;
    if (sm && softN) { writeParticles(sm.instanceMatrix.array as Float32Array, soft, t, clock.elapsedTime, cx, cz, reduced, night, nightSet); flushDiff(sm.instanceMatrix, 16); } // yalnız değişen yuvalar
    const mesh = ref.current;
    if (!mesh || !total) return;
    const a = mesh.instanceMatrix.array as Float32Array;
    const o = tmp.o;
    let k = 0;
    // ---- hareketli nesneler
    const prog = walkProgress(walkRuntime.humanScale);
    for (let mi = 0; mi < list.length; mi++) {
      // WALK-PHYS: yürüme modunda taşıt örnek başına gerçek boya (walk/moverFit.ts: yükseklik hedefte, boy/en yol açıklığında;
      // uçları kısaltılmış yürüme yolu). Yalnız çizim; taşıtlar çarpışmaz. Geçiş ölçek ilerlemesiyle (600 ms).
      const m = list[mi], hide = night && m.dayOnly;
      const fit = prog > 0 ? moverFitOf(m) : null;
      const s0 = m.scale ?? 1;
      const sx = s0 * (fit ? 1 + (fit.fx - 1) * prog : 1), sy = s0 * (fit ? 1 + (fit.fy - 1) * prog : 1), sz = s0 * (fit ? 1 + (fit.fz - 1) * prog : 1);
      samplers[mi].at(t, o);
      if (fit && fit.mover !== m) {
        const w = tmp.w;
        walkSampler(fit).at(t, w);
        o.x += (w.x - o.x) * prog; o.y += (w.y - o.y) * prog; o.z += (w.z - o.z) * prog;
      }
      const bob = !reduced && WET.has(m.shape) ? waveY(t, o.x, o.z) : m.shape === "airship" || m.shape === "balloon" ? (reduced ? 0 : Math.sin(t * 0.6 + mi) * 0.12) : 0;
      const cs = Math.cos(o.yaw), sn = Math.sin(o.yaw);
      for (const p of parts[mi] as Part[]) {
        const e = k++ * 16;
        if (hide) { a.fill(0, e, e + 16); continue; }
        const lx = p[0] * sx, ly = p[1] * sy, lz = p[2] * sz, w = p[3] * sx, h = p[4] * sy, d = p[5] * sz;
        a[e] = cs * w; a[e + 1] = 0; a[e + 2] = -sn * w; a[e + 3] = 0;
        a[e + 4] = 0; a[e + 5] = h; a[e + 6] = 0; a[e + 7] = 0;
        a[e + 8] = sn * d; a[e + 9] = 0; a[e + 10] = cs * d; a[e + 11] = 0;
        a[e + 12] = o.x + cs * lx + sn * lz; a[e + 13] = o.y + ly + bob; a[e + 14] = o.z - sn * lx + cs * lz; a[e + 15] = 1;
      }
    }
    // ---- parçacıklar (kamerayı izleyen hacim)
    // an parçacıkları yürümede daha dar hacimde (yoğunluk avatarın çevresinde; sahnenin kendi havası değişmez)
    const walkFx = walkRuntime.live && walkRuntime.humanScale < 0.999;
    writeParticles(a, slots, t, clock.elapsedTime, cx, cz, reduced, night, nightSet, mx.level, walkFx ? 0.45 : 1, walkFx);
    // yalnız değişen yuvalar GPU'ya (gizli/sıfır parçacıklar, gündüz aurora, hareket azaltmada durağan sahne: yükleme yok)
    flushDiff(mesh.instanceMatrix, 16);
  });

  if (!total && !softN) return null;
  return (
    <>
      {total > 0 && <instancedMesh key={`fx${total}`} ref={ref} args={[unit, material, total]} frustumCulled={false} castShadow={false} receiveShadow={false} />}
      {softN > 0 && <instancedMesh key={`fxs${softN}`} ref={softRef} args={[unit, softMaterial, softN]} frustumCulled={false} castShadow={false} receiveShadow={false} renderOrder={2} />}
    </>
  );
}


/** HQA-FIX: yürüme ölçeğinde yağmur damlası boyutu (birim).*/
const RAIN_WALK_H = 0.16, RAIN_WALK_W = 0.018;
/** Parçacık matrisleri (kamerayı izleyen hacim); `slots[].from` dizinin kendi başlangıcına göre. */
function writeParticles(a: Float32Array, slots: readonly Slot[], t: number, clockT: number, cx: number, cz: number, reduced: boolean, night: boolean,
  nightSet: ReadonlySet<WeatherKind>, momentLevel = 0, momentVol = 1, /** HQA-FIX: yürüme ölçeği*/ walk = false) {
    for (const s of slots) {
      const vs = s.moment ? momentVol : 1;
      const off = s.kind !== "aurora" && reduced, sky = !s.moment && nightSet.has(s.kind);
      // W2-INT: yağmur aralıklı (rainLevel); görünen pay kadar parçacık, kalanı sıfır ölçek. an yuvası an yoğunluğuyla.
      const live = s.moment ? Math.round(s.n * momentLevel) : s.kind === "rain" ? Math.round(s.n * rainLevel(clockT)) : s.n;
      for (let i = 0; i < s.n; i++) {
        const e = (s.from + i) * 16;
        if (off || (sky && !night) || i >= live) { a.fill(0, e, e + 16); continue; }
        const hx = hash(i * 3 + 1), hy = hash(i * 3 + 2), hz = hash(i * 3 + 3);
        let x = cx + (hx - 0.5) * VOL_W * vs, z = cz + (hz - 0.5) * VOL_D * vs, y = 0, w = 0.08, h = 0.08, d = 0.08;
        const vh = VOL_H * vs;
        switch (s.kind) {
          case "rain": y = vh - ((hy * vh + t * (8 + hx * 3)) % vh); w = d = 0.035; h = 0.5 * Math.max(0.6, vs);
            // HQA-FIX: yürüme ölçeğinde damla avatar boyunun yarısı (0,5) cam çubuk gibiydi ve zemine değen damla yerde dikili
            // duruyordu — ince kısa çizgi (RAIN_WALK_H) ve zemine inen damla gizlenir
            if (walk) { w = d = RAIN_WALK_W; h = RAIN_WALK_H; if (y < h) { a.fill(0, e, e + 16); continue; } }
            break;
          case "snow": y = vh - ((hy * vh + t * (0.6 + hx * 0.5)) % vh); x += Math.sin(t * 0.8 + i) * 0.3; z += Math.cos(t * 0.6 + i * 1.7) * 0.2; w = h = d = 0.09; break;
          case "bubbles": y = (hy * VOL_H * 0.6 + t * (0.7 + hx * 0.6)) % (VOL_H * 0.6); x += Math.sin(t * 2 + i) * 0.08; w = h = d = 0.07 + hz * 0.06; break;
          case "embers": y = 0.2 + ((hy * 4 + t * (0.25 + hx * 0.25)) % 4); x += Math.sin(t * 0.9 + i * 2.1) * 0.5; z += Math.cos(t * 0.7 + i) * 0.4; w = h = d = 0.06; break;
          // W2b-INT: kiraz yaprağı — yavaş düşüş, geniş salınım, yassı (döndürmesiz tek kutu)
          case "petals": y = VOL_H * 0.7 - ((hy * VOL_H * 0.7 + t * (0.35 + hx * 0.3)) % (VOL_H * 0.7)); x += Math.sin(t * 0.9 + i * 1.3) * 0.6; z += Math.cos(t * 0.7 + i) * 0.35; w = 0.1; h = 0.02; d = 0.08; break;
          case "mist": x = cx + (((hx * VOL_W + t * 0.25) % VOL_W) - VOL_W / 2); y = 0.25 + hy * 0.7; w = 1.4 + hz * 1.6; h = 0.18; d = 0.9 + hy; break;
          case "aurora": {
            const f = i / Math.max(1, s.n - 1);
            // W3a-INT: taban kadrajında görünsün diye ufuk bandında (z ≈ −20…−24, y ≈ 5–8; eskiden y 15, z −26 → kadraj dışı)
            x = -30 + f * 60; z = -22 - Math.sin(f * 7) * 2; y = 6.5 + Math.sin(f * 9 + t * 0.4) * 0.8;
            w = 1.5; h = 1.8 + Math.sin(f * 13 + t * 0.7) * 0.7 + hy * 0.6; d = 0.15; break;
          }
        }
        a[e] = w; a[e + 1] = 0; a[e + 2] = 0; a[e + 3] = 0;
        a[e + 4] = 0; a[e + 5] = h; a[e + 6] = 0; a[e + 7] = 0;
        a[e + 8] = 0; a[e + 9] = 0; a[e + 10] = d; a[e + 11] = 0;
        a[e + 12] = x; a[e + 13] = y; a[e + 14] = z; a[e + 15] = 1;
      }
    }
}

/** sis anı: sahne sisinin mesafesini `MOMENT.mistFog` oranına yaklaştırır (durağan ton, parçacık yok, +0 çağrı). Taban
 * mesafe sis nesnesi değişince (World yeniden kurunca) yeniden alınır; an bitince taban aynen geri yazılır.*/
function applyMist(fog: THREE.Fog | THREE.FogExp2 | null, mx: { fog: THREE.Fog | null; near: number; far: number; k: number }, level: number) {
  const f = fog instanceof THREE.Fog ? fog : null;
  if (f !== mx.fog) {
    if (mx.fog && mx.k !== 1) { mx.fog.near = mx.near; mx.fog.far = mx.far; }
    mx.fog = f; mx.k = 1;
  }
  if (!f) return;
  const k = 1 - (1 - MOMENT.mistFog) * level;
  if (k === mx.k) return;
  if (mx.k === 1) { mx.near = f.near; mx.far = f.far; } // taban: an başlamadan hemen önceki değer
  mx.k = k;
  f.near = mx.near * k; f.far = mx.far * k;
}
