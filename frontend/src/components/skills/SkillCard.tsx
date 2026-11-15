// Ekip S14: kütüphane kartı — ad, açıklama, kaynak/durum rozetleri, kullanan ajan sayısı; seçim modu destekler.
import clsx from "clsx";
import { Check, FileCode2, Users } from "lucide-react";
import { tp, useT } from "../../lib/i18n";
import type { SkillEntry } from "../../lib/skills";
import { skillsMsg as m } from "../../locales/skills";
import { Badge } from "../ui";
import { entryHint, SourceBadge, TokensBadge } from "./common";

export function SkillCard({ skill, onOpen, selectable, selected, onToggle }:
  { skill: SkillEntry; onOpen: () => void; selectable?: boolean; selected?: boolean; onToggle?: () => void }) {
  const t = useT(m);
  const users = skill.agents ?? [];
  const hint = entryHint(skill);
  return (
    <div className={clsx("card-select h-full flex flex-col gap-2 p-3.5 relative", !skill.loadable && "opacity-70", selected && "border-line bg-panel")}
      aria-pressed={selected || undefined}>
      {selectable && (
        <label className="absolute top-2.5 right-2.5 inline-flex items-center justify-center h-6 w-6 rounded-md border-2 border-line bg-panel cursor-pointer"
          title={t("card_select", { name: skill.name })}>
          <input type="checkbox" className="sr-only" checked={!!selected} onChange={onToggle} aria-label={t("card_select", { name: skill.name })} />
          {selected && <Check size={14} aria-hidden />}
        </label>
      )}
      <button type="button" onClick={onOpen} className="text-left flex flex-col gap-2 flex-1 min-w-0 focus-visible:outline-none"
        aria-label={t("card_open", { name: skill.name })}>
        <span className={clsx("flex items-start gap-2 w-full", selectable && "pr-7")}>
          <span className="font-mono text-sm font-semibold break-all flex-1 min-w-0">{skill.name}</span>
          <SourceBadge source={skill.source} className="shrink-0" />
        </span>
        <span className="text-sm text-ink-2 leading-snug line-clamp-3">{skill.description || t("lib_no_desc")}</span>
        <span className="flex flex-wrap gap-1.5 mt-auto pt-1">
          {skill.key !== skill.name && <Badge><span className="font-mono">{skill.key}</span></Badge>}
          {hint && <Badge tone="muted">{hint}</Badge>}
          {skill.tags.slice(0, 3).map((tag) => <Badge key={tag}>#{tag}</Badge>)}
          {skill.tags.length > 3 && <Badge>+{skill.tags.length - 3}</Badge>}
          {skill.has_scripts && <Badge tone="warn"><FileCode2 size={12} aria-hidden />{t("scripts_badge")}</Badge>}
          {!skill.loadable && <Badge tone="bad" title={skill.reason ?? undefined}>{t("unavailable")}</Badge>}
        </span>
        <span className="flex items-center gap-3 text-xs text-muted">
          <TokensBadge chars={skill.size_chars} />
          {users.length > 0 && (
            <span className="flex items-center gap-1" title={users.map((u) => u.name).join(", ")}>
              <Users size={13} aria-hidden />{tp(m, "agents_count", users.length)}
            </span>
          )}
        </span>
      </button>
    </div>
  );
}
