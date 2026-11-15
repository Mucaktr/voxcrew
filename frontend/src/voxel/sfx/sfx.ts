/**
 * S48 — dünyadaki küçük tepki sesleri (WebAudio sentezi; dosya yok, telifli örnek yok). Yalnızca kullanıcı bir ortam öğesine
 * tıkladığında çalar ve uygulamanın genel ses ayarına ve ses düzeyine uyar (`lib/sound.ts` ana çıkışı: düzey × sıkıştırıcı). Tepe kazancı
 * 0,3 (eskiden 0,035 idi ve neredeyse duyulmuyordu); aynı anda birden çok tıklamada 90 ms'den sık çalmaz. Ajan şakaları (dans, çarpışma…) ses çıkarmaz.
 */
import { audioOut, soundEnabled } from "../../lib/sound";

export type Sfx = "meow" | "meowLow" | "purr" | "chirp" | "squawk" | "coo" | "quack" | "chitter" | "bark" | "hoot" | "beep" | "splash"
  | "rustle" | "click" | "hiss" | "bubble" | "chime" | "boop";

let out: AudioNode | null = null;
let noise: AudioBuffer | null = null;
let last = 0;
const PEAK = 0.3;

function ac(): AudioContext | null {
  const a = audioOut();
  if (!a) return null;
  out = a.out;
  return a.ctx;
}

function noiseBuf(c: AudioContext): AudioBuffer {
  if (noise && noise.sampleRate === c.sampleRate) return noise;
  const b = c.createBuffer(1, Math.floor(c.sampleRate * 1.2), c.sampleRate);
  const d = b.getChannelData(0);
  let s = 12345;
  for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; }
  noise = b;
  return b;
}

/** Zarf: 0 → tepe (atak) → 0 (bitiş). */
function env(g: GainNode, t: number, attack: number, dur: number, peak = PEAK) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

/** Frekans eğrili tek ton; isteğe bağlı süzgeç. */
function tone(c: AudioContext, t: number, type: OscillatorType, f: [number, number][], dur: number, peak = PEAK, filter?: [BiquadFilterType, number, number?]) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f[0][1], t);
  for (const [at, hz] of f.slice(1)) o.frequency.exponentialRampToValueAtTime(hz, t + at);
  const g = c.createGain();
  env(g, t, Math.min(0.03, dur / 4), dur, peak);
  let node: AudioNode = o;
  if (filter) {
    const bq = c.createBiquadFilter();
    bq.type = filter[0]; bq.frequency.value = filter[1]; if (filter[2]) bq.Q.value = filter[2];
    node.connect(bq); node = bq;
  }
  node.connect(g).connect((out ?? c.destination));
  o.start(t); o.stop(t + dur + 0.03);
  return o;
}

function hiss(c: AudioContext, t: number, dur: number, type: BiquadFilterType, hz: number, q = 0.8, peak = PEAK) {
  const s = c.createBufferSource();
  s.buffer = noiseBuf(c);
  const bq = c.createBiquadFilter();
  bq.type = type; bq.frequency.value = hz; bq.Q.value = q;
  const g = c.createGain();
  env(g, t, 0.015, dur, peak);
  s.connect(bq).connect(g).connect((out ?? c.destination));
  s.start(t, Math.random() * 0.4); s.stop(t + dur + 0.03);
  return bq;
}

/** Bir tepki sesi çalar (ses kapalıysa ya da tarayıcı izin vermezse sessizce hiçbir şey yapmaz). */
export function playSfx(cue: Sfx) {
  if (!soundEnabled()) return;
  const now = performance.now();
  if (now - last < 90) return;
  last = now;
  const c = ac();
  if (!c) return;
  try {
    const t = c.currentTime + 0.01;
    switch (cue) {
      case "meow": case "meowLow": {
        // "miyav": testere dişli ton, burun formantı (bant geçiren) ve yükselip düşen perde
        const k = cue === "meowLow" ? 0.7 : 1;
        tone(c, t, "sawtooth", [[0, 520 * k], [0.12, 820 * k], [0.46, 430 * k]], 0.5, PEAK * 0.9, ["bandpass", 1300 * k, 2.2]);
        tone(c, t, "triangle", [[0, 520 * k], [0.12, 820 * k], [0.46, 430 * k]], 0.48, PEAK * 0.5);
        break;
      }
      case "purr": {
        // mırlama: alçak ton, ≈ 24 Hz genlik titreşimi
        const o = c.createOscillator(); o.type = "sawtooth"; o.frequency.value = 52;
        const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 380;
        const g = c.createGain(); env(g, t, 0.15, 1.3, PEAK * 1.1);
        const am = c.createGain(); am.gain.value = 0.5;
        const lfo = c.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 24;
        const depth = c.createGain(); depth.gain.value = 0.5;
        lfo.connect(depth).connect(am.gain);
        o.connect(lp).connect(am).connect(g).connect((out ?? c.destination));
        o.start(t); lfo.start(t); o.stop(t + 1.35); lfo.stop(t + 1.35);
        break;
      }
      case "chirp":
        tone(c, t, "sine", [[0, 2600], [0.07, 3900]], 0.08);
        tone(c, t + 0.11, "sine", [[0, 2800], [0.06, 4200]], 0.08);
        tone(c, t + 0.21, "sine", [[0, 3000], [0.05, 3600]], 0.06, PEAK * 0.7);
        break;
      case "squawk":
        tone(c, t, "sawtooth", [[0, 950], [0.22, 620]], 0.24, PEAK * 0.8, ["bandpass", 1400, 3]);
        tone(c, t + 0.28, "sawtooth", [[0, 900], [0.18, 640]], 0.2, PEAK * 0.7, ["bandpass", 1400, 3]);
        break;
      case "coo":
        tone(c, t, "sine", [[0, 430], [0.25, 360]], 0.28, PEAK * 0.9);
        tone(c, t + 0.32, "sine", [[0, 400], [0.35, 340]], 0.38, PEAK * 0.8);
        hiss(c, t, 0.25, "bandpass", 2400, 0.6, PEAK * 0.4); // kanat pırpırı
        break;
      case "quack":
        for (const d of [0, 0.24]) tone(c, t + d, "sawtooth", [[0, 290], [0.16, 220]], 0.18, PEAK, ["bandpass", 1050, 4]);
        break;
      case "chitter":
        for (let i = 0; i < 6; i++) tone(c, t + i * 0.045, "square", [[0, 2300 + (i % 2) * 400], [0.03, 2000]], 0.03, PEAK * 0.5);
        break;
      case "bark":
        for (const d of [0, 0.22]) {
          tone(c, t + d, "sawtooth", [[0, 330], [0.11, 190]], 0.13, PEAK, ["bandpass", 900, 1.5]);
          hiss(c, t + d, 0.08, "bandpass", 1200, 1, PEAK * 0.5);
        }
        break;
      case "hoot":
        tone(c, t, "sine", [[0, 390], [0.22, 370]], 0.26, PEAK);
        tone(c, t + 0.36, "sine", [[0, 360], [0.45, 330]], 0.5, PEAK * 0.9);
        break;
      case "beep":
        tone(c, t, "square", [[0, 1320], [0.06, 1320]], 0.07, PEAK * 0.6);
        tone(c, t + 0.1, "square", [[0, 1760], [0.08, 1760]], 0.09, PEAK * 0.6);
        break;
      case "boop":
        tone(c, t, "sine", [[0, 880], [0.12, 1320]], 0.14, PEAK * 0.8);
        break;
      case "splash": {
        const bq = hiss(c, t, 0.42, "lowpass", 5200, 0.7, PEAK * 1.3);
        bq.frequency.exponentialRampToValueAtTime(700, t + 0.4);
        tone(c, t + 0.02, "sine", [[0, 700], [0.08, 1500]], 0.09, PEAK * 0.5);
        break;
      }
      case "rustle":
        for (const d of [0, 0.09, 0.2, 0.33]) hiss(c, t + d, 0.12, "bandpass", 3200 + d * 2000, 0.7, PEAK * 0.6);
        break;
      case "click":
        tone(c, t, "square", [[0, 2200], [0.012, 1800]], 0.015, PEAK * 0.6);
        tone(c, t + 0.03, "square", [[0, 1300], [0.015, 1100]], 0.02, PEAK * 0.5);
        break;
      case "hiss": {
        const bq = hiss(c, t, 0.75, "highpass", 2600, 0.5, PEAK * 0.9);
        bq.frequency.linearRampToValueAtTime(4200, t + 0.7);
        break;
      }
      case "bubble":
        for (const d of [0, 0.11, 0.19]) tone(c, t + d, "sine", [[0, 320 + d * 900], [0.06, 950 + d * 900]], 0.07, PEAK * 0.6);
        break;
      case "chime":
        tone(c, t, "sine", [[0, 1568], [0.3, 1568]], 0.32, PEAK * 0.5);
        tone(c, t + 0.08, "sine", [[0, 2093], [0.3, 2093]], 0.34, PEAK * 0.4);
        break;
    }
  } catch { /* ses yok */ }
}
