/** Küçük 8-bit ses efektleri (WebAudio, dosya yok). Ayar localStorage'da tutulur.
 * Bütün sesler tek ana çıkıştan geçer: ses düzeyi (`hs-volume`, 0–1) × sıkıştırıcı → hoparlör. Böylece dünya tepki sesleri,
 * kutlama ve bildirim sesleri aynı düğmeyle duyulur düzeye getirilir ve üst üste binince patlamaz. */
type Cue = "approval" | "done" | "error" | "handoff";

const NOTES: Record<Cue, [number, number][]> = {
  approval: [[784, 0.12], [1047, 0.18]],
  done: [[523, 0.08], [659, 0.08], [784, 0.08], [1047, 0.16]],
  error: [[220, 0.14], [174, 0.22]],
  handoff: [[880, 0.06], [1175, 0.08]],
};

/** Ses düzeyi kademeleri (ayar düğmesi bunlar arasında döner). */
export const VOLUME_STEPS = [0.35, 0.7, 1] as const;
const DEFAULT_VOLUME = 1;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

export function soundEnabled(): boolean {
  try { return localStorage.getItem("hs-sound") !== "off"; } catch { return true; }
}

export function setSoundEnabled(on: boolean) {
  try { localStorage.setItem("hs-sound", on ? "on" : "off"); } catch { /* yok say */ }
}

export function soundVolume(): number {
  try {
    const v = Number(localStorage.getItem("hs-volume"));
    return Number.isFinite(v) && v > 0 && v <= 1 ? v : DEFAULT_VOLUME;
  } catch { return DEFAULT_VOLUME; }
}

export function setSoundVolume(v: number) {
  const clamped = Math.max(0.05, Math.min(1, v));
  try { localStorage.setItem("hs-volume", String(clamped)); } catch { /* yok say */ }
  if (master && ctx) master.gain.setTargetAtTime(clamped, ctx.currentTime, 0.02);
}

/** Paylaşılan ses bağlamı ve ana çıkış (ses kapalıysa ya da tarayıcı izin vermezse null). */
export function audioOut(): { ctx: AudioContext; out: AudioNode } | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    if (!master) {
      master = ctx.createGain();
      master.gain.value = soundVolume();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -10; comp.knee.value = 6; comp.ratio.value = 4;
      comp.attack.value = 0.003; comp.release.value = 0.15;
      master.connect(comp).connect(ctx.destination);
    }
    return { ctx, out: master };
  } catch { return null; }
}

/** Kısa nota dizisi (bildirim ve kutlama sesleri ortak). */
export function playNotes(notes: [number, number][], peak = 0.22, type: OscillatorType = "square") {
  if (!soundEnabled()) return;
  const a = audioOut();
  if (!a) return;
  try {
    let t = a.ctx.currentTime + 0.01;
    for (const [freq, dur] of notes) {
      const osc = a.ctx.createOscillator();
      const gain = a.ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(peak, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(a.out);
      osc.start(t);
      osc.stop(t + dur + 0.02);
      t += dur * 0.9;
    }
  } catch { /* ses yok */ }
}

export function play(cue: Cue) {
  playNotes(NOTES[cue]);
}
