/**
 * FIX-UX (A3) — Yakındakiler seçimi ve "git ve aç".
 *
 * - Tab / Shift+Tab (dünya kabı odaktayken) yakındaki hedefler arasında **seçer** ve seçimi duyurur; avatar yürümez.
 * - Enter / F / Boşluk seçili hedefe yürür ve varınca panelini açar (ajan: Konuş paneli; nesne: kendi paneli; hatıra: al).
 * Yakındakiler listesinde bir öğeye tıklamak da aynısını yapar. Hedef kimlikle izlenir: yürüyüp uzaklaşan ajan yeniden
 * izlenir, yol bitince yeterince yakınsa panel yine açılır; ulaşılamazsa duyurulur.
 * - Yürüme tuşları seçimi ve bekleyen "git ve aç"ı bırakır (kullanıcı yönetimi aldı). Moddan çıkınca seçim silinir.
 *
 * Tuşlar dünya kabının üst bölümünde (section) yakalama evresinde dinlenir; yalnızca odak dünya kabındayken (role=application)
 * ve panel, çark, fotoğraf modu kapalıyken. Seçili hedef yoksa Enter/F eskisi gibi en yakın hedefe (focusId) gider.
*/
import { useCallback, useEffect, useRef, type RefObject } from "react";
import { create } from "zustand";
import { tp, useT } from "../../../lib/i18n";
import { walk as WM } from "../../../locales/walk";
import type { NearbyItem } from "../../../voxel/walk/controller";
import { tx, tz } from "../../../voxel/scenes";
import { useWalkStore, walkRuntime } from "../../../voxel/walk/walkStore";
import { entityTypeOf } from "./entities";
import { announceWalk, holdNearbyAnnouncements } from "./announce";
import { arrivalStep, cycleTarget, OPEN_RANGE, targetAction, trackProgress } from "./selectLogic";

interface SelState { id: string | null; pending: string | null }
export const useWalkSelect = create<SelState>(() => ({ id: null, pending: null }));
export const useWalkSelectedId = () => useWalkSelect((s) => s.id);
export const useWalkPendingId = () => useWalkSelect((s) => s.pending);

const MOVE_CODES = /^(KeyW|KeyA|KeyS|KeyD|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/;
const INTERACT_CODES = new Set(["Enter", "NumpadEnter", "KeyF", "KeyX", "Space"]);
const TICK_MS = 150;
/** son yaklaşmadan bu kadar (ms) içindeyse avatar "ilerliyor" sayılır.*/
const PROGRESS_MS = 4000;

type Item = Pick<NearbyItem, "id" | "kind" | "steps" | "bearing" | "dist" | "x" | "z" | "reach">;

export interface WalkSelectionOptions {
  nameOf: (it: Pick<NearbyItem, "id" | "kind">) => string;
  /** tür adı (ajan unvanı, "hayvan" …); boşsa ya da adla aynıysa yazılmaz */
  typeOf?: (it: Pick<NearbyItem, "id" | "kind">) => string;
  onInteract: (id: string) => void;
  onWalkTo: (x: number, z: number) => void;
  host?: RefObject<HTMLElement | null>;
  /** Tab sırası — Yakındakiler'in görünen satırları (gruptan en yakını); yoksa ham liste*/
  order?: () => readonly Item[];
  /** seçim yokken F/Enter'in en yakın hedefi (focusId) burada işlenirse true (ör. `info:` → bilgi kartı)*/
  intercept?: (id: string) => boolean;
}

export function useWalkSelection({ nameOf, typeOf, onInteract, onWalkTo, host, order, intercept }: WalkSelectionOptions) {
  const t = useT(WM);
  const ref = useRef({ nameOf, typeOf, onInteract, onWalkTo, t, order, intercept });
  ref.current = { nameOf, typeOf, onInteract, onWalkTo, t, order, intercept };
  // bekleyen "git ve aç" ayrıntısı (React dışı; 150 ms'de bir değerlendirilir)
  const job = useRef<{ id: string; name: string; start: number; walkAt: number; tx: number; tz: number; rewalks: number; /***/ best: number; closerAt: number; /** HQA-FIX*/ bestLeft: number; route: unknown; end?: readonly [number, number] | null } | null>(null);

  /** "Ada, araştırmacı — 3 adım, sağında" */
  const describe = useCallback((it: Item) => {
    const { nameOf: nm, typeOf: ty, t: tt } = ref.current;
    const name = nm(it);
    const type = ty?.(it) ?? "";
    const typed = type && type.toLocaleLowerCase() !== name.toLocaleLowerCase() ? `${name}, ${type}` : name;
    // W5: adım yürünecek yoldur; duvar ya da su arkasındaki hedef "yürüyerek ulaşılamaz"
    const steps = it.reach === false ? tt("unreachable") : tp(WM, "steps", it.steps);
    return `${typed} — ${steps}, ${tt(`dir_${it.bearing}` as const)}`;
  }, []);
  const actionText = useCallback((it: Pick<Item, "id" | "kind">) => { const e = entityTypeOf(it.id); return ref.current.t(e ? (`acte_${e}` as const) : (`act_${targetAction(it.id, it.kind)}` as const)); }, []);

  const cancel = useCallback(() => {
    job.current = null;
    if (useWalkSelect.getState().pending) useWalkSelect.setState({ pending: null });
  }, []);

  const go = useCallback((it: Item) => {
    const { nameOf: nm, onInteract: open, onWalkTo: walkTo, t: tt } = ref.current;
    job.current = null;
    if (it.dist <= OPEN_RANGE) {
      useWalkSelect.setState({ id: null, pending: null });
      open(it.id);
      return;
    }
    const now = performance.now();
    job.current = { id: it.id, name: nm(it), start: now, walkAt: now, tx: it.x, tz: it.z, rewalks: 0, best: Infinity, closerAt: now, bestLeft: Infinity, route: null };
    useWalkSelect.setState({ id: it.id, pending: it.id });
    walkTo(it.x, it.z);
    holdNearbyAnnouncements(5000);
    announceWalk(tt("sel_going", { name: nm(it) }));
  }, []);

  const cycle = useCallback((dir: 1 | -1) => {
    const st = useWalkStore.getState();
    const { t: tt } = ref.current;
    cancel();
    const list = ref.current.order?.() ?? st.nearby;
    const next = cycleTarget(list, useWalkSelect.getState().id, dir);
    const it = next ? st.nearby.find((n) => n.id === next) : undefined;
    if (!it) { useWalkSelect.setState({ id: null }); announceWalk(tt("sel_none")); return; }
    useWalkSelect.setState({ id: it.id });
    holdNearbyAnnouncements(6000);
    announceWalk(tt("sel_ann", { target: describe(it), action: actionText(it) }));
  }, [cancel, describe, actionText]);

  // mod kapanınca ya da panel açılınca bekleyiş biter; mod kapanınca seçim de silinir
  useEffect(() => useWalkStore.subscribe((s, prev) => {
    if (!s.active && prev.active) { job.current = null; useWalkSelect.setState({ id: null, pending: null }); return; }
    if (s.panel && !prev.panel) { job.current = null; useWalkSelect.setState({ id: null, pending: null }); }
  }), []);
  useEffect(() => () => { job.current = null; useWalkSelect.setState({ id: null, pending: null }); }, []);

  // "git ve aç" izleyicisi
  useEffect(() => {
    const id = window.setInterval(() => {
      const j = job.current;
      if (!j) return;
      const st = useWalkStore.getState();
      if (!st.active || st.photo || st.panel) { cancel(); return; }
      const it = st.nearby.find((n) => n.id === j.id);
      const a = walkRuntime.avatar;
      const now = performance.now();
      // yürüme noktasına yaklaşma izlenir (uzun yürüyüşte bekleyiş düşmesin; takılan avatar yine düşer)
      const gd = Math.hypot(j.tx - a.x, j.tz - a.z);
      trackProgress(j, gd, a.route, a.routeIdx, now); // HQA-FIX: rotanın kalan boyu da ilerleme
      const step = arrivalStep({
        dist: it ? Math.hypot(it.x - a.x, it.z - a.z) : null,
        focused: st.focusId === j.id,
        moving: !!st.target || !!a.route,
        sinceWalkMs: now - j.walkAt,
        elapsedMs: now - j.start,
        rewalks: j.rewalks,
        drift: it ? Math.hypot(it.x - j.tx, it.z - j.tz) : 0,
        goalDist: gd,
        progress: now - j.closerAt < PROGRESS_MS,
        endDist: j.end ? Math.hypot(tx(j.end[0]) - a.x, tz(j.end[1]) - a.z) : undefined, // HQA-FIX
      });
      if (step === "open") {
        job.current = null;
        useWalkSelect.setState({ id: null, pending: null });
        ref.current.onInteract(j.id);
      } else if (step === "rewalk" && it) {
        j.rewalks++; j.walkAt = now; j.tx = it.x; j.tz = it.z; j.best = Infinity; j.closerAt = now; j.bestLeft = Infinity; j.route = null; j.end = null;
        ref.current.onWalkTo(it.x, it.z);
      } else if (step === "fail") {
        cancel();
        const last = useWalkStore.getState().nearby.find((n) => n.id === j.id);
        announceWalk(ref.current.t(last?.reach === false ? "sel_unreachable" : "sel_failed", { name: j.name }));
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [cancel]);

  // klavye: Tab seçer, Enter/F seçiliye gider; yalnızca dünya kabı odaktayken (yakalama evresi; World.tsx'ten önce)
  useEffect(() => {
    const el = host?.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const st = useWalkStore.getState();
      if (!st.active || st.photo || st.panel || st.emoteWheel || st.editor) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.getAttribute?.("role") !== "application") return;
      if (e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        cycle(e.shiftKey ? -1 : 1);
        return;
      }
      if (INTERACT_CODES.has(e.code) || e.key === "Enter" || e.key === "f" || e.key === "F") {
        const sel = useWalkSelect.getState().id;
        const it = sel ? st.nearby.find((n) => n.id === sel) : undefined;
        if (!it) {
          // seçim yok: eski davranış (en yakın hedef); bilgi kartı hedefi WorldPage'e gitmez, kartı açar
          const f = st.focusId;
          if (f && ref.current.intercept && !e.repeat && ref.current.intercept(f)) { e.preventDefault(); e.stopPropagation(); }
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) go(it);
        return;
      }
      if (MOVE_CODES.test(e.code) && (useWalkSelect.getState().id || job.current)) {
        job.current = null;
        useWalkSelect.setState({ id: null, pending: null });
      }
    };
    el.addEventListener("keydown", onKey, true);
    return () => el.removeEventListener("keydown", onKey, true);
  }, [host, cycle, go]);

  return { describe, actionText, go, cycle, cancel };
}
