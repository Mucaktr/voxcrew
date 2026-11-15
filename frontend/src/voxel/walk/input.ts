/**
 * W1a (WALK-CORE) — yürüme modu girdisi: klavye (WASD / oklar, Shift koş, F·Enter·X etkileşim, Boşluk zıpla (WALK-PHYS; fotoğraf
 * modunda deklanşör), Y aç-kapa, V görünüm,
 * Q/E kamera, R/C · PageUp/PageDown bakış eğimi (WALK-SCALE), +/− mesafe, Tab yakındakiler, Esc) ve dokunmatik joystick modeli.
 *
 * Odak kuralı (§4.1): metin alanı, düzenlenebilir içerik, seçim kutusu ya da bir panel odaktayken hiçbir yürüme tuşu çalışmaz.
 * Dünya kabının kendi `onKeyDown` deseniyle aynı: varsayılan `requireSelf` → yalnızca `e.target === e.currentTarget` (tuval
 * kabı odakta) işlenir. Değiştirici tuşlu (Ctrl/Meta/Alt) kısayollar tarayıcıya bırakılır.
 * Hareket azaltma: girdi hiçbir şeyi canlandırmaz; Q/E dönüşü `snap` bayrağıyla gelir (WalkRig anında döndürür), koşma
 * "aç-kapa" seçeneği basılı tutma zorunluluğunu kaldırır (§4.1, [K8]).
 * Saf parçalar (`keyAction`, `KeyboardWalkInput`, `JoystickModel`) DOM'suz test edilebilir; `attachWalkKeyboard` DOM'a bağlar.
*/
import { reducedMotion } from "../motion";
import type { MoveInput } from "./controller";
import { KEY_PITCH } from "./scale";
import { useWalkStore, walkRuntime } from "./walkStore";
import { walkZoom } from "../camera/walkZoom"; // WALK-ZOOM

export type MoveDir = "up" | "down" | "left" | "right";
export type WalkAction = "interact" | "toggle" | "view" | "exit" | "rotateLeft" | "rotateRight" | "zoomIn" | "zoomOut" | "nextTarget" | "prevTarget" | "help"
  /** W5: emote çarkı (G, T), fotoğraf modu (P), çarkta 1–6, fotoğraf kamerası eğimi (PageUp/PageDown, R/C) */
  | "emote" | "photo" | "pick" | "pitchUp" | "pitchDown"
  /** WALK-PHYS: zıpla (Boşluk) */
  | "jump"
  /** STUCK-FIX: "Takıldım" — son güvenli noktaya dön (U) */
  | "unstuck"
  /** WALK-ZOOM: kuş bakışı aç / kapa (Z) */
  | "aerial";

export interface KeyLike { key: string; code?: string; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; repeat?: boolean }

/** Tuş → hareket yönü ya da eylem. `code` (fiziksel tuş, klavye düzeninden bağımsız) önceliklidir; yoksa `key`. */
export function keyAction(e: KeyLike): { move?: MoveDir; action?: WalkAction; digit?: number } | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  // W5: 1–6 rakamları (emote; üst sıra ya da sayısal tuş takımı)
  const dm = /^(?:Digit|Numpad)([1-6])$/.exec(e.code ?? "");
  if (dm) return { action: "pick", digit: Number(dm[1]) };
  if (!e.code && /^[1-6]$/.test(e.key)) return { action: "pick", digit: Number(e.key) };
  // W5: "?" düzene göre farklı fiziksel tuştadır (TR-Q'da Minus = uzaklaştır); karakterle eşlenir
  if (e.key === "?") return { action: "help" };
  switch (e.code) {
    case "KeyW": case "ArrowUp": return { move: "up" };
    case "KeyS": case "ArrowDown": return { move: "down" };
    case "KeyA": case "ArrowLeft": return { move: "left" };
    case "KeyD": case "ArrowRight": return { move: "right" };
    case "KeyF": case "KeyX": case "Enter": case "NumpadEnter": return { action: "interact" };
    case "Space": return { action: "jump" };
    case "KeyY": return { action: "toggle" };
    case "KeyV": return { action: "view" };
    case "KeyQ": return { action: "rotateLeft" };
    case "KeyE": return { action: "rotateRight" };
    case "Escape": return { action: "exit" };
    case "Tab": return { action: e.shiftKey ? "prevTarget" : "nextTarget" };
    case "Equal": case "NumpadAdd": return { action: "zoomIn" };
    case "Minus": case "NumpadSubtract": return { action: "zoomOut" };
    case "KeyG": case "KeyT": return { action: "emote" };
    case "KeyP": return { action: "photo" };
    case "PageUp": case "KeyR": return { action: "pitchUp" };
    case "PageDown": case "KeyC": return { action: "pitchDown" };
    case "KeyU": return { action: "unstuck" };
    case "KeyZ": return { action: "aerial" }; // WALK-ZOOM
    default: break;
  }
  switch (e.key) {
    case "w": case "W": case "ArrowUp": return { move: "up" };
    case "s": case "S": case "ArrowDown": return { move: "down" };
    case "a": case "A": case "ArrowLeft": return { move: "left" };
    case "d": case "D": case "ArrowRight": return { move: "right" };
    case "f": case "F": case "x": case "X": case "Enter": return { action: "interact" };
    case " ": return { action: "jump" };
    case "y": case "Y": return { action: "toggle" };
    case "v": case "V": return { action: "view" };
    case "q": case "Q": return { action: "rotateLeft" };
    case "e": case "E": return { action: "rotateRight" };
    case "Escape": return { action: "exit" };
    case "Tab": return { action: e.shiftKey ? "prevTarget" : "nextTarget" };
    case "+": case "=": return { action: "zoomIn" };
    case "-": case "_": return { action: "zoomOut" };
    case "?": return { action: "help" };
    case "g": case "G": case "t": case "T": return { action: "emote" };
    case "p": case "P": return { action: "photo" };
    case "PageUp": case "r": case "R": return { action: "pitchUp" };
    case "PageDown": case "c": case "C": return { action: "pitchDown" };
    case "u": case "U": return { action: "unstuck" };
    case "z": case "Z": return { action: "aerial" }; // WALK-ZOOM
    default: return null;
  }
}

/** Yürüme modu kapalıyken yalnızca Y (giriş) dinlenir; açıkken bütün eşlem (`aria-keyshortcuts` ile aynı liste). */
export const WALK_KEYSHORTCUTS = "W A S D ArrowUp ArrowDown ArrowLeft ArrowRight Shift F Enter Space X Y V Q E R C PageUp PageDown Tab + - Z G T P J L U ? 1 2 3 4 5 6 Escape";
export const IDLE_KEYSHORTCUTS = "Y";

/** Klavye girdisi yazılabilir bir öğede mi (input, textarea, select, contenteditable, role=textbox). */
export function isTypingTarget(el: unknown): boolean {
  if (!el || typeof el !== "object") return false;
  const n = el as { tagName?: string; isContentEditable?: boolean; getAttribute?: (k: string) => string | null };
  const tag = (n.tagName ?? "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (n.isContentEditable) return true;
  const role = n.getAttribute?.("role");
  return role === "textbox" || role === "combobox" || role === "searchbox";
}

/**
 * dünya kabı dışında basılan F, "F: …" istemine gitmeli mi. Yalnız F (Enter/Boşluk odaktaki düğmeye kalır), yürüme açık,
 * istemi gizleyen bir durum yok (panel/fotoğraf/çark), odak yazı alanında, kalıcı pencerede (aria-modal) ya da menüde değil.
*/
export function strayInteract(
  e: KeyLike & { target?: unknown; defaultPrevented?: boolean },
  world: { contains(n: unknown): boolean },
  s: { active: boolean; panel: string | null; photo: boolean; emoteWheel: boolean },
): boolean {
  if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return false;
  if (!(e.code === "KeyF" || (!e.code && (e.key === "f" || e.key === "F")))) return false;
  if (!s.active || s.panel || s.photo || s.emoteWheel) return false;
  const t = e.target as { closest?: (q: string) => unknown } | null | undefined;
  if (world.contains(t) || isTypingTarget(t)) return false;
  return !t?.closest?.('[aria-modal="true"], [role="menu"], [role="alertdialog"]');
}

/** kuş bakışındayken (ve kapatılacak panel/fotoğraf/çark yokken) Esc yürüyüşten çıkmaz, yalnız kuş bakışını kapatır.*/
export const escLeavesAerial = (s: { panel: string | null; photo: boolean; emoteWheel: boolean }, aerialOn: boolean): boolean =>
  aerialOn && !s.panel && !s.photo && !s.emoteWheel;

export interface KeyboardOptions {
  /** "hold": Shift basılıyken koşar · "toggle": Shift her basışta koşmayı aç/kapa (§4.1 ayarı) */
  runMode?: "hold" | "toggle";
}

/**
 * Basılı yön tuşlarından birleşik hareket vektörü. Karşıt tuşlar birbirini sıfırlar; son basılan kazanmaz (belirlenimci).
 * Aynı yön için iki tuş (W ve ↑) ayrı sayılır: biri bırakılınca diğeri basılı kalır.
 */
export class KeyboardWalkInput {
  private held = new Map<string, MoveDir>();
  private runHeld = false;
  private runLatched = false;
  readonly runMode: "hold" | "toggle";
  constructor(opts: KeyboardOptions = {}) { this.runMode = opts.runMode ?? "hold"; }

  /** Tuş basıldı: hareket tuşuysa kaydeder ve null; eylemse eylemi döndürür (tekrarlayan basışta eylem yok). */
  down(e: KeyLike): { handled: boolean; action: WalkAction | null; digit?: number } {
    if (e.key === "Shift" || e.code === "ShiftLeft" || e.code === "ShiftRight") {
      if (this.runMode === "toggle") { if (!e.repeat) this.runLatched = !this.runLatched; }
      else this.runHeld = true;
      return { handled: false, action: null };
    }
    const a = keyAction(e);
    if (!a) return { handled: false, action: null };
    if (a.move) { this.held.set(e.code || e.key.toLowerCase(), a.move); return { handled: true, action: null }; }
    const rep = a.action === "zoomIn" || a.action === "zoomOut" || a.action === "pitchUp" || a.action === "pitchDown";
    return { handled: true, action: e.repeat && !rep ? null : a.action!, digit: a.digit };
  }

  up(e: KeyLike): void {
    if (e.key === "Shift" || e.code === "ShiftLeft" || e.code === "ShiftRight") { this.runHeld = false; return; }
    this.held.delete(e.code || e.key.toLowerCase());
  }

  /** Pencere odağı kaybedince (alt-tab) basılı tuşlar takılı kalmasın. */
  clear(): void { this.held.clear(); this.runHeld = false; }

  get run(): boolean { return this.runMode === "toggle" ? this.runLatched : this.runHeld; }

  vector(out: MoveInput = { x: 0, y: 0 }): MoveInput {
    let x = 0, y = 0;
    const seen = new Set<MoveDir>();
    for (const d of this.held.values()) {
      if (seen.has(d)) continue;
      seen.add(d);
      if (d === "up") y += 1; else if (d === "down") y -= 1; else if (d === "right") x += 1; else x -= 1;
    }
    out.x = x; out.y = y;
    return out;
  }
}

// ------------------------------------------------------------------------------------------ dokunmatik joystick
/** Taban çapı 60 px (§4.2); topuz en çok taban yarıçapı kadar gider. */
export const JOY_RADIUS_PX = 30;
/** W5: ölü bölge (yarıçapın oranı). Parmak titremesi ve dokunuş anındaki kayma avatarı kımıldatmaz; dışında 0→1 yeniden ölçeklenir. */
export const JOY_DEAD = 0.18;
/** W5: topuz yarıçapın bu oranına varınca tam hız (kenara kadar itmek gerekmez) */
export const JOY_FULL = 0.92;

/**
 * Sanal joystick (sol alt, `pointer: coarse`). Tek parmak (ilk dokunuş) sahiplenir; çoklu dokunuş diğerlerini yoksayar.
 * Ekran y aşağıdır → ileri = yukarı sürükleme. Çıktı analog [-1, 1] (ölü bölge denetleyicide).
 */
export class JoystickModel {
  pointerId: number | null = null;
  ox = 0;
  oy = 0;
  /** topuzun tabana göre konumu (px), çizim için */
  kx = 0;
  ky = 0;
  readonly radius: number;
  constructor(radius = JOY_RADIUS_PX) { this.radius = radius; }

  start(pointerId: number, x: number, y: number): boolean {
    if (this.pointerId !== null) return false;
    this.pointerId = pointerId; this.ox = x; this.oy = y; this.kx = 0; this.ky = 0;
    return true;
  }

  move(pointerId: number, x: number, y: number): boolean {
    if (pointerId !== this.pointerId) return false;
    let dx = x - this.ox, dy = y - this.oy;
    const d = Math.hypot(dx, dy);
    if (d > this.radius) { dx = (dx / d) * this.radius; dy = (dy / d) * this.radius; }
    this.kx = dx; this.ky = dy;
    return true;
  }

  end(pointerId: number): boolean {
    if (pointerId !== this.pointerId) return false;
    this.pointerId = null; this.kx = 0; this.ky = 0;
    return true;
  }

  get active(): boolean { return this.pointerId !== null; }

  vector(out: MoveInput = { x: 0, y: 0 }): MoveInput {
    const x = this.kx / this.radius, y = -this.ky / this.radius;
    const m = Math.hypot(x, y);
    if (m <= JOY_DEAD) { out.x = x * 0; out.y = y * 0; return out; } // işaret korunur (−0)
    // radyal ölü bölge + yumuşak eğri (küçük itişte ince ayar, kenara yakın tam hız)
    const k = Math.min(1, (m - JOY_DEAD) / (JOY_FULL - JOY_DEAD));
    const g = (k * k * (3 - 2 * k)) / m;
    out.x = x * g; out.y = y * g;
    return out;
  }
}

/** Klavye ve joystick vektörlerinin birleşimi (büyüklüğü 1'e kırpılır). */
export function combineInput(a: MoveInput, b: MoveInput, out: MoveInput = { x: 0, y: 0 }): MoveInput {
  const x = a.x + b.x, y = a.y + b.y;
  const m = Math.hypot(x, y);
  out.x = m > 1 ? x / m : x; out.y = m > 1 ? y / m : y;
  return out;
}

// ------------------------------------------------------------------------------------------ DOM bağlama
export interface WalkKeyHandlers {
  /** Y ya da "Yürü": mod kapalıyken giriş isteği (entegratör doğma karosunu hesaplayıp `enter` çağırır) */
  onEnter?: () => void;
  onInteract?: () => void;
  onNextTarget?: (dir: 1 | -1) => void;
  onHelp?: () => void;
  /** Esc moddan çıkardıysa (panel kapatma değil) */
  onExit?: () => void;
  /** W5: fotoğraf modunda F / Enter / Boşluk — fotoğraf çek */
  onShutter?: () => void;
  /** W5: 1–6 — emote (çark açık ya da kapalı) */
  onEmote?: (index: number) => void;
}

/** W5: işleyici verilmediyse (World.tsx yalnız W2 işleyicilerini bağlar) olay olarak yayılır; WalkHud / PhotoMode dinler. */
export const SHUTTER_EVENT = "vc-walk-shutter";
export const EMOTE_EVENT = "vc-walk-emote";
const shutterEvent = () => { window.dispatchEvent(new Event(SHUTTER_EVENT)); };
const emoteEvent = (index: number) => { window.dispatchEvent(new CustomEvent<number>(EMOTE_EVENT, { detail: index })); };
/** W5: "?" kısayol kartı (WalkHud dinler)*/
export const HELP_EVENT = "vc-walk-help";
const helpEvent = () => { window.dispatchEvent(new Event(HELP_EVENT)); };
/** STUCK-FIX: "Takıldım" (U; WalkHud `StuckButton` dinler → walk/safeRescue.ts `requestRescue`) */
export const UNSTUCK_EVENT = "vc-walk-unstuck";
const unstuckEvent = () => { window.dispatchEvent(new Event(UNSTUCK_EVENT)); };

export interface AttachOptions extends KeyboardOptions {
  /** true (varsayılan): yalnızca kabın kendisi odaktayken (`e.target === e.currentTarget`) */
  requireSelf?: boolean;
}

/**
 * Dünya kabına (`role="application"`, tabIndex 0) klavye dinleyicisi bağlar; `walkRuntime.input/run/yawSteps/zoomSteps` yazar
 * ve depo eylemlerini çağırır. İşlenen tuşta `preventDefault` (sayfa kaydırma, Tab ile odak kaçması yok). Dönüş: söküm işlevi.
 * Mod kapalıyken yalnızca Y işlenir; kabın kendi ok-tuşu kaydırması (World.tsx) mod açıkken çalışmamalıdır (entegrasyon
 * belgesi: `onKey` başında `if (useWalkStore.getState().active) return;`).
 */
export function attachWalkKeyboard(el: HTMLElement, handlers: WalkKeyHandlers = {}, opts: AttachOptions = {}): () => void {
  const kb = new KeyboardWalkInput(opts);
  const requireSelf = opts.requireSelf ?? true;
  const sync = () => { kb.vector(walkRuntime.input); walkRuntime.run = kb.run; };
  const onDown = (e: KeyboardEvent) => {
    if (requireSelf ? e.target !== el : isTypingTarget(e.target)) return;
    const store = useWalkStore.getState();
    if (!store.active) {
      const a = keyAction(e);
      if (a?.action === "toggle" && !e.repeat) { e.preventDefault(); handlers.onEnter?.(); }
      return;
    }
    const r = kb.down(e);
    sync();
    if (!r.handled) return;
    const photo = store.photo;
    // fotoğraf modunda Tab sayfada dolaşır (Kaydet, filtreler); dünya kabı Tab'ı yutmaz
    if (photo && (r.action === "nextTarget" || r.action === "prevTarget")) return;
    e.preventDefault();
    switch (r.action) {
      case "toggle": store.exit(); kb.clear(); sync(); handlers.onExit?.(); break;
      // işaretçi kilidini bırakan Esc (tarayıcı kilidi açar) moddan çıkarmaz
      case "exit": if (performance.now() - walkRuntime.lockReleasedAt < 250) break;
        if (escLeavesAerial(store, walkZoom.on)) { walkZoom.toggle = true; break; } // Esc yalnız kuş bakışından iner
        if (store.escape() === "exit") { kb.clear(); sync(); handlers.onExit?.(); } break;
      case "view": if (!photo) store.toggleView(); break;
      case "rotateLeft": walkRuntime.yawSteps -= 1; walkRuntime.yawSnap = reducedMotion(); break;
      case "rotateRight": walkRuntime.yawSteps += 1; walkRuntime.yawSnap = reducedMotion(); break;
      case "zoomIn": walkRuntime.zoomSteps -= 1; break;
      case "zoomOut": walkRuntime.zoomSteps += 1; break;
      // WALK-SCALE: yürürken R/C ve PageUp/PageDown bakışı yukarı/aşağı eğer (fotoğraf modunda kamera eğimi)
      case "pitchUp": if (photo) walkRuntime.pitchDelta += 0.08; else walkRuntime.lookDelta += KEY_PITCH; break;
      case "pitchDown": if (photo) walkRuntime.pitchDelta -= 0.08; else walkRuntime.lookDelta -= KEY_PITCH; break;
      case "interact": if (photo) (handlers.onShutter ?? shutterEvent)(); else handlers.onInteract?.(); break;
      // WALK-PHYS: Boşluk zıplar (fotoğraf modunda deklanşör; panel açıkken de zıplar — panel odak almaz)
      case "jump": if (photo) (handlers.onShutter ?? shutterEvent)(); else walkRuntime.jump++; break;
      case "photo": store.setPhoto(!photo); kb.clear(); sync(); break;
      case "emote": if (!photo) store.setEmoteWheel(!store.emoteWheel); break;
      case "pick": if (!photo && r.digit) { (handlers.onEmote ?? emoteEvent)(r.digit - 1); if (store.emoteWheel) store.setEmoteWheel(false); } break;
      case "nextTarget": handlers.onNextTarget?.(1); break;
      case "prevTarget": handlers.onNextTarget?.(-1); break;
      case "help": if (!photo) (handlers.onHelp ?? helpEvent)(); break;
      case "unstuck": if (!photo && !e.repeat) unstuckEvent(); break;
      case "aerial": if (!photo) walkZoom.toggle = true; break; // WALK-ZOOM
      default: break;
    }
  };
  // "F: …" istemi görünürken odak bir yan paneldeyse (Hızlı seyahat, Hoş geldin, Yakındakiler, bilgi kartı) ya da
  // gövdeye düştüyse F ölüydü. F dünya kabına iletilir (odak oraya döner) → seçim ve etkileşim yolu aynen çalışır.
  const onStray = (e: KeyboardEvent) => {
    if (!strayInteract(e, el, useWalkStore.getState())) return;
    e.preventDefault();
    el.focus({ preventScroll: true });
    el.dispatchEvent(new KeyboardEvent("keydown", { key: e.key, code: e.code, bubbles: true, cancelable: true }));
  };
  const onUp = (e: KeyboardEvent) => { kb.up(e); sync(); };
  const onBlur = () => { kb.clear(); sync(); };
  window.addEventListener("keydown", onStray);
  el.addEventListener("keydown", onDown);
  el.addEventListener("keyup", onUp);
  el.addEventListener("blur", onBlur);
  window.addEventListener("blur", onBlur);
  return () => {
    window.removeEventListener("keydown", onStray);
    el.removeEventListener("keydown", onDown);
    el.removeEventListener("keyup", onUp);
    el.removeEventListener("blur", onBlur);
    window.removeEventListener("blur", onBlur);
    onBlur();
  };
}
