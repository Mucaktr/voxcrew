// Bellek grafı ve ontoloji haritasının ortak parçaları: dil duyarlı tür adları, alanlar (ontolojinin görsel kümeleri),
// tuval için tema renkleri ve küçük çizim yardımcıları.
import { useEffect, useState } from "react";
import { tx } from "../../lib/i18n";
import { memoryMsg } from "../../locales/memory";

const TYPE_IDS = ["Agent", "Connection", "Model", "Workflow", "Task", "Run", "Step", "Tool", "Artifact", "Episode", "Concept",
  "Fact", "Team", "Role", "Skill", "Achievement", "Goal", "Project", "ExternalSession",
  // UX-AUDIT: sonradan eklenen ontoloji türleri (etiketsiz kalınca lejantta İngilizce kimlik görünüyordu)
  "Message", "Deliverable", "QualityReport", "Schedule", "Lesson", "Acceptance", "EvalRun", "Recognition", "SystemCall",
  // FAZB2: dünya/oyun projeksiyonu (studio.cities.graph_sync)
  "City", "District", "Landmark", "RideLine", "Activity", "PassportStamp", "Unlock"] as const;
/** Tür adının şu anki dildeki etiketi (getter; anahtarlar ontoloji kimlikleri). */
export const TYPE_TR = Object.defineProperties({} as Record<string, string>, Object.fromEntries(
  TYPE_IDS.map((k) => [k, { enumerable: true, get: () => tx(memoryMsg, `type_${k}`) }]),
)) as Record<string, string>;

/** Ontolojinin görsel alanları (yalnızca arayüz gruplaması; ontoloji dosyasında karşılığı yok). */
export const DOMAINS = [
  { id: "org", get label() { return tx(memoryMsg, "domain_org"); }, types: ["Agent", "Team", "Role", "Skill", "Achievement"] },
  { id: "work", get label() { return tx(memoryMsg, "domain_work"); }, types: ["Goal", "Workflow", "Task", "Run", "Step", "Tool", "Artifact"] },
  { id: "memory", get label() { return tx(memoryMsg, "domain_memory"); }, types: ["Episode", "Concept", "Fact"] },
  { id: "infra", get label() { return tx(memoryMsg, "domain_infra"); }, types: ["Connection", "Model"] },
  { id: "external", get label() { return tx(memoryMsg, "domain_external"); }, types: ["Project", "ExternalSession"] },
] as const;
export type DomainId = (typeof DOMAINS)[number]["id"] | "other";
/** Alan rengi: marka paletinden (tema belirteci). */
export const DOMAIN_VAR: Record<DomainId, keyof ThemeVars> = {
  org: "amethyst", work: "sky", memory: "grass", infra: "gold", external: "diamond", other: "muted",
};
export const domainOf = (type: string): DomainId =>
  DOMAINS.find((d) => (d.types as readonly string[]).includes(type))?.id ?? "other";

const VARS = ["ink", "ink-2", "muted", "panel", "panel-2", "line", "line-soft", "focus", "gold", "bad-fg",
  "amethyst", "sky", "grass", "diamond"] as const;
export type ThemeVars = Record<(typeof VARS)[number], string>;

function readVars(): ThemeVars {
  const cs = getComputedStyle(document.documentElement);
  return Object.fromEntries(VARS.map((v) => [v, cs.getPropertyValue(`--${v}`).trim() || "#888888"])) as ThemeVars;
}

/** Tuvale çizilen grafiklerin tema renkleri: açık/koyu tema ve sistem teması değişince yeniden okunur. */
export function useThemeVars(): ThemeVars {
  const [vars, setVars] = useState<ThemeVars>(readVars);
  useEffect(() => {
    const update = () => setVars(readVars());
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", update);
    return () => { obs.disconnect(); mq.removeEventListener("change", update); };
  }, []);
  return vars;
}

/** `#rrggbb` + saydamlık → `rgba()` (tuval için). */
export function alpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Ortadaki metni yarı saydam hap zemin üstüne yazar (etiket). */
export function pillLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, ink: string, bg: string) {
  ctx.font = `600 ${size}px "Inter Variable", "Segoe UI", sans-serif`;
  const w = ctx.measureText(text).width, padX = size * 0.45, h = size * 1.45;
  ctx.fillStyle = bg;
  roundRect(ctx, x - w / 2 - padX, y, w + padX * 2, h, h / 2);
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y + h / 2 + size * 0.04);
}

/** Basit çarpışma kuvveti (d3 yerine; düğüm sayısı küçük): `radius` kadar yaklaşan düğümleri iter. */
export function collideForce<N extends { x?: number; y?: number; vx?: number; vy?: number }>(radius: (n: N) => number, strength = 0.7) {
  let nodes: N[] = [];
  const force = () => {
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const dx = (b.x ?? 0) - (a.x ?? 0), dy = (b.y ?? 0) - (a.y ?? 0);
      const d = Math.hypot(dx, dy) || 0.01, min = radius(a) + radius(b);
      if (d >= min) continue;
      const push = ((min - d) / d) * 0.5 * strength;
      a.vx = (a.vx ?? 0) - dx * push; a.vy = (a.vy ?? 0) - dy * push;
      b.vx = (b.vx ?? 0) + dx * push; b.vy = (b.vy ?? 0) + dy * push;
    }
  };
  force.initialize = (ns: N[]) => { nodes = ns; };
  return force;
}

/** Düğümleri kendi alan merkezine çeken kuvvet. */
export function clusterForce<N extends { x?: number; y?: number; vx?: number; vy?: number }>(
  center: (n: N) => { x: number; y: number } | null, strength = 0.08) {
  let nodes: N[] = [];
  const force = (a: number) => {
    for (const n of nodes) {
      const c = center(n);
      if (!c) continue;
      n.vx = (n.vx ?? 0) + (c.x - (n.x ?? 0)) * strength * a;
      n.vy = (n.vy ?? 0) + (c.y - (n.y ?? 0)) * strength * a;
    }
  };
  force.initialize = (ns: N[]) => { nodes = ns; };
  return force;
}
