// DASH-MVP ajan durum satırı: Dünya yan sütunu (WorldPage "Ekip") ile Pano "Ajanlar" bölümünün ortak bileşeni.
// Ortak sözleşme (props, memo karşılaştırması, durum tonu) burada; iki görünüm:
// - `AgentStatusRow` (bu dosya): Pano — 40 px yüz + durum noktası, ad + metinli durum
//   çipi, aşama çubuğu + iş + süre ya da hazır beyin; seviye çipi yok (Pano Görünümü oyun katmanını göstermez).
// - `WorldAgentStatusRow` (AgentStatusRowWorld.tsx): Dünya yan sütunu, eski TeamRow'un birebir aynısı (seviye çipi, aşama
//   hattı, unvan). Ayrı dosyadadır ki Pano parçası dünya bileşenlerini (AgentLevelChip, PhasePipeline) yüklemesin.
// S39 C-08: memo — akan olaylarda yalnız durumu değişen satır çizilir. three/voxel sahnesi içe aktarılmaz.
// PANO-FIX Pano satırı durumunu Pano'nun kendi metinleriyle yazar (`boardText.status`; "Uyuyor/Düşünüyor" yok):
// erişilemeyen beyin yalnız ajan boştayken baskındır ("Bağlantı yok"); çalışan/bekleyen ajanın durumu korunur, bağlantı
// uyarısı alt satırda kalır. Sıradaki ajan "Sırada". Dünya Görünümü (WorldAgentStatusRow) kendi dilini korur.
import { Cpu, PlugZap, Send } from "lucide-react";
import { memo } from "react";
import { Link } from "react-router-dom";
import { PixelFace } from "../PixelFace";
import { Badge, Button } from "../ui";
import { fmtElapsed, sameWork, type WorkInfo } from "../world/activity";
import { useT } from "../../lib/i18n";
import { MOOD_LABEL } from "../../lib/format";
import type { Agent, Mood } from "../../lib/types";
import { world as M } from "../../locales/world";

export type AgentStatusRowProps = {
  a: Agent; mood: Mood; avOk: boolean; avReason?: string; activity?: string; teamName?: string; teamColor?: string;
  work: WorkInfo | null; selected: boolean; onPick: (slug: string) => void; onTask: (slug?: string) => void;
  /** Pano metinleri (Pano'nun kendi sözlüğünden; bu bileşen locales/board'u içe aktarmaz) */
  boardText?: {
    taskFor: (name: string) => string; ready: (brain: string) => string; fix: string;
    status?: Record<"working" | "queued" | "waiting" | "error" | "idle" | "offline" | "done", string>;
    activity?: (raw: string | undefined) => string;
  };
};

export const MOOD_TONE = (mood: Mood) => (mood === "idle" ? "ok" : mood === "error" || mood === "offline" ? "bad" : mood === "waiting" ? "warn" : "info");
const DOT: Record<string, string> = { ok: "var(--meter-ok)", info: "var(--live)", warn: "var(--attn)", bad: "var(--meter-bad)", muted: "var(--muted)" };

/** memo karşılaştırması (iki görünüm ortak). */
export function sameRowProps(p: AgentStatusRowProps, n: AgentStatusRowProps): boolean {
  return p.a === n.a && p.mood === n.mood && p.avOk === n.avOk && p.avReason === n.avReason && p.activity === n.activity
    && p.teamName === n.teamName && p.teamColor === n.teamColor && p.selected === n.selected && p.onPick === n.onPick
    && p.onTask === n.onTask && p.boardText === n.boardText
    && (p.work === n.work || (!!p.work && !!n.work && sameWork(p.work, n.work)));
}

/** Pano: aşama hattının sakin, dekoratif çubuk biçimi (dünya CSS'ine bağlı değil); durum metni yanında yazılır. */
function PhaseBar({ states }: { states: WorkInfo["states"] }) {
  return (
    <span aria-hidden className="inline-flex gap-0.5 shrink-0">
      {states.map((s, i) => (
        <i key={i} className="block h-1 w-2.5 rounded-sm"
          style={{ background: s === "done" ? "var(--meter-ok)" : s === "active" ? "var(--live)" : "var(--track)" }} />
      ))}
    </span>
  );
}

/** Pano: sakin, metinli durum; seviye çipi ve ekip karesi yok. */
export const AgentStatusRow = memo(function AgentStatusRow({ a, mood, avOk, avReason, activity, work, onPick, onTask, boardText }: AgentStatusRowProps) {
  const t = useT(M);
  const st = boardText?.status;
  const busy = mood === "working" || mood === "thinking" || mood === "waiting";
  const queued = /^(sırada|queued)/i.test(activity ?? "");
  // ajan çalışıyor ya da onay bekliyorsa durumu o; bağlantı sorunu yalnız boştayken (ya da çevrimdışıyken) baskın
  const tone = st ? (!busy && (!avOk || mood === "offline") ? "bad" : queued && mood !== "waiting" ? "muted" : MOOD_TONE(mood))
    : !avOk && mood !== "working" && mood !== "thinking" ? "bad" : MOOD_TONE(mood);
  const label = st
    ? (!busy && (!avOk || mood === "offline") ? st.offline : mood === "waiting" ? st.waiting
      : mood === "working" || mood === "thinking" ? (queued ? st.queued : st.working) : st[mood === "error" ? "error" : mood === "done" ? "done" : "idle"])
    : !avOk && tone === "bad" ? MOOD_LABEL.offline : MOOD_LABEL[mood];
  const act = boardText?.activity ? boardText.activity(activity) : activity;
  return (
    <li className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5 rounded-[10px] p-2 max-sm:px-1 hover:bg-panel-2 transition-colors">
      <span className="relative row-span-2 self-start">
        <PixelFace avatar={a.avatar} mood={mood} size={40} ring={a.color} />
        <span aria-hidden className="absolute -right-[3px] -bottom-[3px] h-3 w-3 rounded-full border-2 border-panel" style={{ background: DOT[tone] }} />
      </span>
      <button type="button" onClick={() => onPick(a.slug)} aria-label={t("page_agent_aria", { name: a.name, mood: label })}
        className="flex items-center gap-1.5 min-w-0 text-left rounded-md font-semibold text-sm max-sm:min-h-11">
        <span className="truncate">{a.name}</span>
        <Badge tone={tone} className="!px-1.5 shrink-0">{label}</Badge>
      </button>
      <Button size="sm" variant="ghost" icon={<Send size={14} />} className="row-span-2 self-center"
        aria-label={boardText?.taskFor(a.name) ?? t("page_task_for", { name: a.name })} onClick={() => onTask(a.slug)} />
      <span className="col-start-2 flex items-center gap-1.5 min-w-0 text-xs text-ink-2">
        {work ? (
          <>
            <PhaseBar states={work.states} />
            <span className="truncate min-w-0">{(() => {
              const label = boardText?.activity ? boardText.activity(work.label) : work.label;
              return work.runTitle ? `${label} · ${work.runTitle}` : label;
            })()}</span>
            {work.since && !work.finished && (
              <span className="ml-auto pl-1 text-muted num shrink-0" data-since={work.since}>{fmtElapsed(Date.now() - work.since)}</span>
            )}
          </>
        ) : avOk ? (
          <>
            <Cpu size={14} aria-hidden className="shrink-0 text-muted" />
            <span className="truncate min-w-0">{act && mood !== "idle" ? act
              : a.route?.label ? (boardText?.ready(a.route.label) ?? a.route.label) : ""}</span>
          </>
        ) : (
          <>
            <PlugZap size={14} aria-hidden className="shrink-0 text-bad" />
            <span className="truncate min-w-0">{avReason}</span>
            {boardText && <Link to="/baglantilar" className="shrink-0 font-semibold text-link hover:underline underline-offset-2">{boardText.fix}</Link>}
          </>
        )}
      </span>
    </li>
  );
}, sameRowProps);
