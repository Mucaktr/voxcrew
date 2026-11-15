/**
 * W1a (WALK-CORE) — yürüme modu deposu (zustand) ve kare başı çalışma durumu.
 *
 * İki katman (live.ts deseni):
 *  - `useWalkStore`: React'in abone olduğu **seyrek** durum (mod açık mı, görünüm, hedef karo, yakındakiler, kesit, panel,
 *    kısıtlı hızda avatar pozu). Kare başına yazılmaz: poz yalnızca karo ya da 8 yönlü bakış değişince, yakındakiler yalnızca
 *    içerik değişince yazılır.
 *  - `walkRuntime`: her karede güncellenen değiştirilebilir nesne (avatar durumu, girdi). WalkRig yazar; Crowd (WALK-CROWD)
 *    avatar örneğini, MiniMap avatar noktasını buradan okur. React yeniden çizimi yok.
 *
 * Seçiciler her çağrıda yeni dizi/nesne döndürmez (AGENTS kural 7): hazır seçiciler ilkel değer ya da depodaki aynı referansı
 * döndürür; boş liste sabit `NO_NEARBY`.
 */
import { create } from "zustand";
import { createAvatar, sameNearby, type AvatarState, type MoveInput, type NearbyItem } from "./controller";
import type { Tile } from "../scenes";

export type WalkView = "third" | "first";

export interface WalkPose {
  x: number;
  z: number;
  /** bakış açısı (rad); depoda 8 yöne (π/4) yuvarlanmış hâli (kare başı kesin değer `walkRuntime.avatar.heading`) */
  heading: number;
  /** karo (dünya ızgarası) */
  tile: Tile;
}

export interface WalkCover {
  /** avatar çatı altında (kesit açık) */
  indoor: boolean;
  /** kamera–avatar doğrusu bir duvarı kesiyor (pencere açık) */
  occluded: boolean;
}

export interface WalkState {
  active: boolean;
  /** dünya kimliği (konum kaydı dünya başına; W4 `PUT /api/walk/position`) */
  world: string | null;
  view: WalkView;
  pose: WalkPose | null;
  /** tıkla-git / Yakındakiler hedefi (null: serbest) */
  target: Tile | null;
  nearby: readonly NearbyItem[];
  /** etkileşim ipucunun hedefi (F) */
  focusId: string | null;
  cover: WalkCover;
  /** açık panel (W3: Konuş paneli vb.); Esc önce bunu kapatır */
  panel: string | null;
  /** birinci şahıs uyarısı gösterildi mi (W5 ayara bağlar) */
  firstPersonOk: boolean;
  /** W3 (WALK-UX): avatarın taşıdığı çıktı (parşömen); `walkRuntime.carry` ile aynı nesne */
  carry: WalkCarry | null;
  /** W5: fotoğraf modu (P) — HUD gizli, serbest kamera (yürüme sınırında) */
  photo: boolean;
  /** W5: emote çarkı açık (G / T, dokunmatikte uzun basma) */
  emoteWheel: boolean;
  /** W5: son oynatılan emote (ekran okuyucu ve HUD; avatar hareket edince null) */
  emote: EmoteKind | null;
  /** W5: "Ben" avatar editörü açık */
  editor: boolean;

  enter: (world: string, pose?: WalkPose | null) => void;
  exit: () => void;
  toggleView: () => void;
  setView: (v: WalkView) => void;
  setTarget: (t: Tile | null) => void;
  setPanel: (p: string | null) => void;
  /** W3: parşömen al / bırak (depo + `walkRuntime.carry`) */
  setCarry: (c: WalkCarry | null) => void;
  /** W5: fotoğraf modu aç/kapa (çark ve panel kapanır) */
  setPhoto: (on: boolean) => void;
  setEmoteWheel: (on: boolean) => void;
  setEmote: (e: EmoteKind | null) => void;
  setEditor: (on: boolean) => void;
  /** Esc: fotoğraf modu / emote çarkı / açık panel varsa kapatır ("panel"), yoksa moddan çıkar ("exit"); mod kapalıysa "none" */
  escape: () => "panel" | "exit" | "none";
  /** WalkRig çağırır: yalnızca değişince yazar */
  syncPose: (p: WalkPose) => void;
  syncNearby: (list: readonly NearbyItem[], focusId: string | null) => void;
  syncCover: (c: WalkCover) => void;
}

/** W3 (WALK-UX): taşınan çıktı (§5.2 pano → ajana teslim). WALK-FUN avatarın elinde parşömen olarak çizer. */
export interface WalkCarry { kind: "scroll"; deliverableId: string; title: string }
/** W3: avatarın oturma pozu (bank, minder, şezlong); WALK-FUN çizer ve avatar hareket edince null yapar. */
export interface WalkSit { pose: "sit_bench" | "sit_ground" | "lounge"; x: number; z: number; heading: number; y?: number }

/** W3 panel kimlikleri: `talk:<slug>` (Konuş paneli) · `ent:<entityId>` (pano, kahve, bank, olta, masa). */
export const talkPanelId = (slug: string) => `talk:${slug}`;
export const entityPanelId = (id: string) => `ent:${id}`;
export function parsePanel(p: string | null): { kind: "talk" | "ent"; id: string } | null {
  if (!p) return null;
  if (p.startsWith("talk:")) return { kind: "talk", id: p.slice(5) };
  if (p.startsWith("ent:")) return { kind: "ent", id: p.slice(4) };
  return null;
}

/** W5 (§6.4): emote'lar (hepsi ücretsiz, kozmetik). Sıra = çarktaki yer ve 1–6 rakamları. */
export const EMOTES = ["wave", "dance", "cheer", "sit", "laugh", "think"] as const;
export type EmoteKind = (typeof EMOTES)[number];

export const NO_NEARBY: readonly NearbyItem[] = Object.freeze([]) as readonly NearbyItem[];
const COVER_NONE: WalkCover = Object.freeze({ indoor: false, occluded: false }) as WalkCover;
const OCT = Math.PI / 4;
export const quantizeHeading = (h: number) => Math.round(h / OCT) * OCT;

export const useWalkStore = create<WalkState>((set, get) => ({
  active: false,
  world: null,
  view: "third",
  pose: null,
  target: null,
  nearby: NO_NEARBY,
  focusId: null,
  cover: COVER_NONE,
  panel: null,
  firstPersonOk: false,
  carry: null,
  photo: false,
  emoteWheel: false,
  emote: null,
  editor: false,

  enter: (world, pose = null) => set({ active: true, world, pose, target: null, panel: null, nearby: NO_NEARBY, focusId: null, cover: COVER_NONE, view: "third",
    photo: false, emoteWheel: false, emote: null }),
  exit: () => {
    walkRuntime.input.x = 0; walkRuntime.input.y = 0; walkRuntime.joy.x = 0; walkRuntime.joy.y = 0; walkRuntime.run = false; walkRuntime.jump = 0;
    walkRuntime.carry = null; walkRuntime.sit = null; walkRuntime.anchor.ok = false; walkRuntime.emote = null; walkRuntime.capture = null;
    set({ active: false, target: null, panel: null, nearby: NO_NEARBY, focusId: null, cover: COVER_NONE, carry: null, photo: false, emoteWheel: false, emote: null, editor: false });
  },
  toggleView: () => set((s) => ({ view: s.view === "third" ? "first" : "third", firstPersonOk: true })),
  setView: (view) => set({ view }),
  setTarget: (target) => set({ target }),
  setPanel: (panel) => set({ panel }),
  setCarry: (carry) => { walkRuntime.carry = carry; set({ carry }); },
  setPhoto: (photo) => { if (photo && !get().active) return; walkRuntime.capture = null; set(photo ? { photo, emoteWheel: false, panel: null, target: null } : { photo }); },
  setEmoteWheel: (emoteWheel) => set(emoteWheel && get().photo ? {} : { emoteWheel }),
  setEmote: (emote) => { if (get().emote !== emote) set({ emote }); },
  setEditor: (editor) => set({ editor }),
  escape: () => {
    const s = get();
    if (!s.active) return "none";
    if (s.photo) { s.setPhoto(false); return "panel"; }
    if (s.emoteWheel) { set({ emoteWheel: false }); return "panel"; }
    if (s.panel) { set({ panel: null }); return "panel"; }
    s.exit();
    return "exit";
  },
  syncPose: (p) => {
    const cur = get().pose;
    const h = quantizeHeading(p.heading);
    if (cur && cur.tile[0] === p.tile[0] && cur.tile[1] === p.tile[1] && cur.heading === h) return;
    set({ pose: { x: p.x, z: p.z, heading: h, tile: p.tile } });
  },
  syncNearby: (list, focusId) => {
    const s = get();
    const next = list.length ? list : NO_NEARBY;
    if (sameNearby(s.nearby, next) && s.focusId === focusId) return;
    set({ nearby: next, focusId });
  },
  syncCover: (c) => {
    const cur = get().cover;
    if (cur.indoor === c.indoor && cur.occluded === c.occluded) return;
    set({ cover: c.indoor || c.occluded ? { indoor: c.indoor, occluded: c.occluded } : COVER_NONE });
  },
}));

// ------------------------------------------------------------------------------------------ hazır seçiciler (ilkel ya da kararlı referans)
export const useWalkActive = () => useWalkStore((s) => s.active);
export const useWalkView = () => useWalkStore((s) => s.view);
export const useWalkPose = () => useWalkStore((s) => s.pose);
export const useWalkTarget = () => useWalkStore((s) => s.target);
export const useWalkNearby = () => useWalkStore((s) => s.nearby);
export const useWalkFocus = () => useWalkStore((s) => s.focusId);
export const useWalkIndoor = () => useWalkStore((s) => s.cover.indoor);
export const useWalkOccluded = () => useWalkStore((s) => s.cover.occluded);
export const useWalkPanel = () => useWalkStore((s) => s.panel);
export const useWalkCarry = () => useWalkStore((s) => s.carry);
export const useWalkPhoto = () => useWalkStore((s) => s.photo);
export const useWalkEmoteWheel = () => useWalkStore((s) => s.emoteWheel);
export const useWalkEmote = () => useWalkStore((s) => s.emote);
export const useWalkEditor = () => useWalkStore((s) => s.editor);

// ------------------------------------------------------------------------------------------ kare başı çalışma durumu
export interface WalkRuntime {
  /** avatarın kesin durumu (WalkRig her karede yazar) */
  avatar: AvatarState;
  /** klavye girdisi (input.ts `attachWalkKeyboard` yazar) */
  input: MoveInput;
  /** dokunmatik joystick girdisi (HUD `JoystickModel.vector(walkRuntime.joy)` yazar); WalkRig `combineInput` ile birleştirir */
  joy: MoveInput;
  run: boolean;
  /** kamera açısı (yaw) adımı: Q/E ±1 (45°); WalkRig tüketir ve sıfırlar */
  yawSteps: number;
  /** son Q/E basışı hareket azaltmada geldi: dönüş anında (tween yok) */
  yawSnap: boolean;
  /** takip mesafesi çarpanı adımı: +/− (WalkRig tüketir) */
  zoomSteps: number;
  /** avatar karede görünür mü (birinci şahısta false: Crowd avatar örneğini gizler) */
  visible: boolean;
  /** WalkRig bağlı ve mod açık */
  live: boolean;
  /** W3 (WALK-UX yazar, WALK-FUN çizer): elde taşınan parşömen */
  carry: WalkCarry | null;
  /** W3: oturma pozu (WALK-FUN hareket edince null yapar) */
  sit: WalkSit | null;
  /** W3: kahve yudumu bitiş anı (performance.now() ms; 0 = yok). WALK-FUN `playSelf("coffee")` yazar */
  sip: number;
  /** "Ben" etiketinin son karedeki ekran kutusu (canvas CSS px; çizilmediyse null) — HUD yerleşim denetimi okur.*/
  meLabel: [number, number, number, number] | null;
  /** W3: Konuş panelinin bağlandığı ajanın ekran konumu (px, dünya kabına göre); WalkPanelAnchor yazar */
  anchor: { x: number; y: number; ok: boolean };
  /** W5: oynayan emote (Crowd avatar duruşunu buradan alır; hareket edince WalkRig null yapar). `t0` performance.now() ms */
  emote: { kind: EmoteKind; t0: number; until: number } | null;
  /** W5: sürekli kamera dönüşü (rad; iki parmak çevirme, fotoğraf modunda sürükleme). WalkRig tüketir ve sıfırlar */
  yawDelta: number;
  /** W5: fotoğraf kamerası eğim değişimi (rad); WalkRig tüketir */
  pitchDelta: number;
  /** W5: takip mesafesi çarpanı (kıstırma; 1 = değişmez). WalkRig tüketir ve 1 yapar */
  zoomMul: number;
  /** W5: fotoğraf karesi isteği — WalkRig o karede sahneyi bir kez daha çizip tuvali hemen bu işleve verir (preserveDrawingBuffer yok) */
  capture: ((gl: HTMLCanvasElement) => void) | null;
  /** W5: fotoğraf kamerasının odağı (dünya x/z); fotoğraf modunda WalkRig her kare yazar, dışında `ok = false`.
   * Sessiz/kutsal bölge denetimi avatara değil bu noktaya da bakar (serbest kamera bölgeye uçabilir).*/
  photoFocus: { x: number; z: number; ok: boolean };
  /** W5: ajan ruh hâlleri (`WorldLive.moods`; WalkRig bağlar) — emote duyurusu yalnız gerçekten karşılık verenleri sayar*/
  moods: ReadonlyMap<string, string> | null;
  /** WALK-SCALE: karakter çizim ölçeği (1 genel bakış → 0,72 yürüme; WalkRig geçişle yazar, Crowd/SceneFx okur) */
  humanScale: number;
  /** WALK-SCALE: serbest bakış eğimi değişimi (rad, + yukarı; fare, R/C, PageUp/PageDown, iki parmak). WalkRig tüketir */
  lookDelta: number;
  /** WALK-SCALE: işaretçi kilidi bırakıldığı an (performance.now() ms): aynı Esc moddan çıkarmasın */
  lockReleasedAt: number;
  /** taban sahnenin büyümüş dünyadaki kayması (karo; `controller.baseOffset`). WalkRig yazar; konum kaydı
   * (lib/walk.ts) avatar konumunu bundan çıkarıp taban göreli saklar.*/
  baseOffset: Tile;
  /** WALK-PHYS: bekleyen zıplama basışları (Boşluk, dokunmatik Zıpla düğmesi); WalkRig tüketir ve sıfırlar */
  jump: number;
  /** WALK-PHYS: avatarın çizim yüksekliği (ayak y'si, basamak çıkışında yumuşatılmış); WalkRig yazar, Crowd okur */
  drawY: number;
  /** (transit): yolculuk sahnesi sürüyorsa avatarı bu yazar (WalkRig adım/çarpışma yerine çağırır); yoksa null.
   * `t` sahne saati (R3F `clock.elapsedTime`, Blocks.tsx dönen blokları aynı saatle çizer; gözlem çarkı kabini).*/
  ride: ((a: AvatarState, dt: number, t?: number) => void) | null;
}

export const walkRuntime: WalkRuntime = {
  avatar: createAvatar(0, 0),
  input: { x: 0, y: 0 },
  joy: { x: 0, y: 0 },
  run: false,
  yawSteps: 0,
  yawSnap: false,
  zoomSteps: 0,
  visible: false,
  live: false,
  carry: null,
  sit: null,
  sip: 0,
  meLabel: null,
  anchor: { x: 0, y: 0, ok: false },
  emote: null,
  yawDelta: 0,
  pitchDelta: 0,
  zoomMul: 1,
  capture: null,
  photoFocus: { x: 0, z: 0, ok: false },
  moods: null,
  humanScale: 1,
  lookDelta: 0,
  lockReleasedAt: 0,
  baseOffset: [0, 0],
  jump: 0,
  drawY: 0,
  ride: null,
};
