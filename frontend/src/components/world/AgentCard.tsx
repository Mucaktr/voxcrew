/**
 * Dünyada karakterin üstüne gelince açılan bilgi kartı (normal DOM; yönlendirici bağlamı var).
 * Görev başlığı + köken rozeti, adım, aşama hattı, rota, geçen süre, son araç, token, onay durumu ve
 * "Görevi aç" / "Ajanı aç" (harici oturumda "Projeyi aç"). İmleç kartın üstündeyken açık kalır; Esc kapatır.
 * Faz 5: "rozet yuvası" — şimdilik oyun rozetleri (seviye, rütbe, ekip); skill ve booster rozetleri için yer ayrıldı.
 */
import { Award, Bot, ExternalLink, Hand, Timer, Users, Wrench } from "lucide-react";
import { useEffect, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { OriginBadge } from "../connect/OriginBadge";
import { PixelFace } from "../PixelFace";
import { Badge, Button } from "../ui";
import { useGameAgent, useGameEnabled } from "../../lib/game";
import { fmtNumber, useT } from "../../lib/i18n";
import { MOOD_LABEL } from "../../lib/format";
import type { Mood } from "../../lib/types";
import { world as M } from "../../locales/world";
import type { WorldAgent } from "../../voxel/World";
import { fmtElapsed, fmtTokens } from "./activity";
import { PhasePipeline } from "./PhasePipeline";

const MOOD_TONE: Record<Mood, string> = {
  idle: "ok", thinking: "info", working: "info", waiting: "warn", done: "ok", error: "bad", offline: "muted",
};
const CARD_W = 300;
/** Rozet yuvası sayısı: dolu olanlar oyun rozetleri, boş yuvalar ileride skill/booster göstergeleri için. */
const BADGE_SLOTS = 4;

export interface CardAnchor { x: number; y: number; width: number; height: number }

export function AgentCard({ wa, anchor, routeLabel, teamName, projectKey, onEnter, onLeave, onClose, onOpenAgent }: {
  wa: WorldAgent;
  anchor: CardAnchor;
  routeLabel?: string | null;
  teamName?: string | null;
  /** harici oturum: proje sayfası bağlantısı */
  projectKey?: string | null;
  onEnter: () => void;
  onLeave: () => void;
  onClose: () => void;
  onOpenAgent?: (slug: string) => void;
}) {
  const t = useT(M);
  const { agent, mood, work, external } = wa;
  const gameOn = useGameEnabled();
  const gameData = useGameAgent(external ? null : agent.slug);
  const game = gameOn ? gameData : null;

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const { x, y, width, height } = anchor;
  const narrow = width < CARD_W + 120;
  const style: CSSProperties = narrow
    ? { left: 8, right: 8, bottom: 48 }
    : {
        width: CARD_W,
        left: Math.max(8, Math.min(x <= width / 2 ? x + 18 : x - CARD_W - 18, width - CARD_W - 8)),
        ...(y > height / 2 ? { bottom: Math.max(8, height - y + 10) } : { top: Math.max(56, y + 10) }),
      };
  const pct = game ? Math.round(Math.max(0, Math.min(1, game.progress)) * 100) : 0;
  const title = agent.title;

  // rozet yuvası: oyun rozetleri (seviye, rütbe, ekip); boş yuvalar ileriye dönük (skill / booster)
  const badges: { key: string; label: string; tone: string; icon: ReactNode }[] = [];
  if (game) badges.push({ key: "level", label: t("card_badge_level", { n: game.level }), tone: "warn", icon: <Award size={12} aria-hidden="true" /> });
  if (game?.rankLabel) badges.push({ key: "rank", label: t("card_badge_rank", { rank: game.rankLabel }), tone: "info", icon: <Award size={12} aria-hidden="true" /> });
  if (teamName) badges.push({ key: "team", label: t("card_badge_team", { team: teamName }), tone: "ok", icon: <Users size={12} aria-hidden="true" /> });

  return (
    <div role="dialog" aria-label={t("card_aria", { name: agent.name })}
      className="panel anim-rise absolute z-30 p-3 flex flex-col gap-2.5 pointer-events-auto max-h-[calc(100%-1rem)] overflow-y-auto"
      style={style} onMouseEnter={onEnter} onMouseLeave={onLeave} onFocus={onEnter}>
      <header className="flex items-start gap-2.5 min-w-0">
        <PixelFace avatar={agent.avatar} mood={mood} size={40} ring={agent.color} />
        <div className="min-w-0 flex-1">
          <p className="font-display text-base font-semibold leading-6 truncate">{agent.name}</p>
          <p className="text-xs text-muted truncate">
            {[title, teamName, external?.label].filter(Boolean).join(" · ") || t("card_agent")}
          </p>
        </div>
        <Badge tone={MOOD_TONE[mood]} className="shrink-0">{external && mood === "waiting" ? t("hud_awaiting") : MOOD_LABEL[mood]}</Badge>
      </header>

      {game && (
        <div className="flex items-center gap-2">
          <span className="chip tone-warn !px-1.5 shrink-0">{t("card_level", { n: game.level })}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="font-semibold text-ink-2 truncate">{game.title}</span>
              <span className="text-muted num shrink-0">{t("card_xp_left", { n: fmtNumber(game.xpToNext) })}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-panel-3 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100}
              aria-valuenow={pct} aria-valuetext={t("card_xp_aria", { level: game.level, xp: game.xpToNext })}>
              <div className="h-full bg-grass" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>
      )}

      {!external && (
        <section aria-label={t("card_badges")} className="flex flex-wrap items-center gap-1">
          {badges.slice(0, BADGE_SLOTS).map((b) => (
            <span key={b.key} className={`chip tone-${b.tone} !px-1.5`}>{b.icon}{b.label}</span>
          ))}
          {Array.from({ length: Math.max(0, BADGE_SLOTS - badges.length) }, (_, i) => (
            <span key={`slot-${i}`} className="badge-slot" aria-label={t("card_badge_slot")} title={t("card_badge_slot")} />
          ))}
          {badges.length === 0 && <span className="sr-only">{t("card_badges_empty")}</span>}
        </section>
      )}

      {work ? (
        <section className="flex flex-col gap-2" aria-label={t("card_now")}>
          {(work.runTitle || work.origin) && (
            <div className="flex items-start gap-2 min-w-0">
              <p className="text-sm font-semibold line-clamp-2 flex-1 min-w-0">{work.runTitle || t("card_task")}</p>
              <OriginBadge origin={work.origin} compact />
            </div>
          )}
          {(work.stepTitle || work.step) && (
            <p className="text-xs text-ink-2 truncate">
              {work.step ? t("hud_step", { a: work.step, b: work.steps }) : t("card_step")}{work.stepTitle ? ` · ${work.stepTitle}` : ""}
            </p>
          )}
          {work.states.length > 0 && <PhasePipeline states={work.states} labeled tool={work.tool} />}
          <p className="text-sm font-semibold">{work.label}</p>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
            {(work.route || routeLabel) && (<><dt className="text-muted">{t("card_route")}</dt><dd className="truncate">{work.route || routeLabel}</dd></>)}
            {work.since && (
              <><dt className="text-muted flex items-center gap-1"><Timer size={12} aria-hidden="true" />{t("card_duration")}</dt>
                <dd className="num"><span data-since={work.finished ? undefined : work.since}>{fmtElapsed(Date.now() - work.since)}</span></dd></>
            )}
            {work.tool && (<><dt className="text-muted flex items-center gap-1"><Wrench size={12} aria-hidden="true" />{t("card_last_tool")}</dt>
              <dd className="truncate font-mono">{work.tool}{work.toolCount > 1 ? ` (+${work.toolCount - 1})` : ""}</dd></>)}
            {!external && (<><dt className="text-muted">{t("card_tokens")}</dt>
              <dd className="num">{work.tokens != null ? fmtTokens(work.tokens) : t("card_tokens_pending")}</dd></>)}
          </dl>
          {work.awaiting && (
            <p className="chip tone-warn self-start"><Hand size={12} aria-hidden="true" />{t("card_awaiting_hint")}</p>
          )}
        </section>
      ) : (
        <p className="text-sm text-ink-2">
          {mood === "offline" ? t("card_offline") : mood === "error" ? (wa.activity || t("card_error")) : t("card_idle")}
          {routeLabel ? <span className="block text-xs text-muted mt-0.5 truncate">{t("card_route_line", { route: routeLabel })}</span> : null}
        </p>
      )}

      <footer className="flex flex-wrap gap-1.5">
        {work?.runId && (
          <Link to={`/gorevler/${work.runId}`} className="btn btn-sm btn-primary">
            <ExternalLink size={14} aria-hidden="true" />{t("card_open_task")}
          </Link>
        )}
        {projectKey && (
          <Link to={`/projeler/${encodeURIComponent(projectKey)}`} className="btn btn-sm">
            <ExternalLink size={14} aria-hidden="true" />{t("card_open_project")}
          </Link>
        )}
        {!external && onOpenAgent && (
          <Button size="sm" icon={<Bot size={14} aria-hidden="true" />} onClick={() => onOpenAgent(agent.slug)}>{t("card_open_agent")}</Button>
        )}
      </footer>
    </div>
  );
}
