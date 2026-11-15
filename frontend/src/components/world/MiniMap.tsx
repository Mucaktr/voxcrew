/**
 * Mini harita (S13 → S38 → S47).
 * S47: kompakt varsayılan (eski boyutun ~yarısı), üç boyut: çip (yuvarlak düğme) / kompakt / büyük — tercih bu
 * tarayıcıda saklanır. Bölgeler tema belirteçleriyle dolu şekiller: ekip alanı ekip renginde, olanaklar türüne göre renk
 * ve simge (☕ 🛏 📚 ⚓ …). Etiketler yalnızca sığarsa ve çakışmazsa çizilir; hepsi Lejant açılır panelinde listelenir.
 * Kamera görüş alanı (frustum) zemine izdüşen dörtgen olarak gösterilir.
 * Çizim React dışında: durağan katman (bölgeler + etiketler) yalnızca yerleşim/tema/boyut değişince, dinamik katman
 * (ajan noktaları + görüş alanı) ~7 Hz'lik denetimde yalnızca kamera ya da noktalar değiştiyse yeniden çizilir.
 * Tıkla: oraya git · çift tıkla: yakınlaş · klavye: ok tuşları kaydırır, Enter üzerindeki ekibe gider, + / − yakınlaştırır.
 * E2 (EXP-INT): parsel katmanı — sahiplenilmiş parseller (rozet renginde çerçeve; her zaman) ve keşfedilen çevre parselleri (soluk;
 * yalnız yürüme modunda). Katman varken harita sınırı dünya kutusu ∪ katman olur (`Outskirts` yerleşimi yayımlar, `plotStore`).
 * INTERIOR-VIEW: iç mekânda harita katın kendi ızgarasını (oda adlarıyla) gösterir; çok katlı yerde altında kat seçici (asansör).
 */
import clsx from "clsx";
import { ListTree, Map as MapIcon, Maximize2, Minimize2, Minus } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { tx as msg, useT } from "../../lib/i18n";
import type { Mood } from "../../lib/types";
import { world as M } from "../../locales/world";
import type { WorldLive } from "../../voxel/live";
import { tx as tileX, tz, type Built, type ModuleCell } from "../../voxel/scenes";
import { GEO_SOLID, GEO_WATER, geoRuns, miniGeo } from "./miniGeo";
import type { WorldTeam } from "../../voxel/World";
import { walkRuntime } from "../../voxel/walk/walkStore";
import { withAvatar } from "../../voxel/walk/mapBounds";
import { usePlotStore, type PlotLayer } from "../../voxel/expanse/plotStore";
import { expanse as XM } from "../../locales/expanse";
import { districtFamily, FAMILY, type DistrictFamily } from "./districtStyle";
import { FloorPicker } from "./walk/explore/FloorPicker";
import { CityMiniMap } from "./walk/city/CityMiniMap";
import { useCityActive } from "../../voxel/citymap/store";
import { useInterior } from "../../voxel/interiors/store";
import { cityDoorTile, goCityDoor } from "../../voxel/citymap/doorEntity";
import { city as CM } from "../../locales/city";
import "./world.css";

type Size = "chip" | "compact" | "large";
const NARROW_MQ = "(max-width: 639px)";  // world.css: dar ekranda .minimap-btn.is-expand gizli
const SIZE_KEY = "voxcrew.world.minimap";
const MAP_W: Record<Exclude<Size, "chip">, number> = { compact: 152, large: 288 };
const MAP_H_MAX: Record<Exclude<Size, "chip">, number> = { compact: 104, large: 200 };
const FOV = 38; // World.tsx kamerası (dikey, derece)

const MOOD_TOKEN: Record<Mood, string> = {
  idle: "--grass-hi", thinking: "--sky", working: "--sky", waiting: "--gold", done: "--grass-hi", error: "--red", offline: "--muted",
};

function loadSize(): Size {
  try {
    const v = window.localStorage.getItem(SIZE_KEY);
    if (v === "chip" || v === "compact" || v === "large") return v;
  } catch { /* gizli pencere / engelli depolama */ }
  // yatay telefonda (yükseklik ≤ 480) da çip — açık harita sahne yüksekliğinin üçte birini kaplıyordu
  try { return window.matchMedia("(min-width: 640px) and (min-height: 481px)").matches ? "compact" : "chip"; } catch { return "compact"; }
}

interface Rect { x: number; y: number; w: number; h: number }
interface District { key: string; name: string; fam: DistrictFamily | null; color?: string; team?: string; x0: number; z0: number; x1: number; z1: number }

/** Dünya modüllerinden adlandırılmış bölge listesi (ekip alanı birden çok modülse ilk modül adı taşır). */
function districtsOf(live: WorldLive, teams: WorldTeam[]): District[] {
  const out: District[] = [];
  const named = new Set<string>();
  live.modules.forEach((m: ModuleCell, i) => {
    let name = "";
    if (m.kind === "team" && m.team) { if (!named.has(m.team)) { named.add(m.team); name = teams.find((t) => t.slug === m.team)?.name ?? ""; } }
    else if (m.kind && m.label) name = msg(M, m.label as keyof typeof M.tr);
    const x0 = tileX(m.i0) - 0.5, z0 = tz(m.j0) - 0.5;
    out.push({ key: `${i}`, name, fam: districtFamily(m), color: m.kind === "team" ? m.color : undefined, team: m.kind === "team" ? m.team : undefined,
      x0, z0, x1: x0 + m.w, z1: z0 + m.d });
  });
  return out;
}

const PRIORITY: Record<string, number> = { hq: 0, team: 1, guest: 3, yard: 4 };

type MiniMapProps = {
  live: WorldLive; teams: WorldTeam[]; onGo: (x: number, z: number) => void; onZoom?: (f: number) => void;
  onFocusTeam: (slug: string) => void; selected: string | null; className?: string;
  /** UXF-D: kurulmuş dış dünya — coğrafya katmanı (su, yol, simge; `miniGeo.ts`). Yoksa yalnız bölgeler.*/
  built?: Built | null;
};

/** şehir haritasındayken semtli şehir haritası (hızlı seyahat), değilse ofis mini haritası.*/
export function MiniMap(props: MiniMapProps) {
  const city = useCityActive();
  // şehir landmarkının iç mekânında katın kendi haritası ve kat seçicisi (ofis mini haritası iç kat düzenini çizer)
  const inside = useInterior((s) => !!s.view);
  return city && !inside ? <CityMiniMap className={props.className} /> : <OfficeMiniMap {...props} />;
}

function OfficeMiniMap({ live, teams, onGo, onZoom, onFocusTeam, selected, className, built = null }: MiniMapProps) {
  const t = useT(M);
  const canvas = useRef<HTMLCanvasElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const legendBtn = useRef<HTMLButtonElement>(null);
  const legendId = useId();
  const keysId = useId();
  const [stored, setSizeState] = useState<Size>(() => (typeof window === "undefined" ? "compact" : loadSize()));
  // dar ekranda (≤ 639 px) büyük boy yok — masaüstünde seçilen "büyük" burada kompakt çizilir (büyütme
  // düğmesi gizli olduğundan kullanıcı küçültemezdi; harita dünya görünümünün çoğunu kaplıyordu)
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia(NARROW_MQ).matches);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(NARROW_MQ);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  const size: Size = narrow && stored === "large" ? "compact" : stored;
  const [dims, setDims] = useState({ w: MAP_W.compact, h: 96 });
  const [legend, setLegend] = useState(false);
  const [hoverName, setHoverName] = useState("");
  const [legendItems, setLegendItems] = useState<District[]>([]);
  const selRef = useRef(selected);
  selRef.current = selected;
  const teamsRef = useRef(teams);
  teamsRef.current = teams;
  const hoverRef = useRef<{ x: number; z: number } | null>(null);
  const distRef = useRef<District[]>([]);
  const kick = useRef(0);
  // E2: parsel katmanı (dünya karosu); yürüme modunda keşfedilen parseller de sınıra katılır
  const tm = useT(XM);
  const layer = usePlotStore((s) => s.layer);
  const layerRef = useRef<PlotLayer | null>(layer);
  layerRef.current = layer;
  useEffect(() => { kick.current++; }, [layer]);
  // UXF-D: coğrafya katmanı yalnız dış dünyada (iç katta kat ızgarası çizilir)
  const insideGeo = useInterior((s) => !!s.view);
  const geoRef = useRef<Built | null>(null);
  geoRef.current = insideGeo ? null : built;
  useEffect(() => { kick.current++; }, [built, insideGeo]);
  // W5: yürürken avatar çevrede (keşif katmanı henüz yayımlanmamış ya da keşfedilmemiş parselde) olsa da haritada kalır
  const bnds = useCallback((): WorldLive["bounds"] =>
    withAvatar(layerBounds(live.bounds, layerRef.current, !!walkRuntime.live), walkRuntime.live ? walkRuntime.avatar : null), [live]);

  const setSize = (s: Size) => {
    try { window.localStorage.setItem(SIZE_KEY, s); } catch { /* yoksay */ }
    setSizeState(s);
    if (s === "chip") setLegend(false);
  };

  // ---------------------------------------------------------------- çizim (React dışında)
  useEffect(() => {
    if (size === "chip") return;
    const W = MAP_W[size];
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const stat = document.createElement("canvas"); // bölge dolguları + çerçeveler
    const lab = document.createElement("canvas"); // etiketler (noktaların üstünde kalsın diye ayrı katman)
    let statKey = "", dynSig = "", themeVer = 0, teamSig = "";
    const tok: Record<string, string> = {};
    const readTokens = () => {
      const cs = getComputedStyle(root.current ?? document.documentElement);
      for (const n of ["--panel", "--panel-2", "--ink", "--ink-2", "--muted", "--line-soft", "--focus", "--amethyst",
        ...Object.values(FAMILY).map((f) => f.token), ...Object.values(MOOD_TOKEN)]) tok[n] = cs.getPropertyValue(n).trim() || "#888";
      themeVer++;
    };
    readTokens();
    const mo = new MutationObserver(() => { readTokens(); kick.current++; });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onMq = () => { readTokens(); kick.current++; };
    mq?.addEventListener?.("change", onMq);

    const geom = () => {
      const b = bnds();
      const ww = Math.max(1, b.maxX - b.minX), wd = Math.max(1, b.maxZ - b.minZ);
      const h = Math.round(Math.min(MAP_H_MAX[size], Math.max(56, (W * wd) / ww)));
      return { b, ww, wd, h, sx: W / ww, sz: h / wd };
    };

    const drawStatic = (h: number, sx: number, sz: number, b: WorldLive["bounds"]) => {
      stat.width = W * dpr; stat.height = h * dpr;
      const ctx = stat.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = tok["--panel-2"]; ctx.fillRect(0, 0, W, h);
      const px = (x: number) => (x - b.minX) * sx, pz = (z: number) => (z - b.minZ) * sz;
      const dark = isDark();
      const ds = districtsOf(live, teamsRef.current);
      distRef.current = ds;
      const hasKinds = live.modules.some((m) => m.kind);
      // UXF-D: 0) coğrafya — su, yürünebilir yol/meydan, dolu karo (karo başına 1 px'lik ara tuval, ölçekli; ucuz)
      const geo = geoRef.current ? miniGeo(geoRef.current) : null;
      if (geo) {
        const gc = document.createElement("canvas");
        gc.width = geo.width; gc.height = geo.depth;
        const g2 = gc.getContext("2d");
        if (g2) {
          for (const [i, j, n, v] of geoRuns(geo)) {
            g2.globalAlpha = v === GEO_WATER ? (dark ? 0.6 : 0.55) : v === GEO_SOLID ? (dark ? 0.32 : 0.26) : (dark ? 0.14 : 0.75);
            g2.fillStyle = v === GEO_WATER ? tok["--sky"] : v === GEO_SOLID ? tok["--ink-2"] : tok["--panel"];
            g2.fillRect(i, j, n, 1);
          }
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(gc, px(tileX(0) - 0.5), pz(tz(0) - 0.5), geo.width * sx, geo.depth * sz);
          ctx.imageSmoothingEnabled = true;
        }
      }
      // 1) dolgular + çerçeveler
      for (const d of ds) {
        const x = px(d.x0), y = pz(d.z0), w = (d.x1 - d.x0) * sx, hh = (d.z1 - d.z0) * sz;
        const col = d.color ?? (d.fam ? tok[FAMILY[d.fam].token] : tok["--line-soft"]);
        const a = d.color ? (dark ? 0.42 : 0.3) : d.fam === "yard" ? (dark ? 0.5 : 0.6) : d.fam === "hq" ? (dark ? 0.26 : 0.22) : d.fam === "guest" ? 0.12 : (dark ? 0.3 : 0.24);
        ctx.globalAlpha = a; ctx.fillStyle = col;
        roundRect(ctx, x + 1, y + 1, w - 2, hh - 2, 2); ctx.fill();
        ctx.globalAlpha = d.color ? 0.95 : 0.6; ctx.strokeStyle = col; ctx.lineWidth = d.color ? 1.5 : 1;
        if (d.fam === "guest") ctx.setLineDash([3, 2]);
        roundRect(ctx, x + 1.5, y + 1.5, w - 3, hh - 3, 2); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;
      // E2: keşfedilen çevre (soluk, yalnız yürürken) ve sahiplenilmiş parseller (rozet rengi)
      const lay = layerRef.current;
      if (lay) {
        const rx = (r: { i0: number; j0: number; i1: number; j1: number }) => ({ x: px(tileX(r.i0) - 0.5), y: pz(tz(r.j0) - 0.5), w: (r.i1 - r.i0) * sx, h: (r.j1 - r.j0) * sz });
        if (walkRuntime.live) {
          ctx.fillStyle = tok["--muted"]; ctx.globalAlpha = dark ? 0.22 : 0.16;
          for (const e of lay.explored) { const r = rx(e); ctx.fillRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1); }
        }
        for (const pl of lay.plots) {
          const r = rx(pl);
          ctx.globalAlpha = dark ? 0.4 : 0.32; ctx.fillStyle = pl.color;
          roundRect(ctx, r.x + 1, r.y + 1, r.w - 2, r.h - 2, 2); ctx.fill();
          ctx.globalAlpha = 1; ctx.strokeStyle = tok["--ink"]; ctx.lineWidth = 1.5;
          roundRect(ctx, r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 3, 2); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      // UXF-D: simgeler — panel halkalı ametist baklava (kapının altın karesinden ayrı)
      if (geo) {
        const q = size === "large" ? 4.5 : 3.4;
        for (const [lx, lz] of geo.landmarks) {
          const x = px(lx), y = pz(lz);
          if (x < -q || y < -q || x > W + q || y > h + q) continue;
          ctx.beginPath(); ctx.moveTo(x, y - q); ctx.lineTo(x + q, y); ctx.lineTo(x, y + q); ctx.lineTo(x - q, y); ctx.closePath();
          ctx.lineJoin = "round"; ctx.lineWidth = 2.4; ctx.strokeStyle = tok["--panel"]; ctx.stroke();
          ctx.fillStyle = tok["--amethyst"]; ctx.fill();
          ctx.lineWidth = 1; ctx.strokeStyle = tok["--ink"]; ctx.stroke();
        }
      }
      lab.width = W * dpr; lab.height = h * dpr;
      const lctx = lab.getContext("2d");
      // eski (türsüz) dünyada ekip karoları
      if (!hasKinds) {
        for (const z of live.zones) {
          ctx.fillStyle = z.color; ctx.globalAlpha = z.lead ? 1 : 0.7;
          ctx.fillRect(px(tileX(z.i) - 0.5), pz(tz(z.j) - 0.5), Math.max(2, sx), Math.max(2, sz));
        }
        ctx.globalAlpha = 1;
      }
      if (!lctx) return;
      lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawLabels(lctx);
    };
    const drawLabels = (ctx: CanvasRenderingContext2D) => {
      const g = geom();
      const h = g.h, sx = g.sx, sz = g.sz;
      const px = (x: number) => (x - g.b.minX) * sx, pz = (z: number) => (z - g.b.minZ) * sz;
      const ds = distRef.current;
      // 2) etiketler: öncelik (merkez, ekip, olanak, ortak, avlu) ve alan sırasıyla; sığmayan / çakışan atlanır
      const fs = size === "large" ? 11 : 10;
      const font = `600 ${fs}px 'Inter Variable', Inter, system-ui, sans-serif`;
      const iconFont = `${fs + 2}px 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif`;
      const placed: Rect[] = [];
      const free = (r: Rect) => r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= h
        && !placed.some((p) => r.x < p.x + p.w + 1 && p.x < r.x + r.w + 1 && r.y < p.y + p.h + 1 && p.y < r.y + r.h + 1);
      const order = ds.filter((d) => d.name || (d.fam && FAMILY[d.fam].icon))
        .map((d) => ({ d, pri: d.color ? PRIORITY.team : d.fam === "hq" ? PRIORITY.hq : d.fam === "guest" ? PRIORITY.guest : d.fam === "yard" ? PRIORITY.yard : 2,
          area: (d.x1 - d.x0) * (d.z1 - d.z0) }))
        .sort((a, b2) => a.pri - b2.pri || b2.area - a.area);
      ctx.textBaseline = "middle";
      const lh = fs + 5;
      for (const { d } of order) {
        const x = px(d.x0), y = pz(d.z0), w = (d.x1 - d.x0) * sx, hh = (d.z1 - d.z0) * sz;
        if (hh < lh || w < 12) continue;
        const icon = d.fam ? FAMILY[d.fam].icon : "";
        ctx.font = iconFont;
        const iw = icon ? ctx.measureText(icon).width : 0;
        ctx.font = font;
        let s = d.name;
        const room = w - 8 - (icon ? iw + 3 : 0);
        while (s.length > 4 && ctx.measureText(s).width > room) s = `${s.slice(0, -2).trimEnd()}…`;
        if (!s || ctx.measureText(s).width > room || (s !== d.name && s.length < 5)) s = "";
        const sw = s ? ctx.measureText(s).width : 0;
        if (!sw && !icon) continue;
        const cx = x + w / 2, cy = y + hh / 2;
        const tw = sw + (icon ? iw + (sw ? 3 : 0) : 0);
        const r: Rect = { x: cx - tw / 2 - 3, y: cy - lh / 2, w: tw + 6, h: lh };
        if (!free(r)) continue;
        placed.push(r);
        let x0 = r.x + 3;
        if (icon) {
          // simge zemin rengine doğrudan çizilir (yastık yok); yalnızca metin okunurluk yastığı alır
          ctx.font = iconFont; ctx.fillStyle = tok["--ink"]; ctx.fillText(icon, x0, cy + 0.5);
          x0 += iw + 3;
        }
        if (s) {
          ctx.font = font;
          ctx.globalAlpha = 0.88; ctx.fillStyle = tok["--panel"];
          roundRect(ctx, x0 - 2, r.y + 1, sw + 4, r.h - 2, 3); ctx.fill();
          ctx.globalAlpha = 1; ctx.fillStyle = tok["--ink"]; ctx.fillText(s, x0, cy + 0.5);
        }
      }
    };

    const tick = () => {
      if (document.hidden) return;
      const c = canvas.current;
      if (!c) return;
      const g = geom();
      const ts = teamsRef.current.map((tm) => tm.slug + tm.name).join("|");
      if (ts !== teamSig) { teamSig = ts; kick.current++; }
      const key = `${live.version}:${g.h}:${themeVer}:${kick.current}:${live.modules.length}:${walkRuntime.live ? 1 : 0}:${g.b.minX},${g.b.maxX},${g.b.minZ},${g.b.maxZ}`;
      let force = false;
      if (key !== statKey) {
        statKey = key; force = true;
        setDims((d) => (d.w === W && d.h === g.h ? d : { w: W, h: g.h }));
        drawStatic(g.h, g.sx, g.sz, g.b);
        setLegendItems(distRef.current.filter((d) => d.name));
      }
      // dinamik imza: kamera + noktalar (yuvarlanmış) + seçim
      let ps = 0;
      for (const [, p] of live.positions) ps += Math.round(p.x * 4) * 7 + Math.round(p.z * 4) * 13;
      const cp = live.camPos, ct = live.camTarget;
      // W2: yürüme modunda avatar noktası (kare başı walkRuntime okuması; abonelik yok)
      const me = walkRuntime.live ? walkRuntime.avatar : null;
      // UXF-B: yürürken ofis tabanının "Şehre çık" kapısı
      const door = me ? cityDoorTile() : null;
      const sig = `${ps}:${live.positions.size}:${cp.x.toFixed(2)},${cp.y.toFixed(2)},${cp.z.toFixed(2)}:${ct.x.toFixed(2)},${ct.z.toFixed(2)}:${selRef.current}`
        + (me ? `:me${me.x.toFixed(1)},${me.z.toFixed(1)},${me.heading.toFixed(1)}` : "") + (door ? `:door${door[0]},${door[1]}` : "");
      if (!force && sig === dynSig) return;
      dynSig = sig;
      if (c.width !== W * dpr || c.height !== g.h * dpr) { c.width = W * dpr; c.height = g.h * dpr; }
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      if (stat.width) ctx.drawImage(stat, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const px = (x: number) => (x - g.b.minX) * g.sx, pz = (z: number) => (z - g.b.minZ) * g.sz;
      // ajan noktaları (panel renginde ince hale ile her zeminde seçilir)
      const r0 = size === "large" ? 2 : 1.4;
      for (const [slug, p] of live.positions) {
        const sel = slug === selRef.current;
        const r = sel ? r0 + 1.6 : r0;
        ctx.beginPath(); ctx.arc(px(p.x), pz(p.z), r + 0.7, 0, Math.PI * 2); ctx.fillStyle = tok["--panel"]; ctx.fill();
        ctx.beginPath(); ctx.arc(px(p.x), pz(p.z), r, 0, Math.PI * 2); ctx.fillStyle = tok[MOOD_TOKEN[live.moods.get(slug) ?? "idle"]]; ctx.fill();
        if (sel) { ctx.lineWidth = 1.4; ctx.strokeStyle = tok["--ink"]; ctx.stroke(); }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (lab.width) ctx.drawImage(lab, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (door) {
        // UXF-B: kapı simgesi — panel halkalı altın kare + mürekkep kemer (her zeminde seçilir)
        const dx = px(tileX(door[0])), dz = pz(tz(door[1])), q = size === "large" ? 5 : 3.8;
        ctx.lineJoin = "round";
        ctx.fillStyle = tok["--panel"]; ctx.fillRect(dx - q - 1.5, dz - q - 1.5, 2 * q + 3, 2 * q + 3);
        ctx.fillStyle = tok["--gold"]; ctx.fillRect(dx - q, dz - q, 2 * q, 2 * q);
        ctx.lineWidth = 1.2; ctx.strokeStyle = tok["--ink"]; ctx.strokeRect(dx - q, dz - q, 2 * q, 2 * q);
        ctx.beginPath(); ctx.moveTo(dx - q * 0.45, dz + q * 0.7); ctx.lineTo(dx - q * 0.45, dz - q * 0.2); ctx.arc(dx, dz - q * 0.2, q * 0.45, Math.PI, 0); ctx.lineTo(dx + q * 0.45, dz + q * 0.7); ctx.stroke();
      }
      // görüş alanı (kameranın zemine izdüşümü)
      const poly = frustum(live, aspectOf(root.current));
      if (poly) {
        ctx.beginPath();
        poly.forEach(([x, z], i) => (i ? ctx.lineTo(px(x), pz(z)) : ctx.moveTo(px(x), pz(z))));
        ctx.closePath();
        // dolgu yok (etiket kontrastını düşürmesin); panel renginde hale + mürekkep çizgi her zeminde seçilir
        ctx.lineJoin = "round";
        ctx.lineWidth = 3.5; ctx.strokeStyle = tok["--panel"]; ctx.stroke();
        ctx.lineWidth = 1.6; ctx.strokeStyle = tok["--ink"]; ctx.stroke();
      }
      if (me) {
        // W2: avatar — panel renginde halkalı, bakış yönüne dönük ok (kamera hedefi noktası yerine)
        const ax = px(me.x), az = pz(me.z), s = size === "large" ? 6 : 4.6;
        const fx = Math.sin(me.heading), fz = Math.cos(me.heading);
        ctx.beginPath();
        ctx.moveTo(ax + fx * s, az + fz * s);
        ctx.lineTo(ax - fx * s * 0.7 + fz * s * 0.7, az - fz * s * 0.7 - fx * s * 0.7);
        ctx.lineTo(ax - fx * s * 0.3, az - fz * s * 0.3);
        ctx.lineTo(ax - fx * s * 0.7 - fz * s * 0.7, az - fz * s * 0.7 + fx * s * 0.7);
        ctx.closePath();
        ctx.lineJoin = "round"; ctx.lineWidth = 3; ctx.strokeStyle = tok["--panel"]; ctx.stroke();
        ctx.fillStyle = tok["--ink"]; ctx.fill();
      } else {
        // kamera hedefi
        const cx = px(ct.x), cz = pz(ct.z);
        ctx.beginPath(); ctx.arc(cx, cz, 2.6, 0, Math.PI * 2); ctx.fillStyle = tok["--ink"]; ctx.fill();
        ctx.lineWidth = 1.2; ctx.strokeStyle = tok["--panel"]; ctx.stroke();
      }
    };
    const id = window.setInterval(tick, 140);
    tick();
    return () => { window.clearInterval(id); mo.disconnect(); mq?.removeEventListener?.("change", onMq); };
  }, [live, size, bnds]);

  // ---------------------------------------------------------------- etkileşim
  const toWorld = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const b = bnds();
    return { x: b.minX + ((e.clientX - r.left) / r.width) * (b.maxX - b.minX), z: b.minZ + ((e.clientY - r.top) / r.height) * (b.maxZ - b.minZ) };
  };
  const districtAt = useCallback((x: number, z: number) =>
    distRef.current.find((d) => d.team && x >= d.x0 && x < d.x1 && z >= d.z0 && z < d.z1)
      ?? distRef.current.find((d) => x >= d.x0 && x < d.x1 && z >= d.z0 && z < d.z1), []);
  const nameAt = (x: number, z: number) => {
    const d = districtAt(x, z);
    if (!d) return "";
    if (d.team) return teamsRef.current.find((tm) => tm.slug === d.team)?.name ?? d.name;
    return d.name;
  };
  const onMove = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    const p = toWorld(e);
    hoverRef.current = p;
    const n = nameAt(p.x, p.z);
    if (n !== hoverName) setHoverName(n);
  };
  const onLeave = () => { hoverRef.current = null; setHoverName(""); };
  const click = (e: ReactMouseEvent<HTMLCanvasElement>) => { const p = toWorld(e); onGo(p.x, p.z); };
  const dbl = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    const p = toWorld(e);
    onGo(p.x, p.z);
    // kaydırma animasyonu bitince yakınlaş (aksi hâlde animasyon yakınlaştırmayı ezer)
    if (onZoom) window.setTimeout(() => onZoom(0.6), 520);
  };
  const onKey = (e: ReactKeyboardEvent<HTMLCanvasElement>) => {
    const b = bnds();
    const step = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * (e.shiftKey ? 0.2 : 0.08);
    const ct = live.camTarget;
    let nx = ct.x, nz = ct.z;
    switch (e.key) {
      case "ArrowUp": nz -= step; break;
      case "ArrowDown": nz += step; break;
      case "ArrowLeft": nx -= step; break;
      case "ArrowRight": nx += step; break;
      case "Enter": case " ": {
        const at = hoverRef.current ?? ct;
        const d = districtAt(at.x, at.z);
        if (d?.team) onFocusTeam(d.team); else onGo(at.x, at.z);
        e.preventDefault(); e.stopPropagation();
        return;
      }
      case "+": case "=": onZoom?.(0.8); e.preventDefault(); e.stopPropagation(); return;
      case "-": case "_": onZoom?.(1.25); e.preventDefault(); e.stopPropagation(); return;
      case "Escape": if (legend) { setLegend(false); e.preventDefault(); } return;
      default: return;
    }
    e.preventDefault(); e.stopPropagation();
    nx = Math.min(b.maxX, Math.max(b.minX, nx)); nz = Math.min(b.maxZ, Math.max(b.minZ, nz));
    hoverRef.current = null;
    onGo(nx, nz);
    const n = nameAt(nx, nz);
    if (n !== hoverName) setHoverName(n);
  };

  // alt şerit (WorldPage) mini haritanın genişliği kadar boşluk bıraksın: kapsayan <section> üzerinde --mm-w.
  // UIUX-OVERLAP: yüksekliği de --mm-h (yürüme HUD ızgarasının alt satırı en az bu kadar; sağdaki paneller haritanın üstünde biter)
  useEffect(() => {
    const el = root.current, sec = el?.closest("section");
    if (!el || !sec) return;
    const coarseChip = size === "chip" && !!window.matchMedia?.("(pointer: coarse)").matches; // dokunmatikte çip 44 px (world.css)
    sec.style.setProperty("--mm-w", coarseChip ? "44px" : `${size === "chip" ? (narrow ? 44 : 36) : dims.w + 16}px`); // UXF-D: dar ekranda çip 44 px
    const h = () => sec.style.setProperty("--mm-h", `${Math.round(el.getBoundingClientRect().height)}px`);
    h();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(h) : null;
    ro?.observe(el);
    return () => { ro?.disconnect(); sec.style.removeProperty("--mm-w"); sec.style.removeProperty("--mm-h"); };
  }, [size, dims.w, narrow]);

  // lejant: dışarı tıklama / Esc kapatır
  useEffect(() => {
    if (!legend) return;
    const down = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setLegend(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setLegend(false); legendBtn.current?.focus(); } };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [legend]);

  if (size === "chip") {
    return (
      <div ref={root} className={clsx("minimap pointer-events-auto", className)}>
        <button type="button" className="minimap-chip" onClick={() => setSize("compact")} aria-label={t("minimap_open")} title={t("minimap_open")}>
          <MapIcon size={16} aria-hidden="true" />
        </button>
      </div>
    );
  }

  const teamItems = teams.filter((tm) => legendItems.some((d) => d.team === tm.slug) || live.zones.some((z) => z.team === tm.slug));
  const placeItems: { fam: DistrictFamily; name: string }[] = [];
  const seen = new Set<string>();
  for (const d of legendItems) if (!d.team && d.fam && !seen.has(d.name)) { seen.add(d.name); placeItems.push({ fam: d.fam, name: d.name }); }

  return (
    <div ref={root} className={clsx("minimap pointer-events-auto", className)} data-size={size}>
      <div className="minimap-panel" style={{ width: dims.w + 12 }}>
        <div className="minimap-head">
          {/* INTERIOR-VIEW: çok katlı iç mekânda başlık yerine kat seçici (yeni satır açmaz: HUD orta yuvası daralmaz) */}
          <FloorPicker fallback={<span className="minimap-title" aria-live="polite">{hoverName || t("minimap_title")}</span>} />
          <button ref={legendBtn} type="button" className="minimap-btn" aria-expanded={legend} aria-controls={legendId}
            aria-label={t("minimap_legend_open")} title={t("minimap_legend_open")} onClick={() => setLegend((v) => !v)}>
            <ListTree size={13} aria-hidden="true" />
          </button>
          <button type="button" className="minimap-btn is-expand" onClick={() => setSize(size === "large" ? "compact" : "large")}
            aria-label={size === "large" ? t("minimap_shrink") : t("minimap_expand")} title={size === "large" ? t("minimap_shrink") : t("minimap_expand")}>
            {size === "large" ? <Minimize2 size={13} aria-hidden="true" /> : <Maximize2 size={13} aria-hidden="true" />}
          </button>
          <button type="button" className="minimap-btn" onClick={() => setSize("chip")} aria-label={t("minimap_collapse")} title={t("minimap_collapse")}>
            <Minus size={13} aria-hidden="true" />
          </button>
        </div>
        <canvas ref={canvas} tabIndex={0} role="img" aria-label={`${t("minimap_aria")}. ${t("minimap_districts")}`} aria-describedby={keysId}
          aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Enter + -" title={t("minimap_keys")}
          style={{ width: dims.w, height: dims.h }} className="minimap-canvas"
          onClick={click} onDoubleClick={dbl} onMouseMove={onMove} onMouseLeave={onLeave} onKeyDown={onKey} />
        <span id={keysId} className="sr-only">{t("minimap_keys")}</span>
      </div>
      {legend && (
        <div id={legendId} className="minimap-legend" role="dialog" aria-label={t("minimap_legend_open")}>
          {teamItems.length > 0 && (
            <>
              <p className="t-overline text-muted">{t("minimap_legend")}</p>
              <ul className="minimap-list">
                {teamItems.map((tm) => (
                  <li key={tm.slug}>
                    <button type="button" className="minimap-team" onClick={() => { onFocusTeam(tm.slug); setLegend(false); }}
                      aria-label={t("tools_focus_team", { team: tm.name })}>
                      <span className="minimap-swatch" style={{ background: tm.color }} aria-hidden="true" />
                      <span className="truncate">{tm.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {placeItems.length > 0 && (
            <>
              <p className="t-overline text-muted">{t("minimap_areas")}</p>
              <ul className="minimap-list is-places">
                {placeItems.map((p) => (
                  <li key={p.name} className="minimap-place">
                    <span className="minimap-icon" data-fam={p.fam} aria-hidden="true">{FAMILY[p.fam].icon || "·"}</span>
                    <span className="truncate">{p.name}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {!!layer?.plots.length && (
            <>
              <p className="t-overline text-muted">{tm("map_plots")}</p>
              <ul className="minimap-list is-places">
                {layer.plots.map((pl) => (
                  <li key={pl.slot} className="minimap-place">
                    <span className="minimap-swatch" style={{ background: pl.color }} aria-hidden="true" />
                    <span className="truncate">{tm("slot", { n: pl.slot + 1 })}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {walkRuntime.live && cityDoorTile() && (
            <>
              <p className="t-overline text-muted">{msg(CM, "door_name")}</p>
              <ul className="minimap-list">
                <li>
                  <button type="button" className="minimap-team" onClick={() => { goCityDoor(); setLegend(false); }} aria-label={msg(CM, "door_map")}>
                    <span className="minimap-swatch" style={{ background: "var(--gold)" }} aria-hidden="true" />
                    <span className="truncate">{msg(CM, "door")}</span>
                  </button>
                </li>
              </ul>
            </>
          )}
          {!!layer?.explored.length && walkRuntime.live && (
            <p className="text-xs text-muted">{tm("map_explored")}: {layer.explored.length}</p>
          )}
          <p className="minimap-keys">{t("minimap_keys")}</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- yardımcılar
/** E2: harita sınırı = dünya kutusu ∪ parsel katmanı (keşfedilenler yalnız yürürken). Katman yoksa dünya sınırı aynen. */
function layerBounds(b: WorldLive["bounds"], layer: PlotLayer | null, walking: boolean): WorldLive["bounds"] {
  if (!layer) return b;
  const rects = walking ? [...layer.plots, ...layer.explored] : layer.plots;
  if (!rects.length) return b;
  let { minX, maxX, minZ, maxZ } = b;
  for (const r of rects) {
    minX = Math.min(minX, tileX(r.i0) - 0.5); maxX = Math.max(maxX, tileX(r.i1 - 1) + 0.5);
    minZ = Math.min(minZ, tz(r.j0) - 0.5); maxZ = Math.max(maxZ, tz(r.j1 - 1) + 0.5);
  }
  return minX === b.minX && maxX === b.maxX && minZ === b.minZ && maxZ === b.maxZ ? b : { ...b, minX, maxX, minZ, maxZ };
}

function isDark(): boolean {
  const th = document.documentElement.dataset.theme;
  if (th === "dark") return true;
  if (th === "light") return false;
  try { return window.matchMedia("(prefers-color-scheme: dark)").matches; } catch { return false; }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (w <= 0 || h <= 0) { ctx.beginPath(); return; }
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
  else ctx.rect(x, y, w, h);
}

/** Dünya tuvalinin en/boy oranı (mini harita aynı <section> içinde). */
function aspectOf(el: HTMLElement | null): number {
  const c = el?.closest("section")?.querySelector<HTMLCanvasElement>("canvas:not(.minimap-canvas)");
  return c && c.clientHeight > 0 ? c.clientWidth / c.clientHeight : 16 / 9;
}

/** Kameranın görüş alanının y=0 zeminine izdüşümü (4 köşe). Ufkun üstüne bakan köşe uzak bir mesafede kesilir. */
function frustum(live: WorldLive, aspect: number): [number, number][] | null {
  const p = live.camPos, t = { x: live.camTarget.x, y: 0.4, z: live.camTarget.z };
  let fx = t.x - p.x, fy = t.y - p.y, fz = t.z - p.z;
  const dist = Math.hypot(fx, fy, fz);
  if (dist < 1e-3) return null;
  fx /= dist; fy /= dist; fz /= dist;
  // sağ = f × yukarı(0,1,0); üst = sağ × f
  let rx = -fz, rz = fx;
  const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  const th = Math.tan((FOV * Math.PI) / 360), tw = th * aspect;
  const far = dist * 4;
  const out: [number, number][] = [];
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const dx = fx + rx * sx * tw + ux * sy * th, dy = fy + uy * sy * th, dz = fz + rz * sx * tw + uz * sy * th;
    if (dy < -1e-3) {
      const k = Math.min(-p.y / dy, far / Math.hypot(dx, dy, dz));
      out.push([p.x + dx * k, p.z + dz * k]);
    } else {
      const hl = Math.hypot(dx, dz) || 1;
      out.push([p.x + (dx / hl) * far, p.z + (dz / hl) * far]);
    }
  }
  return out;
}
