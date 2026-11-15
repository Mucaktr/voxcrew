/**
 * şehir kipinde mini harita: semtler (adlarıyla), landmark ayak izleri, ulaşım hatları, duraklar (ziyaret edilmiş: dolu),
 * varış meydanı ve avatar. Ziyaret edilmiş bir durağa tıklamak hızlı seyahattir (yalnız ziyaret edilmiş duraklar; aynı eylem
 * HUD'daki Hızlı seyahat listesinde klavyeyle). Çizim React dışında, ~5 Hz; renkler tema belirteçlerinden (açık/koyu).
 * Boyut tercihi ofis mini haritasıyla ortaktır (`voxcrew.world.minimap`: çip / kompakt / büyük; dar ekranda çip) ve kapsayan
 * bölüme `--mm-w` / `--mm-h` yazılır: yürüme HUD'unun alt satırı ve dokunmatik düğmeler haritayla çakışmaz (UIUX-OVERLAP).
 * landmark ayak izine tıklamak o simgenin bilgi kartını açar (durak tıklaması önce gelir; klavyede aynı kart `I` ve
 * Yakındakiler "Gör" bölümünden açılır).
*/
import clsx from "clsx";
import { Map as MapIcon, Minus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useT } from "../../../../lib/i18n";
import { city as CM } from "../../../../locales/city";
import { world as WM } from "../../../../locales/world";
import { stopId } from "../../../../voxel/citymap/catalog";
import { districtPlan } from "../../../../voxel/citymap/district";
import { GATE_D, GATE_W, stopTile } from "../../../../voxel/citymap/format";
import { districtName, fastTravel, stopName, useCity } from "../../../../voxel/citymap/store";
import { lineRoute } from "../../../../voxel/transit/model";
import { walkRuntime } from "../../../../voxel/walk/walkStore";
import { openInfo } from "../info/infoStore";
import { infoTargets } from "../info/infoTargets";

const SIZE_KEY = "voxcrew.world.minimap";
const MAP_W = { compact: 152, large: 288 } as const;
type Size = "chip" | keyof typeof MAP_W;

function loadSize(): Size {
  try {
    const v = window.localStorage.getItem(SIZE_KEY);
    if (v === "chip" || v === "compact" || v === "large") return v;
  } catch { /* gizli pencere / engelli depolama */ }
  // yatay telefonda (yükseklik ≤ 480) da çip — MiniMap.tsx ile aynı
  try { return window.matchMedia("(min-width: 640px) and (min-height: 481px)").matches ? "compact" : "chip"; } catch { return "compact"; }
}

export function CityMiniMap({ className }: { className?: string }) {
  const t = useT(CM);
  const tw = useT(WM);
  const view = useCity((s) => s.view);
  const found = useCity((s) => s.found);
  const canvas = useRef<HTMLCanvasElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const hit = useRef<{ id: string; x: number; y: number }[]>([]);
  const hitLm = useRef<{ district: string; lm: string; x0: number; y0: number; x1: number; y1: number }[]>([]);
  const [size, setSizeState] = useState<Size>(() => (typeof window === "undefined" ? "compact" : loadSize()));
  const setSize = (s: Size) => {
    try { window.localStorage.setItem(SIZE_KEY, s); } catch { /* yoksay */ }
    setSizeState(s);
  };
  const W = size === "chip" ? 0 : MAP_W[size];

  // --mm-w / --mm-h: alt satır ve dokunmatik düğmeler haritanın solunda/üstünde kalır
  useEffect(() => {
    const el = root.current, sec = el?.closest("section");
    if (!el || !sec) return;
    // çip dokunmatikte/dar ekranda 44 px (world.css) — sabit 36 yazılınca dokunmatik küme çipe 8 px biniyordu
    sec.style.setProperty("--mm-w", `${size === "chip" ? Math.max(36, Math.round(el.getBoundingClientRect().width)) : W + 16}px`);
    const h = () => sec.style.setProperty("--mm-h", `${Math.round(el.getBoundingClientRect().height)}px`);
    h();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(h) : null;
    ro?.observe(el);
    return () => { ro?.disconnect(); sec.style.removeProperty("--mm-w"); sec.style.removeProperty("--mm-h"); };
  }, [size, W]);

  useEffect(() => {
    if (!view || size === "chip") return;
    const map = view.map;
    // sınırlar (şehir karosu): semtler ∪ meydan
    let i0 = 0, j0 = 0, i1 = GATE_W, j1 = GATE_D;
    for (const d of map.districts) { i0 = Math.min(i0, d.bounds[0]); j0 = Math.min(j0, d.bounds[1]); i1 = Math.max(i1, d.bounds[0] + d.bounds[2]); j1 = Math.max(j1, d.bounds[1] + d.bounds[3]); }
    // CITY-HUD: dikey şehirler (<city>) haritayı bölüm boyu uzatmasın — çizim en çok kare (H ≤ W), yatayda ortalanır;
    // --mm-h küçük kalır, yürüme HUD'unun alt satırı kısa bölümde de sığar
    const pad = 2, scale = Math.min((W - pad * 2) / (i1 - i0), (W - pad * 2) / (j1 - j0)), H = Math.round((j1 - j0) * scale + pad * 2);
    const ox = Math.round((W - pad * 2 - (i1 - i0) * scale) / 2);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const c = canvas.current;
    if (!c) return;
    c.width = W * dpr; c.height = H * dpr; c.style.width = `${W}px`; c.style.height = `${H}px`;
    const X = (I: number) => pad + ox + (I - i0) * scale, Y = (J: number) => pad + (J - j0) * scale;
    const tok: Record<string, string> = {};
    const read = () => { const cs = getComputedStyle(root.current ?? document.documentElement); for (const n of ["--panel-2", "--panel-3", "--ink", "--ink-2", "--muted", "--sky", "--gold", "--grass-hi", "--red", "--line-soft"]) tok[n] = cs.getPropertyValue(n).trim() || "#888"; };
    read();
    let sig = "";
    const draw = () => {
      const st = useCity.getState(), a = walkRuntime.avatar;
      const s2 = `${Math.floor(a.x)},${Math.floor(a.z)}|${st.found.size}|${st.district}`;
      if (s2 === sig) return;
      sig = s2;
      const g = c.getContext("2d");
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      g.fillStyle = tok["--panel-2"]; g.fillRect(0, 0, W, H);
      g.font = "600 9px Inter, system-ui, sans-serif"; g.textBaseline = "middle"; g.textAlign = "center";
      hitLm.current = [];
      for (const d of map.districts) {
        const [a0, b0, w, dd] = d.bounds;
        g.fillStyle = d.id === st.district ? tok["--panel-3"] : tok["--panel-2"];
        g.fillRect(X(a0), Y(b0), w * scale, dd * scale);
        g.strokeStyle = tok["--line-soft"]; g.lineWidth = 1; g.strokeRect(X(a0) + 0.5, Y(b0) + 0.5, w * scale - 1, dd * scale - 1);
        const plan = districtPlan(map, d);
        g.fillStyle = tok["--muted"];
        for (const lm of plan.landmarks) {
          const x0 = X(a0 + lm.i0), y0 = Y(b0 + lm.j0);
          g.fillRect(x0, y0, lm.w * scale, lm.d * scale);
          hitLm.current.push({ district: d.id, lm: lm.id, x0, y0, x1: x0 + lm.w * scale, y1: y0 + lm.d * scale });
        }
        g.fillStyle = tok["--ink-2"];
        g.fillText(districtName(map.id, d.id), X(a0 + w / 2), Y(b0 + dd - 4), w * scale - 4);
      }
      // meydan
      g.fillStyle = tok["--gold"]; g.fillRect(X(0), Y(0), GATE_W * scale, GATE_D * scale);
      // hatlar
      g.strokeStyle = tok["--red"]; g.lineWidth = 2;
      for (const l of map.lines) {
        const r = lineRoute(map, l);
        g.beginPath();
        r.forEach(([I, J], k) => (k ? g.lineTo(X(I + 0.5), Y(J + 0.5)) : g.moveTo(X(I + 0.5), Y(J + 0.5))));
        g.stroke();
      }
      // duraklar
      hit.current = [];
      for (const s of map.stops) {
        const tl = stopTile(map, s);
        if (!tl) continue;
        const x = X(tl[0] + 0.5), y = Y(tl[1] + 0.5), seen = st.found.has(stopId(map.id, s.id));
        g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2);
        g.fillStyle = seen ? tok["--sky"] : tok["--panel-2"]; g.fill();
        g.strokeStyle = tok["--ink"]; g.lineWidth = 1.5; g.stroke();
        if (seen) hit.current.push({ id: s.id, x, y });
      }
      // avatar
      const ax = X(a.x + 12), ay = Y(a.z + 8);
      g.beginPath(); g.arc(ax, ay, 3.5, 0, Math.PI * 2); g.fillStyle = tok["--grass-hi"]; g.fill(); g.strokeStyle = tok["--ink"]; g.lineWidth = 1.5; g.stroke();
    };
    draw();
    const id = window.setInterval(draw, 200);
    const mo = new MutationObserver(() => { read(); sig = ""; draw(); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => { window.clearInterval(id); mo.disconnect(); };
  }, [view, size, W]);

  if (!view) return null;
  if (size === "chip") {
    return (
      <div ref={root} className={clsx("minimap pointer-events-auto", className)}>
        <button type="button" className="minimap-chip" onClick={() => setSize("compact")} aria-label={tw("minimap_open")} title={tw("minimap_open")}>
          <MapIcon size={16} aria-hidden="true" />
        </button>
      </div>
    );
  }
  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const best = hit.current.find((h) => Math.hypot(h.x - x, h.y - y) <= 8);
    if (best) { if (best.id !== useCity.getState().stop) fastTravel(best.id); return; }
    // landmark ayak izi (küçük izlerde 4 px pay) → bilgi kartı
    const lm = hitLm.current.find((h) => x >= h.x0 - 4 && x <= h.x1 + 4 && y >= h.y0 - 4 && y <= h.y1 + 4);
    const target = lm ? infoTargets().find((tg) => tg.scope === "map" && tg.district === lm.district && tg.landmark === lm.lm) : null;
    if (target) openInfo(target);
  };
  const stops = view.map.stops.map((s) => (found.has(stopId(view.city, s.id)) ? t("map_stop_visited", { stop: stopName(view.city, s.id) }) : t("map_stop_new", { stop: stopName(view.city, s.id) })));
  return (
    <div ref={root} className={clsx("minimap pointer-events-auto", className)}>
      <div className="minimap-panel" style={{ width: W + 12 }}>
        <div className="minimap-head">
          <MapIcon size={13} aria-hidden="true" />
          <span className="minimap-title">{t("map_title")}</span>
          <button type="button" className="minimap-btn" onClick={() => setSize("chip")} aria-label={tw("minimap_collapse")} title={tw("minimap_collapse")}>
            <Minus size={14} aria-hidden="true" />
          </button>
        </div>
        <canvas ref={canvas} role="img" aria-label={`${t("map_aria")} ${stops.join(", ")}`} onClick={onClick} className="minimap-canvas cursor-pointer" />
      </div>
    </div>
  );
}
