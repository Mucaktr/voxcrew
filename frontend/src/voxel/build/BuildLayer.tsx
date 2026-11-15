/**
 * E3 (BUILD-UX) — yapı modu girdisi, seçim ve hayalet ( UX, §8). Yalnız yürüme modunda,
 * yalnız avatarın üstünde durduğu **kendi** parselinde açılır (D3 A). Hiçbir şey çizmez: hayalet, kapasite kuyruğunun ayrılmış
 * hayalet yuvasına yazılır (+0 çizim çağrısı).
 *
 * - Girdi (pencere yakalama aşaması; yalnız dünya bölümündeyken): **B** aç/kapat · **Sol tık / dokunma** koy · **sağ tık / uzun
 * basma** kır · **1–9** palet · **R** döndür · **Ctrl+Z / Ctrl+Y** geri al / yinele · **Ctrl+S** kaydet · **Esc** çık. Klavye
 * ızgara imleci: oklar karo, PgUp/PgDn kat, Enter koy, Delete kır. Yapı modunda tıkla-git kapalıdır (dünya tıklaması yutulur);
 * hareket WASD ve joystick ile sürer. Birinci şahısta (işaretçi kilidi) nişangâh, üçüncü şahısta imleç hedeftir.
 * - Seçim: `raycast.ts` (mantıksal hacim, DDA). Geçerlilik: `volume.ts checkPlace` (sunucu kuralları + gerçek arazi + destek +
 * kilit). Hayalet kırmızıysa koyma reddedilir ve nedeni HUD'da/duyuruda söylenir.
 * - Hareket azaltma: yerleştirme animasyonu yok (bloklar anında görünür).
*/
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { PALETTE_BY_ID } from "../../lib/builder";
import { applyBody, enterBuild, exitBuild, itemName, lockedDecor, otherEdits, redoBuild, requestExit, saveBuild, say, undoBuild } from "../../lib/build";
import { tx } from "../../lib/i18n";
import { build as BM } from "../../locales/build";
import { rotatePrefab, type Prefab } from "../prefabs";
import type { Block, Group } from "../scenes";
import { walkRuntime, useWalkStore } from "../walk/walkStore";
import { isTypingTarget } from "../walk/input";
import { pkey } from "../expanse/grid";
import type { PlacedPlot } from "../expanse/plots";
import type { ExpanseStream } from "../expanse/stream";
import { hasTail, tailVersion, writeTail } from "../expanse/tail";
import { itemOf, paletteOrder, tileKey, type PlotBody, type PlotPrefab } from "./catalog";
import { cellMin, ghostBars, solidCell } from "./mesh";
import { raycastVolume, type RayHit } from "./raycast";
import { useBuildStore, GHOST_SLOTS } from "./store";
import { buildTail, ghostOffset } from "./tailLayout";
import { addBlock, addPrefab, BODY_LAYERS, checkPlace, occupancy, prefabTiles, removeBlock, removePrefab, type BuildCode, type Occupancy, type PlaceContext } from "./volume";
import { AVATAR_RADIUS } from "../walk/controller";

export interface BuildBridge {
  world: string;
  stream: ExpanseStream | null;
  placed: readonly PlacedPlot[];
  groups: ReadonlySet<Group> | null;
  swatch: string | null;
  /** üretim + çizim sonrası kuyruğu güncelle (Outskirts) */
  ends: () => void;
}

interface Target {
  /** eylem hücresi (koy: boş hücre; kır: dolu hücre) */
  cell: [number, number, number];
  action: "place" | "break";
  code: BuildCode | null;
  /** hayalet kutusu (yerel hücre birimi): başlangıç ve boyut */
  box: { at: [number, number, number]; size: [number, number, number] };
  /** kır: prefab dizini */
  prefab?: number;
  /** koy: prefab öğesi */
  make?: PlotPrefab;
}

const LONG_PRESS_MS = 480;
const occCache = new WeakMap<PlotBody, Occupancy>();
const SLOP = 6;
const COLORS = { dark: "#0F172A", place: "#F8FAFC", break: "#FBBF24", bad: "#F87171" };

/** Dönüşle prefab (sandbags ekseni gibi yönlü olanlar döner; ötekiler aynı kalır). */
export function makePrefab(id: string, li: number, lj: number, rot: number): PlotPrefab | null {
  const item = PALETTE_BY_ID.get(id);
  if (!item?.make) return null;
  let p: Prefab = item.make(li, lj);
  for (let k = 0; k < (rot & 3); k++) p = rotatePrefab(p);
  return p as PlotPrefab;
}

/** Avatarın gövdesi (daire) gövde katmanındaki (y < 2) bu karolardan birine değiyor mu? Değiyorsa "self" (sıkışma olmasın). */
function onSelf(frame: { cx: number; cz: number; h0: number; origin: readonly [number, number] }, tiles: [number, number][], y: number): BuildCode | null {
  if (y >= BODY_LAYERS) return null;
  const a = walkRuntime.avatar, r = AVATAR_RADIUS + 0.02;
  for (const [li, lj] of tiles) {
    const [x0, , z0] = cellMin(frame, li, 0, lj);
    const dx = Math.max(x0 - a.x, 0, a.x - (x0 + 1)), dz = Math.max(z0 - a.z, 0, a.z - (z0 + 1));
    if (dx * dx + dz * dz < r * r) return "self";
  }
  return null;
}

export function BuildLayer({ bridge }: { bridge: React.MutableRefObject<BuildBridge> }) {
  const { camera, gl } = useThree();
  const ptr = useRef<{ x: number; y: number; inside: boolean; used: "mouse" | "touch" | "key" }>({ x: 0, y: 0, inside: false, used: "mouse" });
  const target = useRef<Target | null>(null);
  const ghostSig = useRef("");
  const rc = useRef(new THREE.Raycaster());

  /** Etkin parselin yerleşimi + çerçeve + yerleştirme bağlamı. */
  const session = () => {
    const st = useBuildStore.getState(), b = bridge.current, s = b.stream;
    if (!st.active || !st.plotId || !st.draft || !s) return null;
    const plot = b.placed.find((p) => p.id === st.plotId && !p.unplaced);
    if (!plot) return null;
    const frame = { cx: plot.cx, cz: plot.cz, h0: s.ctx.h0, origin: s.ctx.origin };
    const base = s.parcel(pkey(plot.cx, plot.cz));
    const terrain = base?.near?.walk ?? null;
    let entry: number | null = null;
    if (terrain) { // "Parselime git" karosu (plots.ts plotEntry ile aynı ölçüt)
      let bd = Infinity;
      for (let k = 0; k < terrain.length; k++) {
        if (!terrain[k]) continue;
        const d = ((k % 12) - 5.5) ** 2 + (Math.floor(k / 12) - 7.5) ** 2;
        if (d < bd) { bd = d; entry = k; }
      }
    }
    const body = st.draft;
    let occ = occCache.get(body);
    if (!occ) { occ = occupancy(body); occCache.set(body, occ); }
    const locked = lockedDecor();
    const ctx: PlaceContext = { occ, body, others: otherEdits(st.plotId), terrain, entry, locked: new Set(locked.keys()) };
    return { st, plot, frame, ctx, body };
  };

  /** Hedefi hesapla: klavye imleci ya da ışın. */
  const compute = (): Target | null => {
    const ses = session();
    if (!ses) return null;
    const { st, frame, ctx, body } = ses;
    const item = itemOf(st.item);
    if (!item) return null;
    const min = cellMin(frame, 0, 0, 0);
    const mk = (cell: [number, number, number], action: "place" | "break", hit?: RayHit | null): Target => {
      if (action === "break") {
        const kind = solidCell(ctx.occ.cells, ctx.occ.prefab, cell[0], cell[1], cell[2]);
        if (kind === "prefab") {
          const idx = ctx.occ.prefab[tileKey(cell[0], cell[2])];
          const tiles = prefabTiles(body.prefabs[idx]);
          const i0 = Math.min(...tiles.map((t) => t[0])), j0 = Math.min(...tiles.map((t) => t[1]));
          const i1 = Math.max(...tiles.map((t) => t[0])), j1 = Math.max(...tiles.map((t) => t[1]));
          return { cell, action, code: null, prefab: idx, box: { at: [i0, 0, j0], size: [i1 - i0 + 1, 1.6, j1 - j0 + 1] } };
        }
        return { cell, action, code: kind ? null : "empty", box: { at: cell, size: [1, 1, 1] } };
      }
      if (item.kind === "prefab") {
        const make = makePrefab(item.id, cell[0], cell[2], st.rot) ?? undefined;
        const tiles = make ? prefabTiles(make) : [[cell[0], cell[2]] as [number, number]];
        const i0 = Math.min(...tiles.map((t) => t[0])), j0 = Math.min(...tiles.map((t) => t[1]));
        const i1 = Math.max(...tiles.map((t) => t[0])), j1 = Math.max(...tiles.map((t) => t[1]));
        const code = cell[1] !== 0 || (hit && !hit.ground) ? "support" : checkPlace(ctx, item, cell, st.rot, make) ?? onSelf(frame, tiles, 0);
        return { cell, action, code, make, box: { at: [i0, 0, j0], size: [i1 - i0 + 1, 1.6, j1 - j0 + 1] } };
      }
      return { cell, action, code: checkPlace(ctx, item, cell, st.rot) ?? onSelf(frame, [[cell[0], cell[2]]], cell[1]), box: { at: cell, size: [1, 1, 1] } };
    };
    if (st.cursor && ptr.current.used === "key") {
      const c = st.cursor;
      const filled = !!solidCell(ctx.occ.cells, ctx.occ.prefab, c[0], c[1], c[2]);
      // imleç dolu hücredeyse hedef kırmaktır (Delete), boşsa koymak (Enter); "Kır" aracı her zaman kırar
      return mk(c, st.tool === "break" || filled ? "break" : "place");
    }
    // ışın: birinci şahısta işaretçi kilidi → nişangâh (ekran ortası); değilse imleç
    const locked = document.pointerLockElement === gl.domElement;
    const first = useWalkStore.getState().view === "first";
    let nx: number, ny: number;
    if (locked || (first && ptr.current.used !== "touch")) { nx = 0; ny = 0; }
    else if (ptr.current.inside || ptr.current.used === "touch") { nx = ptr.current.x; ny = ptr.current.y; }
    else return null;
    rc.current.setFromCamera(new THREE.Vector2(nx, ny), camera);
    const o = rc.current.ray.origin, d = rc.current.ray.direction;
    const solid = (li: number, y: number, lj: number) => solidCell(ctx.occ.cells, ctx.occ.prefab, li, y, lj);
    const hit = raycastVolume([o.x, o.y, o.z], [d.x, d.y, d.z], min, solid, 60);
    if (!hit) return null;
    if (st.tool === "break") return hit.hit ? mk(hit.hit, "break") : null;
    if (!hit.place) return hit.hit ? { ...mk(hit.hit, "break"), action: "place", code: "bounds" } : null;
    return mk(hit.place, "place", hit);
  };

  /** Hedefte eylem (koy ya da kır). */
  const act = (action: "place" | "break", t: Target | null = target.current) => {
    const ses = session();
    if (!ses || !t) return;
    const { st, body } = ses;
    const [li, y, lj] = t.cell;
    const where = { y: y + 1, i: li + 1, j: lj + 1 };
    if (action === "break") {
      const tt = t.action === "break" ? t : null;
      if (!tt) {
        // koy hedefi varken kır: ışının vurduğu dolu hücre yoksa yok
        say(tx(BM, "ghost_bad", { why: tx(BM, "code_empty") }));
        return;
      }
      if (tt.code) { say(tx(BM, "ghost_bad", { why: tx(BM, `code_${tt.code}` as never) })); return; }
      let next: PlotBody = body, name = "";
      if (tt.prefab !== undefined && tt.prefab >= 0) { const p = body.prefabs[tt.prefab]; name = p ? itemName(p.t) : ""; next = removePrefab(body, tt.prefab); }
      else {
        const e = body.edits.find((q) => q[0] === li && q[1] === y && q[2] === lj);
        name = e ? itemName(e[3]) : "";
        next = removeBlock(body, t.cell);
      }
      if (next !== body) applyBody(next, tx(BM, "ann_broken", { ...where, name }));
      return;
    }
    if (t.action !== "place") return;
    if (t.code) { say(tx(BM, "ghost_bad", { why: tx(BM, `code_${t.code}` as never) })); return; }
    const item = itemOf(st.item);
    if (!item) return;
    if (item.kind === "prefab") {
      if (!t.make) return;
      applyBody(addPrefab(body, t.make), tx(BM, "ann_placed", { ...where, name: itemName(item.id) }));
    } else {
      applyBody(addBlock(body, t.cell, item.id, st.rot), tx(BM, "ann_placed", { ...where, name: itemName(item.id) }));
    }
  };

  /** "İnşa" (B / HUD düğmesi): avatarın altındaki kendi parselinde aç; açıksa çık. */
  const toggle = () => {
    const st = useBuildStore.getState();
    if (st.active) { requestExit(); return; }
    const b = bridge.current, s = b.stream;
    if (!useWalkStore.getState().active) return;
    if (!b.placed.length) { st.set({ note: { code: "no_plots", tone: "warn" } }); say(tx(BM, "msg_no_plots")); return; }
    if (!s) return;
    const a = walkRuntime.avatar;
    const [cx, cz] = s.parcelAt(a.x, a.z);
    const plot = b.placed.find((p) => !p.unplaced && p.cx === cx && p.cz === cz);
    if (!plot) { st.set({ note: { code: "not_on_plot", tone: "warn" } }); say(tx(BM, "msg_not_on_plot")); return; }
    enterBuild(b.world, plot);
  };

  // HUD köprüsü
  useEffect(() => {
    useBuildStore.getState().set({ toggle });
    return () => { useBuildStore.getState().set({ toggle: null }); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // girdi: pencere yakalama aşaması (yürüme denetleyicisinden ve R3F tıklamasından önce)
  useEffect(() => {
    const canvas = gl.domElement;
    const container = canvas.parentElement ?? canvas;
    const section = canvas.closest("section") ?? container;
    const inWorld = (t: EventTarget | null) => !!t && t instanceof Node && section.contains(t);
    const inCanvas = (t: EventTarget | null) => !!t && t instanceof Node && container.contains(t);
    let down: { id: number; x: number; y: number; button: number; touch: boolean; timer: number; done: boolean } | null = null;
    let touches = 0;

    const setPtr = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      ptr.current.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      ptr.current.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
    };
    const onMove = (e: PointerEvent) => {
      if (!useBuildStore.getState().active) return;
      const inside = inCanvas(e.target);
      ptr.current.inside = inside;
      if (!inside) return;
      if (e.pointerType !== "touch") { ptr.current.used = "mouse"; setPtr(e); }
      if (down && e.pointerId === down.id && Math.hypot(e.clientX - down.x, e.clientY - down.y) > SLOP) { window.clearTimeout(down.timer); down.done = true; }
    };
    const onDown = (e: PointerEvent) => {
      if (!useBuildStore.getState().active || !inCanvas(e.target)) return;
      if (e.pointerType === "touch") touches++;
      if (touches > 1 && down) { window.clearTimeout(down.timer); down.done = true; return; }
      if (e.button !== 0 && e.button !== 2) return;
      setPtr(e);
      ptr.current.used = e.pointerType === "touch" ? "touch" : "mouse";
      ptr.current.inside = true;
      down = { id: e.pointerId, x: e.clientX, y: e.clientY, button: e.button, touch: e.pointerType === "touch", timer: 0, done: false };
      if (down.touch) {
        const d0 = down;
        d0.timer = window.setTimeout(() => {
          if (d0.done || down !== d0) return;
          d0.done = true;
          useBuildStore.getState().set({ cursor: null });
          const t = withTool("break");
          if (t) act("break", t);
        }, LONG_PRESS_MS);
      }
    };
    const withTool = (tool: "place" | "break"): Target | null => {
      const st = useBuildStore.getState(), prev = st.tool;
      if (prev === tool) return compute();
      st.set({ tool });
      const t = compute();
      st.set({ tool: prev });
      return t;
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType === "touch") touches = Math.max(0, touches - 1);
      if (!down || e.pointerId !== down.id) return;
      const d0 = down;
      down = null;
      window.clearTimeout(d0.timer);
      if (d0.done || !useBuildStore.getState().active || !inCanvas(e.target)) return;
      if (Math.hypot(e.clientX - d0.x, e.clientY - d0.y) > SLOP) return;
      // birinci şahısta kilitsiz ilk tık işaretçi kilidini alır (WalkRig); eylem yok
      if (!d0.touch && d0.button === 0 && useWalkStore.getState().view === "first" && document.pointerLockElement !== canvas) return;
      useBuildStore.getState().set({ cursor: null });
      const st = useBuildStore.getState();
      const tool = d0.button === 2 ? "break" : st.tool;
      const t = withTool(tool);
      if (t) act(tool, t);
    };
    // tıkla-git ve dünya seçimi yapı modunda kapalı
    const onClick = (e: MouseEvent) => {
      if (useBuildStore.getState().active && inCanvas(e.target)) { e.stopPropagation(); e.preventDefault(); }
    };
    const onMenu = (e: MouseEvent) => { if (useBuildStore.getState().active && inCanvas(e.target)) e.preventDefault(); };
    const onLeave = () => { ptr.current.inside = false; };

    const onKey = (e: KeyboardEvent) => {
      // yalnız dünya yüzeyi odaktayken (dünya kabı / tuval ya da sayfa gövdesi); HUD düğmeleri kendi Enter/Space'ini alır
      const tgt = e.target;
      const onWorld = tgt === document.body || (tgt instanceof Element && inWorld(tgt) && (tgt.contains(canvas) || inCanvas(tgt)));
      if (!useWalkStore.getState().active || e.defaultPrevented || isTypingTarget(tgt) || !onWorld) return;
      const st = useBuildStore.getState();
      const key = e.key, code = e.code, ctrl = e.ctrlKey || e.metaKey;
      const stop = () => { e.preventDefault(); e.stopPropagation(); };
      if ((code === "KeyB" || key === "b" || key === "B") && !ctrl && !e.altKey) { if (!e.repeat) toggle(); stop(); return; }
      if (!st.active) return;
      if (st.confirmExit) { if (key === "Escape") { st.set({ confirmExit: false }); stop(); } return; }
      if (ctrl && (code === "KeyZ" || key.toLowerCase() === "z")) { if (e.shiftKey) redoBuild(); else undoBuild(); stop(); return; }
      if (ctrl && (code === "KeyY" || key.toLowerCase() === "y")) { redoBuild(); stop(); return; }
      if (ctrl && (code === "KeyS" || key.toLowerCase() === "s")) { void saveBuild(); stop(); return; }
      if (key === "Escape") { requestExit(); stop(); return; }
      const digit = /^Digit([1-9])$/.exec(code)?.[1] ?? (/^[1-9]$/.test(key) ? key : null);
      if (digit && !ctrl) {
        const order = paletteOrder(bridge.current.swatch);
        const id = order[Number(digit) - 1];
        if (id) { st.set({ item: id, tool: "place" }); say(tx(BM, "ann_item", { name: itemName(id) })); }
        stop(); return;
      }
      if ((code === "KeyR" || key === "r" || key === "R") && !ctrl) {
        const rot = (st.rot + 1) & 3;
        st.set({ rot });
        say(tx(BM, "ann_rot", { deg: rot * 90 }));
        stop(); return;
      }
      const arrows: Record<string, [number, number, number]> = {
        ArrowLeft: [-1, 0, 0], ArrowRight: [1, 0, 0], ArrowUp: [0, 0, -1], ArrowDown: [0, 0, 1], PageUp: [0, 1, 0], PageDown: [0, -1, 0],
      };
      const mv = arrows[key];
      if (mv) {
        const c = st.cursor ?? target.current?.cell ?? [3, 0, 3];
        const next: [number, number, number] = [
          Math.max(0, Math.min(11, c[0] + mv[0])), Math.max(0, Math.min(7, c[1] + mv[1])), Math.max(0, Math.min(15, c[2] + mv[2])),
        ];
        ptr.current.used = "key";
        st.set({ cursor: next });
        say(tx(BM, "ann_cursor", { y: next[1] + 1, i: next[0] + 1, j: next[2] + 1 }));
        stop(); return;
      }
      if (key === "Enter" || code === "NumpadEnter") {
        const t = withTool("place");
        if (t) act("place", t);
        stop(); return;
      }
      if (key === "Delete" || key === "Backspace") {
        const t = withTool("break");
        if (t) act("break", t);
        stop(); return;
      }
    };
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("contextmenu", onMenu, true);
    window.addEventListener("keydown", onKey, true);
    container.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("contextmenu", onMenu, true);
      window.removeEventListener("keydown", onKey, true);
      container.removeEventListener("pointerleave", onLeave);
      if (down) window.clearTimeout(down.timer);
    };
  }, [gl]); // eslint-disable-line react-hooks/exhaustive-deps

  // yürüme modundan çıkınca yapı modu da kapanır (taslak cihazda kalır)
  useEffect(() => useWalkStore.subscribe((w) => {
    if (!w.active && useBuildStore.getState().active) exitBuild("keep");
  }), []);

  useFrame(() => {
    const st = useBuildStore.getState();
    const t = st.active ? compute() : null;
    target.current = t;
    // HUD bilgisi (yalnız değişince)
    const g = st.ghost;
    const info = t ? { cell: t.cell, action: t.action, code: t.code } : null;
    if ((g === null) !== (info === null) || (g && info && (g.code !== info.code || g.action !== info.action || g.cell.join() !== info.cell.join()))) st.set({ ghost: info });
    // hayalet çubukları (yalnız değişince yazılır)
    const ses = t ? session() : null;
    const sig = t && ses ? `${tailVersion()}|${t.box.at.join()}|${t.box.size.join()}|${t.action}|${t.code ?? ""}|${ses.frame.origin.join()}|${ses.frame.cx},${ses.frame.cz}` : "";
    if (sig === ghostSig.current) return;
    ghostSig.current = sig;
    writeGhost(t && ses ? { t, frame: ses.frame } : null);
    bridge.current.ends();
  });

  // söküm: hayalet temizlenir
  useEffect(() => () => { writeGhost(null); bridge.current.ends(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

/** Hayalet çubuklarını kuyruğun hayalet yuvasına yazar (null → gizle). */
function writeGhost(g: { t: Target; frame: { cx: number; cz: number; h0: number; origin: readonly [number, number] } } | null): void {
  const glow = hasTail("glow");
  if (!g) {
    writeTail("solid", ghostOffset("solid"), GHOST_SLOTS.solid, []);
    if (glow) writeTail("glow", ghostOffset("glow"), GHOST_SLOTS.glow, []);
    buildTail.ghost = false;
    return;
  }
  const { t, frame } = g;
  const min = cellMin(frame, t.box.at[0], t.box.at[1], t.box.at[2]);
  const light = t.code ? COLORS.bad : t.action === "break" ? COLORS.break : COLORS.place;
  const dark: Block[] = ghostBars(min, t.box.size, 0.09).map((b) => ({ ...b, c: COLORS.dark }));
  const bright: Block[] = ghostBars(min, t.box.size, 0.05).map((b) => ({ ...b, c: light, g: glow ? "glow" : "solid" }));
  if (glow) {
    writeTail("solid", ghostOffset("solid"), GHOST_SLOTS.solid, dark);
    writeTail("glow", ghostOffset("glow"), GHOST_SLOTS.glow, bright);
  } else {
    writeTail("solid", ghostOffset("solid"), GHOST_SLOTS.solid, [...dark, ...bright]);
  }
  buildTail.ghost = true;
}
