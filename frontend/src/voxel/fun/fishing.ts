/**
 * WORLD-FIX — olta mini oyununun SAF durum makinesi (React ve three yok; scripts/fishing.test.mjs doğrudan yükler).
 *
 * Kök neden (CEO raporu "Çek'e basınca çekmiyor, Tekrar at çıkıyor"): eski HUD'da birincil düğme bekleme evresinde de "Çek!"
 * yazıyordu; şamandıra dalmadan basılınca tur `early` ile bitiyor ve düğme "Tekrar at" oluyordu. Ayrıca pencere atıştan
 * itibaren duvar saatiyle ölçülüyordu: zamanlayıcı ya da kare gecikince "Çek!" geç görünüyor, zamanında basış `late` sayılıyordu.
 *
 * Evreler: ready → casting (atış yayı) → waiting (şamandıra) → bite ("Çek!") → reeling (çekiş, gerilim) → caught | early | late;
 * pencere kaybı (sekme/uygulama değişimi) → lost (cezasız). Kurallar:
 * - Birincil eylem (düğme, Boşluk/Enter, dokunma) evreye göre tek anlam taşır: ready/sonuç → at; waiting → "oltayı topla" (erken
 * çekiş, balık kaçar); bite → çek; casting/reeling → yok sayılır.
 * - Çift basış koruması: anlamı değişen her evre geçişinden sonra `GUARD_MS` boyunca basış yok sayılır (atış basışının tekrarı
 * erken çekiş sayılmaz; yakalama basışının tekrarı hemen yeniden atmaz).
 * - Pencere, ipucunun GÖRÜNDÜĞÜ kareden (`cueAt`) ölçülür; zamanlayıcı/kare gecikmesi oyuncuya yazılmaz.
 * - Sonuç sunucudan gelir (jeton sunucu yetkili): çekişte `reel` etkisi, sonuç `result` olayıyla; çekiş animasyonu bitmeden
 * sonuç gösterilmez. Sunucu yoksa yerel tur (jeton yok).
 * - Hareket azaltma (`calm`): atış/çekiş animasyonu yok (0 ms), pencere `FISH_ASSIST_WINDOW_MS`.
 * - sunucu turunda vuruş anı istemciye GELMEZ. `ack` `biteMs: SERVER_CUE` (sonsuz) taşır; vuruş sunucunun zaman damgasız
 * işaretiyle (`/api/walk/fish/bite` uzun yoklaması → `cue` olayı) başlar: bekleme evresinde gelirse ipucu o karede, atış yayı
 * sürerken gelirse yay bitince. Yerel (çevrimdışı) tur eskisi gibi kendi `biteMs`'ini kullanır.
 * - FISH-FIX: işaret alınamazsa (uç yok/hata, tur sunucuda kapalı, yoklama tükendi) ya da onaydan `CUE_TIMEOUT_MS` içinde
 * gelmezse HUD `cueFail` gönderir: tur cezasız `lost` olur ve `cueLost` işaretlenir (açık bir "balık gelmedi" metni); bekleme
 * evresinde sonsuza dek takılmaz. Saat olayı (`tick`) tek başına turu düşürmez; süre sabittir, vuruş anını taşımaz.
*/

export type FishPhase = "ready" | "casting" | "waiting" | "bite" | "reeling" | "caught" | "early" | "late" | "lost";
export type FishOutcome = "caught" | "early" | "late";

export interface FishServerResult {
  result: FishOutcome;
  fish: string | null;
  coins: number;
  /** "daily_cap" | "junk" | "admin" | "creative" | "offline" | null */
  reason: string | null;
  balance: number | null;
  today: { used: number; max: number } | null;
}

export interface FishState {
  phase: FishPhase;
  /** tur sayacı: eski turun geç gelen yanıtı yeni turu bozmasın */
  round: number;
  /** evreye giriş anı (ms, performance.now) */
  at: number;
  castAt: number;
  /** atış yanıtı (sunucu ya da yerel tur) geldi mi; vuruş anı = ackAt + biteMs */
  ackAt: number | null;
  biteMs: number;
  windowMs: number;
  /** ipucunun gerçekten gösterildiği kare */
  cueAt: number | null;
  pressAt: number | null;
  /** bu andan önceki basışlar yok sayılır */
  lockUntil: number;
  castId: string | null;
  offline: boolean;
  calm: boolean;
  /** sunucu (ya da yerel) sonucu: çekiş animasyonu bitince evreye yansır */
  outcome: FishServerResult | null;
  /** FISH-FIX: tur, sunucu vuruş işareti alınamadığı için düştü (`lost` evresinde anlamlı) */
  cueLost: boolean;
}

export type FishEvent =
  | { type: "press"; now: number }
  | { type: "tick"; now: number }
  | { type: "ack"; now: number; round: number; castId: string | null; biteMs: number; windowMs: number; offline?: boolean }
  | { type: "result"; now: number; round: number; outcome: FishServerResult }
  /** sunucunun vuruş işareti (yalnız `biteMs: SERVER_CUE` ile onaylanmış turda)*/
  | { type: "cue"; now: number; round: number }
  /** FISH-FIX: vuruş işareti alınamadı (uç yok/hata sonrası tek yeniden deneme, atış kapalı, yoklama tükendi) */
  | { type: "cueFail"; now: number; round: number }
  | { type: "blur"; now: number }
  | { type: "calm"; calm: boolean };

export type FishEffect = "cast" | "reel" | "announceBite" | "announceResult";

export const CAST_MS = 650;
export const REEL_MS = 900;
export const GUARD_MS = 300;
/** ipucu süresi dolduktan sonra son kare payı */
export const LATE_GRACE_MS = 150;
/** sunucu yanıtı gelmezse çekiş bu sürede yerel sonuca düşer (jeton yok) */
export const RESULT_TIMEOUT_MS = 5000;
/** sunucu turunda vuruş anı bilinmez; `cue` olayı gelene dek beklenir*/
export const SERVER_CUE = Number.POSITIVE_INFINITY;
/** FISH-FIX: sunucu turunda onaydan bu yana işaret gelmezse HUD `cueFail` gönderir (sunucu vuruşu ≤ 5,2 sn; uzun yoklama ≤ 8 sn). */
export const CUE_TIMEOUT_MS = 12000;

export function initialFish(calm = false, now = 0): FishState {
  return { phase: "ready", round: 0, at: now, castAt: 0, ackAt: null, biteMs: 0, windowMs: 0, cueAt: null, pressAt: null,
    lockUntil: 0, castId: null, offline: false, calm, outcome: null, cueLost: false };
}

const castMs = (s: FishState) => (s.calm ? 0 : CAST_MS);
const reelMs = (s: FishState) => (s.calm ? 0 : REEL_MS);
/** sunucu işaretiyle onaylanmış, işareti henüz gelmemiş tur */
const awaitingCue = (s: FishState) => s.ackAt !== null && !Number.isFinite(s.biteMs);
/** FISH-FIX: işaret alınamadı → cezasız düşüş (balık yok, jeton yok), açık metin `cueLost` ile */
const cueLostStep = (s: FishState, now: number) =>
  ({ state: { ...s, phase: "lost" as const, at: now, lockUntil: now + GUARD_MS, outcome: null, cueLost: true }, effects: ["announceResult"] as FishEffect[] });
export const isActive = (p: FishPhase) => p === "casting" || p === "waiting" || p === "bite" || p === "reeling";
export const isResult = (p: FishPhase) => p === "caught" || p === "early" || p === "late" || p === "lost";

/** Birincil eylemin bu evredeki anlamı (düğme metni ve aria). */
export type FishAction = "cast" | "wait" | "reelIn" | "pull" | "busy";
export function fishAction(s: FishState): FishAction {
  switch (s.phase) {
    case "ready": case "caught": case "early": case "late": case "lost": return "cast";
    case "waiting": return "reelIn";
    case "bite": return "pull";
    default: return "busy";
  }
}

/** Bir olay → yeni durum + etkiler. Saf: aynı girdi → aynı çıktı; durum değişmediyse aynı nesne döner. */
export function fishStep(s: FishState, ev: FishEvent): { state: FishState; effects: FishEffect[] } {
  const none = { state: s, effects: [] as FishEffect[] };
  switch (ev.type) {
    case "calm":
      return ev.calm === s.calm ? none : { state: { ...s, calm: ev.calm }, effects: [] };
    case "press": {
      const now = ev.now;
      if (now < s.lockUntil) return none;
      switch (s.phase) {
        case "ready": case "caught": case "early": case "late": case "lost":
          return { state: { ...initialFish(s.calm, now), phase: "casting", round: s.round + 1, castAt: now, lockUntil: now + GUARD_MS }, effects: ["cast"] };
        case "waiting":
          // oltayı erken topladı: balık kaçar (sunucuya da bildirilir; sonuç yerelde kesin, jeton yok)
          return { state: { ...s, phase: "early", at: now, pressAt: now, lockUntil: now + GUARD_MS,
            outcome: { result: "early", fish: null, coins: 0, reason: null, balance: null, today: null } }, effects: s.castId ? ["reel", "announceResult"] : ["announceResult"] };
        case "bite":
          return { state: { ...s, phase: "reeling", at: now, pressAt: now, lockUntil: now + GUARD_MS }, effects: ["reel"] };
        default:
          return none; // casting / reeling: yok sayılır (çift basış)
      }
    }
    case "ack": {
      if (ev.round !== s.round || (s.phase !== "casting" && s.phase !== "waiting") || s.ackAt !== null) return none;
      return { state: { ...s, ackAt: ev.now, biteMs: Math.max(0, ev.biteMs), windowMs: Math.max(200, ev.windowMs), castId: ev.castId, offline: !!ev.offline }, effects: [] };
    }
    case "cue": {
      if (ev.round !== s.round || s.ackAt === null || Number.isFinite(s.biteMs)) return none;
      if (s.phase !== "casting" && s.phase !== "waiting") return none;
      return fishStep({ ...s, biteMs: Math.max(0, ev.now - s.ackAt) }, { type: "tick", now: ev.now });
    }
    case "cueFail": {
      if (ev.round !== s.round || !awaitingCue(s) || (s.phase !== "casting" && s.phase !== "waiting")) return none;
      return cueLostStep(s, ev.now);
    }
    case "result": {
      if (ev.round !== s.round || s.outcome) return none;
      if (s.phase !== "reeling") return none;
      return fishStep({ ...s, outcome: ev.outcome }, { type: "tick", now: ev.now });
    }
    case "blur": {
      if (s.phase === "casting" || s.phase === "waiting" || s.phase === "bite")
        return { state: { ...s, phase: "lost", at: ev.now, lockUntil: ev.now + GUARD_MS, outcome: null, cueLost: false }, effects: ["announceResult"] };
      return none;
    }
    case "tick": {
      const now = ev.now;
      if (s.phase === "casting") {
        if (s.ackAt === null || now < s.castAt + castMs(s)) return none;
        return fishStep({ ...s, phase: "waiting", at: now, lockUntil: Math.max(s.lockUntil, now + (s.calm ? GUARD_MS : 0)) }, ev);
      }
      if (s.phase === "waiting") {
        if (s.ackAt === null || now < s.ackAt + s.biteMs) return none;
        return { state: { ...s, phase: "bite", at: now, cueAt: now }, effects: ["announceBite"] };
      }
      if (s.phase === "bite") {
        if (s.cueAt !== null && now > s.cueAt + s.windowMs + LATE_GRACE_MS)
          return { state: { ...s, phase: "late", at: now, lockUntil: now + GUARD_MS,
            outcome: { result: "late", fish: null, coins: 0, reason: null, balance: null, today: null } }, effects: ["announceResult"] };
        return none;
      }
      if (s.phase === "reeling") {
        const pressAt = s.pressAt ?? s.at;
        if (!s.outcome) {
          if (now - pressAt < RESULT_TIMEOUT_MS) return none;
          // sunucu yanıtı yok: yerel sonuç, jeton kaydedilemedi
          return { state: { ...s, phase: "caught", at: now, lockUntil: now + GUARD_MS, offline: true,
            outcome: { result: "caught", fish: null, coins: 0, reason: "offline", balance: null, today: null } }, effects: ["announceResult"] };
        }
        if (now < pressAt + reelMs(s)) return none;
        return { state: { ...s, phase: s.outcome.result, at: now, lockUntil: now + GUARD_MS }, effects: ["announceResult"] };
      }
      return none;
    }
  }
}

/**
 * FISH-FIX: vuruş işareti yoklamasının (`/api/walk/fish/bite`) bir sonraki adımı. `r` null: istek hata verdi (eski sunucuda uç yok
 * → 404, 429, 5xx, ağ). Hata bir kez yeniden denenir; atış sunucuda kapandıysa (`open: false`) ya da yoklama tükendiyse `fail`
 * (→ `cueFail` olayı, tur cezasız düşer). Yanıtta zaman bilgisi yok; karar yalnız `open`/`cue` bayraklarından.
 */
export const CUE_POLLS = 4;
export const CUE_ERROR_RETRIES = 1;
export function cueNext(r: { open: boolean; cue: boolean } | null, polls: number, errors: number): "cue" | "poll" | "retry" | "fail" {
  if (r === null) return errors < CUE_ERROR_RETRIES ? "retry" : "fail";
  if (r.cue) return "cue";
  return r.open && polls + 1 < CUE_POLLS ? "poll" : "fail";
}

/** Çekiş gerilimi (0–1): misina ve olta bükümü için (görsel). */
export function lineTension(s: FishState, now: number): number {
  if (s.phase === "bite") return 0.55;
  if (s.phase === "reeling") return s.calm ? 0.8 : 0.6 + 0.4 * Math.abs(Math.sin(((now - s.at) / REEL_MS) * Math.PI * 3));
  return 0;
}
