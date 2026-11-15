/**
 * INTERIOR-VIEW — iç mekân ses yatağı (sahne kaydının `ambience.sound`): WebAudio ile sentezlenen çok kısık, sürekli gürültü
 * (dosya yok, telifli örnek yok). Oda: alçak geçiren "oda tonu"; salon: daha geniş, hafif yankılı bant; güverte: yavaş dalgalanan
 * rüzgâr; sessiz alan: neredeyse duyulmaz uğultu. Uygulamanın ses ayarına ve düzeyine uyar (`lib/sound.ts`); ses kapalıysa hiç
 * düğüm kurulmaz. Kat değişince 0,4 sn'de geçer (hareket azaltma sesi etkilemez; görsel değil). Dışarı çıkınca durur.
 */
import { useEffect } from "react";
import { audioOut, soundEnabled } from "../../lib/sound";
import type { AmbienceSound } from "./sceneModel";

const PEAK: Record<AmbienceSound, number> = { room_tone: 0.022, hall_echo: 0.026, wind: 0.03, hush: 0.01 };
const FILTER: Record<AmbienceSound, [BiquadFilterType, number, number]> = {
  room_tone: ["lowpass", 220, 0.7], hall_echo: ["bandpass", 420, 0.5], wind: ["bandpass", 700, 0.9], hush: ["lowpass", 140, 0.7],
};

let noise: AudioBuffer | null = null;
function noiseBuf(c: AudioContext): AudioBuffer {
  if (noise && noise.sampleRate === c.sampleRate) return noise;
  const b = c.createBuffer(1, Math.floor(c.sampleRate * 2), c.sampleRate);
  const d = b.getChannelData(0);
  let s = 424242, last = 0;
  // kahverengi gürültü (yumuşak; beyaz gürültünün tıslaması yok)
  for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; last = (last + 0.02 * ((s / 2147483647) * 2 - 1)) / 1.02; d[i] = last * 3.5; }
  noise = b;
  return b;
}

interface Bed { stop: () => void }
function startBed(kind: AmbienceSound): Bed | null {
  if (!soundEnabled()) return null;
  const a = audioOut();
  if (!a) return null;
  try {
    const c = a.ctx, t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = noiseBuf(c); src.loop = true;
    const [type, hz, q] = FILTER[kind];
    const bq = c.createBiquadFilter(); bq.type = type; bq.frequency.value = hz; bq.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(PEAK[kind], t + 0.4);
    let lfo: OscillatorNode | null = null;
    if (kind === "wind") {
      // rüzgâr: süzgeç frekansı 0,12 Hz'de dalgalanır
      lfo = c.createOscillator(); lfo.frequency.value = 0.12;
      const depth = c.createGain(); depth.gain.value = 260;
      lfo.connect(depth).connect(bq.frequency); lfo.start(t);
    }
    src.connect(bq).connect(g).connect(a.out);
    src.start(t);
    return {
      stop: () => {
        try {
          const n = c.currentTime;
          g.gain.cancelScheduledValues(n); g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), n); g.gain.exponentialRampToValueAtTime(0.0001, n + 0.4);
          src.stop(n + 0.45); lfo?.stop(n + 0.45);
        } catch { /* bağlam kapandı */ }
      },
    };
  } catch { return null; }
}

/** İçerideyken (`kind` dolu) ses yatağını çalar; `kind` değişince geçer, null olunca durur. */
export function useInteriorAmbience(kind: AmbienceSound | null) {
  useEffect(() => {
    if (!kind) return;
    const bed = startBed(kind);
    return () => bed?.stop();
  }, [kind]);
}
