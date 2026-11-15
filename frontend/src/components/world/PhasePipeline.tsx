/**
 * Aşama hattı: Bellek → Düşünme → Araç → Yazma → Belleğe kayıt.
 * variant="hud": dünyadaki koyu, yalnızca simgeli küçük hat (Html içinde; yönlendirici/bağlam kullanmaz).
 * variant="panel": kart ve yan panelde tema duyarlı, ekran okuyucu metinli hat; `labeled` ile aşama adları görünür.
 * Renk tek başına bilgi taşımaz: durum, simge çerçevesi (düz/kesik) ve gizli metinle de anlatılır.
 */
import clsx from "clsx";
import { Database, Lightbulb, PenLine, Save, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import { tx } from "../../lib/i18n";
import { world as M } from "../../locales/world";
import { PHASES, phaseShort, phaseStateLabel, type PhaseId, type PhaseState } from "./activity";

const ICON: Record<PhaseId, ReactNode> = {
  memory: <Database aria-hidden="true" />,
  think: <Lightbulb aria-hidden="true" />,
  tool: <Wrench aria-hidden="true" />,
  write: <PenLine aria-hidden="true" />,
  save: <Save aria-hidden="true" />,
};

export function PhasePipeline({ states, variant = "panel", labeled = false, tool, className }:
  { states: PhaseState[]; variant?: "hud" | "panel"; labeled?: boolean; tool?: string | null; className?: string }) {
  if (!states.length) return null;
  if (variant === "hud") {
    return (
      <ol className={clsx("whud-pipe", className)}>
        {PHASES.map((p, i) => (
          <li key={p.id} style={{ display: "contents" }}>
            {i > 0 && <span className="whud-link" data-s={states[i - 1] === "done" ? "done" : undefined} />}
            <span className="whud-ph" data-s={states[i]}>{ICON[p.id]}</span>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <ol className={clsx("wpipe", labeled && "is-labeled", className)} aria-label={tx(M, "phases_aria")}>
      {PHASES.map((p, i) => {
        const s = states[i];
        const name = p.id === "tool" && tool && s !== "todo" ? `${p.label} (${tool})` : p.label;
        return (
          <li key={p.id} aria-current={s === "active" ? "step" : undefined}>
            <span className="wpipe-step" data-s={s} title={`${name}: ${phaseStateLabel(s)}`}>
              <span className="wpipe-ph" data-s={s}>{ICON[p.id]}</span>
              {labeled && <span className="wpipe-name" aria-hidden="true">{phaseShort(p.id)}</span>}
              <span className="sr-only">{name}: {phaseStateLabel(s)}</span>
            </span>
            {i < PHASES.length - 1 && <span className="wpipe-link" data-s={s === "done" ? "done" : undefined} aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}
