/**
 * Dünya yapıcı — üstten ızgara editörü (SVG; 1 karo = 1 birim, genişliğe ölçeklenir → 375 px'te taşmaz).
 * Fare/dokunma: seçili araçla karoya uygula, sürükleyerek boya/sil, Seç aracında eşyayı sürükleyerek taşı.
 * Klavye: ızgara odaklıyken ok tuşları imleci taşır, Enter/Boşluk aracı uygular, Shift+ok seçili eşyayı taşır,
 * R döndürür, Delete kaldırır, Esc seçimi bırakır. İmleç karosunun içeriği canlı bölgede duyurulur.
 */
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useT } from "../../lib/i18n";
import {
  applyItem, eraseAt, lightTile, movePrefabAt, navAt, PALETTE_BY_ID, prefabAt, removePrefab, rotatePrefabAt, rotateStationAt,
  useEditor,
} from "../../lib/builder";
import { builder as M } from "../../locales/builder";
import { ATMOSPHERE, cellsOf, type Prefab } from "../../voxel/prefabs";
import type { Tile, ToolKind } from "../../voxel/scenes";
import type { Issue, WorldFile } from "../../voxel/worldFormat";

export const SPOT_COLOR: Record<ToolKind, string> = { web: "#0EA5E9", read: "#F59E0B", plan: "#10B981", shell: "#64748B", write: "#EC4899" };
const SPOT_LETTER: Record<ToolKind, string> = { web: "W", read: "R", plan: "P", shell: "S", write: "Y" };

/** Prefab'ın üstten görünüm rengi. */
export function prefabColor(p: Prefab): string {
  switch (p.t) {
    case "cube": case "flag": case "sea": case "crate": case "bookshelf": case "sofa": case "rock": return p.c;
    case "decor": return p.parts[0]?.[6] ?? "#9CA3AF";
    case "desk": case "table": return p.top;
    case "wall": return p.c ?? p.colors?.[0]?.[p.colors[0].length - 1] ?? "#E2DACB";
    case "lantern": case "lamp": return p.glow;
    case "terminal": return "#1F2937";
    case "plant": return "#2F855A";
    case "tree": return "#3E8E3E";
    case "pine": return "#1F5130";
    case "palm": return "#38B25A";
    case "snowyPine": return "#CBD5E1";
    case "sandbags": return "#CDB287";
    case "campfire": return "#FF7A1A";
    case "snowman": return "#F8FAFC";
    default: return "#64748B";
  }
}

const isFloorLevel = (p: Prefab) => (p.t === "cube" && p.y + (p.h ?? 1) <= 0) || p.t === "sea";

/** İki karo arasındaki karolar (başlangıç hariç, bitiş dahil) — Bresenham. */
function line([x0, y0]: Tile, [x1, y1]: Tile): Tile[] {
  const out: Tile[] = [];
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, x = x0, y = y0;
  while (x !== x1 || y !== y1) {
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
    out.push([x, y]);
  }
  return out;
}

/** Yüz açısı → ekrandaki ok (aşağı = +z). */
function faceArrow(face: number): [number, number] {
  return [Math.round(Math.sin(face) * 100) / 100, Math.round(Math.cos(face) * 100) / 100];
}

export function GridEditor({ world, issues, showGrid, label }: { world: WorldFile; issues: Issue[]; showGrid: boolean; label: string }) {
  const t = useT(M);
  const svg = useRef<SVGSVGElement>(null);
  const tool = useEditor((s) => s.tool);
  const itemId = useEditor((s) => s.item);
  const selected = useEditor((s) => s.selected);
  const cursor = useEditor((s) => s.cursor);
  const focusTile = useEditor((s) => s.focusTile);
  const apply = useEditor((s) => s.apply);
  const endStroke = useEditor((s) => s.endStroke);
  const setE = useEditor((s) => s.set);
  const [hover, setHover] = useState<Tile | null>(null);
  const [focused, setFocused] = useState(false);
  const drag = useRef<{ stroke: string; last: Tile; mode: "paint" | "move" | "once" } | null>(null);
  const { w: gw, d: gd } = world.grid;

  const issueTiles = useMemo(() => {
    const m = new Map<string, "error" | "warning">();
    for (const i of issues) if (i.tile) { const k = `${i.tile[0]},${i.tile[1]}`; if (m.get(k) !== "error") m.set(k, i.level); }
    return m;
  }, [issues]);

  const tileAt = (e: PointerEvent): Tile | null => {
    const r = svg.current?.getBoundingClientRect();
    if (!r) return null;
    const i = Math.floor(((e.clientX - r.left) / r.width) * gw), j = Math.floor(((e.clientY - r.top) / r.height) * gd);
    return i >= 0 && j >= 0 && i < gw && j < gd ? [i, j] : null;
  };

  /** Seçili aracı karoya uygular; sürükleme vuruşu tek geri alma adımıdır. */
  const act = (tile: Tile, stroke: string) => {
    const [i, j] = tile;
    if (tool === "erase") { apply((w) => eraseAt(w, i, j), stroke); return; }
    if (tool === "select") {
      const idx = prefabAt(world, i, j);
      setE({ selected: idx, cursor: tile });
      return;
    }
    const item = PALETTE_BY_ID.get(itemId);
    if (item) apply((w) => applyItem(w, item, i, j), stroke);
  };

  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    const tile = tileAt(e);
    if (!tile) return;
    svg.current?.setPointerCapture(e.pointerId);
    const stroke = `s${e.timeStamp}`;
    const item = PALETTE_BY_ID.get(itemId);
    const continuous = tool === "erase" || (tool === "draw" && !!item && ["floor", "void", "water", "pond"].includes(item.kind));
    if (tool === "select") {
      const idx = prefabAt(world, tile[0], tile[1]);
      setE({ selected: idx, cursor: tile });
      drag.current = idx != null ? { stroke, last: tile, mode: "move" } : null;
      return;
    }
    act(tile, stroke);
    setE({ cursor: tile });
    drag.current = { stroke, last: tile, mode: continuous ? "paint" : "once" };
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const tile = tileAt(e);
    setHover(tile);
    const d = drag.current;
    if (!d || !tile || (tile[0] === d.last[0] && tile[1] === d.last[1])) return;
    if (d.mode === "paint") for (const step of line(d.last, tile)) act(step, d.stroke); // hızlı sürüklemede karo atlanmaz
    else if (d.mode === "move" && selected != null) {
      const [di, dj] = [tile[0] - d.last[0], tile[1] - d.last[1]];
      const prev = useEditor.getState().world;
      apply((w) => movePrefabAt(w, selected, di, dj), d.stroke);
      // taşıma ızgara dışına çıktıysa eşya yerinde kalır: son karo yalnızca başarıda ilerler
      if (useEditor.getState().world === prev) return;
    }
    d.last = tile;
  };
  const onUp = () => { drag.current = null; endStroke(); };

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const dirs: Record<string, Tile> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const dir = dirs[e.key];
    if (dir) {
      e.preventDefault();
      if (e.shiftKey && selected != null) { apply((w) => movePrefabAt(w, selected, dir[0], dir[1])); return; }
      setE({ cursor: [Math.max(0, Math.min(gw - 1, cursor[0] + dir[0])), Math.max(0, Math.min(gd - 1, cursor[1] + dir[1]))] });
      return;
    }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(cursor, `k${e.timeStamp}`); endStroke(); return; }
    if ((e.key === "r" || e.key === "R") && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (selected != null) apply((w) => rotatePrefabAt(w, selected));
      else if (navAt(world, cursor[0], cursor[1])?.kind === "station") apply((w) => rotateStationAt(w, cursor[0], cursor[1]));
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && selected != null) { e.preventDefault(); apply((w) => removePrefab(w, selected)); setE({ selected: null }); return; }
    if (e.key === "Escape") setE({ selected: null });
  };

  // imleç karosunun içeriği (ekran okuyucu)
  const status = useMemo(() => {
    const [i, j] = cursor;
    const parts: string[] = [];
    const idx = prefabAt(world, i, j);
    if (idx != null) parts.push(t(`type_${world.layers.prefabs[idx].t}` as never));
    const nav = navAt(world, i, j);
    if (nav) parts.push(nav.kind === "spot" ? t("nav_spot", { kind: t(`kind_${nav.spot}` as never) }) : t(`nav_${nav.kind}` as never));
    if (!parts.length && world.layers.ground?.[j]?.[i]) parts.push(t("cursor_floor"));
    return t("cursor_status", { i, j, what: parts.join(", ") || t("cursor_empty") });
  }, [cursor, world, t]);

  const selCells = selected != null && world.layers.prefabs[selected] ? cellsOf(world.layers.prefabs[selected]) : [];
  const ground = world.layers.ground;

  return (
    <div className="relative w-full">
      <svg ref={svg} viewBox={`0 0 ${gw} ${gd}`} className="block w-full h-auto touch-none select-none rounded-lg border-2 border-line bg-panel-3 outline-none focus-visible:ring-4 focus-visible:ring-primary/40"
        role="application" aria-label={`${label}. ${t("grid_aria", { d: gd })}`} aria-describedby="builder-cursor-status" tabIndex={0}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={() => setHover(null)}
        onKeyDown={onKey} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        style={{ cursor: tool === "select" ? "pointer" : "crosshair", aspectRatio: `${gw} / ${gd}` }}>
        <defs>
          <pattern id="builder-void" width="0.5" height="0.5" patternUnits="userSpaceOnUse">
            <rect width="0.5" height="0.5" fill="#1E293B" />
            <path d="M0 0.5 L0.5 0" stroke="#334155" strokeWidth="0.06" />
          </pattern>
        </defs>
        {/* zemin */}
        {Array.from({ length: gd }, (_, j) => Array.from({ length: gw }, (_, i) => {
          const c = ground?.[j]?.[i] ?? null;
          return <rect key={`g${i},${j}`} x={i} y={j} width={1.01} height={1.01} fill={c ?? "url(#builder-void)"} />;
        }))}
        {/* zemin düzeyindeki prefab'lar (su, güverte) önce */}
        {world.layers.prefabs.map((p, k) => (isFloorLevel(p) ? <rect key={`f${k}`} x={(p as { i: number }).i} y={(p as { j: number }).j} width={1.01} height={1.01}
          fill={prefabColor(p)} opacity={p.t === "sea" ? 0.85 : 1} /> : null))}
        {/* eşyalar */}
        {world.layers.prefabs.map((p, k) => {
          if (ATMOSPHERE.has(p.t) || isFloorLevel(p) || (p.t === "decor" && p.free)) return null;
          const cells = cellsOf(p);
          const solid = p.t !== "decor" || !!p.cells?.length;
          const fill = p.t === "block" ? "none" : prefabColor(p);
          return (
            <g key={`p${k}`}>
              {cells.map(([i, j]) => (
                <rect key={`${i},${j}`} x={i + 0.1} y={j + 0.1} width={0.8} height={0.8} rx={0.12} fill={fill}
                  stroke={p.t === "block" ? "#EF4444" : "#111827"} strokeWidth={0.06} strokeDasharray={solid ? undefined : "0.15 0.1"} opacity={solid ? 1 : 0.75} />
              ))}
              {p.t === "block" && cells.map(([i, j]) => <path key={`x${i},${j}`} d={`M${i + 0.25} ${j + 0.25} L${i + 0.75} ${j + 0.75} M${i + 0.75} ${j + 0.25} L${i + 0.25} ${j + 0.75}`} stroke="#EF4444" strokeWidth={0.07} />)}
            </g>
          );
        })}
        {/* ışıklar */}
        {world.layers.lights.map((l, k) => {
          const [i, j] = lightTile(l);
          return <circle key={`l${k}`} cx={i + 0.5} cy={j + 0.5} r={0.22} fill={l.color} stroke="#B45309" strokeWidth={0.07} />;
        })}
        {/* navigasyon */}
        {world.nav.rest.map(([i, j], k) => (
          <g key={`r${k}`}>
            <rect x={i + 0.22} y={j + 0.22} width={0.56} height={0.56} rx={0.1} fill="#A78BFA" stroke="#FFFFFF" strokeWidth={0.06} />
            <text x={i + 0.5} y={j + 0.66} textAnchor="middle" fontSize={0.42} fontWeight={700} fill="#1F1147">z</text>
          </g>
        ))}
        {(Object.entries(world.nav.spots) as [ToolKind, { tile: Tile }[]][]).flatMap(([kind, list]) => list.map((s, k) => (
          <g key={`s${kind}${k}`}>
            <path d={`M${s.tile[0] + 0.5} ${s.tile[1] + 0.16} L${s.tile[0] + 0.84} ${s.tile[1] + 0.5} L${s.tile[0] + 0.5} ${s.tile[1] + 0.84} L${s.tile[0] + 0.16} ${s.tile[1] + 0.5} Z`}
              fill={SPOT_COLOR[kind]} stroke="#FFFFFF" strokeWidth={0.06} />
            <text x={s.tile[0] + 0.5} y={s.tile[1] + 0.63} textAnchor="middle" fontSize={0.36} fontWeight={700} fill="#FFFFFF">{SPOT_LETTER[kind]}</text>
          </g>
        )))}
        {world.nav.stations.map((s, k) => {
          const [dx, dy] = faceArrow(s.face);
          const cx = s.tile[0] + 0.5, cy = s.tile[1] + 0.5;
          return (
            <g key={`st${k}`}>
              <circle cx={cx} cy={cy} r={0.3} fill="#2563EB" stroke="#FFFFFF" strokeWidth={0.07} />
              <path d={`M${cx + dx * 0.42} ${cy + dy * 0.42} L${cx - dy * 0.16} ${cy + dx * 0.16} L${cx + dy * 0.16} ${cy - dx * 0.16} Z`} fill="#FFFFFF" />
            </g>
          );
        })}
        {/* sorunlu karolar */}
        {[...issueTiles].map(([k, level]) => {
          const [i, j] = k.split(",").map(Number);
          return <rect key={`i${k}`} x={i + 0.04} y={j + 0.04} width={0.92} height={0.92} fill="none" stroke={level === "error" ? "#DC2626" : "#D97706"}
            strokeWidth={0.1} strokeDasharray="0.2 0.12" />;
        })}
        {focusTile && <rect x={focusTile[0] - 0.08} y={focusTile[1] - 0.08} width={1.16} height={1.16} fill="none" stroke="#DC2626" strokeWidth={0.14} rx={0.1} />}
        {/* seçim, imleç, üzerine gelme */}
        {selCells.map(([i, j]) => <rect key={`sel${i},${j}`} x={i + 0.02} y={j + 0.02} width={0.96} height={0.96} fill="none" stroke="#FACC15" strokeWidth={0.12} />)}
        {hover && <rect x={hover[0]} y={hover[1]} width={1} height={1} fill="#FFFFFF" opacity={0.22} pointerEvents="none" />}
        {focused && <rect x={cursor[0] + 0.04} y={cursor[1] + 0.04} width={0.92} height={0.92} fill="none" stroke="#FFFFFF" strokeWidth={0.08} strokeDasharray="0.18 0.1" />}
        {showGrid && (
          <g stroke="#000000" strokeOpacity={0.18} strokeWidth={0.025} pointerEvents="none">
            {Array.from({ length: gw + 1 }, (_, i) => <line key={`vx${i}`} x1={i} y1={0} x2={i} y2={gd} />)}
            {Array.from({ length: gd + 1 }, (_, j) => <line key={`hz${j}`} x1={0} y1={j} x2={gw} y2={j} />)}
          </g>
        )}
      </svg>
      <p id="builder-cursor-status" className="sr-only" aria-live="polite">{status}</p>
    </div>
  );
}
