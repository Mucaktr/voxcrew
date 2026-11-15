/**
 * Ajan üstü bilgi göstergesi (drei Html içinde çizilir — ayrı React kökü: yönlendirici/bağlam YOK, yalnızca props).
 * Katman 1 (her zaman): seviye rozeti + [bağlayıcı simgesi] ad · etkinlik fiili (S33; boştayken unvan) + ince XP çubuğu.
 * Konuşma balonu (S33): gerçek teslim/mesaj olayının kısa özeti; metni World.tsx `useFrame` içinde DOM'a yazar.
 * Katman 2 (çalışırken): aşama hattı, durum metni, adım x/y, geçen süre, son araç, "Onay bekliyor" rozeti.
 * Ekran okuyuculardan gizlidir; aynı bilgi Dünya sayfasındaki "Ekip" listesinde ve kartta DOM olarak vardır.
 */
import clsx from "clsx";
import { Hand, Plug, Timer, Wrench } from "lucide-react";
import type { CSSProperties, Ref } from "react";
import type { GameAgent } from "../../lib/game";
import { CONN_ICON } from "../ui";
import { tx } from "../../lib/i18n";
import { world as M } from "../../locales/world";
import type { Mood } from "../../lib/types";
import { fmtElapsed, type ConnKind, type WorkInfo } from "./activity";
import { PhasePipeline } from "./PhasePipeline";
import "./world.css";

export interface AgentHudProps {
  hudRef?: Ref<HTMLDivElement>;
  /** S33: konuşma balonu öğesi (metin ve görünürlük World.tsx'te yazılır) */
  sayRef?: Ref<HTMLDivElement>;
  /** S33: etkinlik fiili ("kod yazıyor", "seni bekliyor"…); boşsa unvan gösterilir */
  caption?: string;
  conn?: ConnKind | null;
  name: string;
  title?: string | null;
  color: string;
  mood: Mood;
  bubble?: string;
  bubbleText?: string;
  work?: WorkInfo | null;
  game?: GameAgent | null;
  source?: { label: string; color: string } | null;
  levelUp?: boolean;
  /** imleç üstünde / seçili: kalabalıkta da ayrıntı satırı görünür */
  focus?: boolean;
  dense?: boolean;
}

export function AgentHud({ hudRef, sayRef, caption, conn, name, title, color, mood, bubble, bubbleText, work, game, source, levelUp, focus, dense }: AgentHudProps) {
  const pct = game ? Math.round(Math.max(0, Math.min(1, game.progress)) * 100) : 0;
  return (
    <div ref={hudRef} className={clsx("whud", levelUp && "whud-lvup")} data-dense={dense ? "true" : undefined}
      data-focus={focus ? "true" : undefined} aria-hidden="true">
      <div ref={sayRef} className="whud-say" data-talk="off" />
      {work ? (
        <div className={clsx("whud-work", work.awaiting && "is-await", work.finished && "is-done")}>
          <PhasePipeline states={work.states} variant="hud" />
          {/* "Onay bekliyor" rozeti zaten varsa aynı metin ikinci kez yazılmaz (HUD bir satır kısalır) */}
          {!(work.awaiting && work.label === tx(M, "hud_awaiting")) && <div className="whud-now">{work.label}</div>}
          {(work.step || (work.since && !work.finished) || (work.tool && work.phase !== "tool")) && (
            <div className="whud-meta whud-detail">
              {work.step && <span>{tx(M, "hud_step", { a: work.step, b: work.steps })}</span>}
              {work.since && !work.finished && (
                <span><Timer aria-hidden="true" /><span data-since={work.since}>{fmtElapsed(Date.now() - work.since)}</span></span>
              )}
              {work.tool && work.phase !== "tool" && <span className="whud-tool"><Wrench aria-hidden="true" />{work.tool}</span>}
            </div>
          )}
          {work.awaiting && <div className="whud-await"><Hand aria-hidden="true" />{tx(M, "hud_awaiting")}</div>}
        </div>
      ) : bubble ? (
        <div className={`world-bubble mood-${mood}`}><span>{bubble}</span>{bubbleText && <em>{bubbleText}</em>}</div>
      ) : null}
      <div className="whud-id">
        {game && <span className="whud-lv">{game.level}</span>}
        <div className="world-name whud-name" style={{ ["--c" as string]: color } as CSSProperties}>
          {conn && <span className="whud-conn" data-conn={conn}>{conn === "openai" ? <Plug /> : CONN_ICON[conn]}</span>}
          {name}
          {caption ? <span className={clsx("whud-cap", mood === "waiting" && "is-wait")}> · {caption}</span>
            : title ? <span className="whud-title" style={{ opacity: 0.82 }}> · {title}</span> : null}
        </div>
      </div>
      {source && <div className="whud-src" style={{ ["--c" as string]: source.color } as CSSProperties}>{source.label}</div>}
      {game && <div className="whud-xp"><i style={{ width: `${pct}%` }} /></div>}
    </div>
  );
}
