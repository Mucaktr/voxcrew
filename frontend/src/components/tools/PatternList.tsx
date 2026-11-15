// Ekip S27 — araç kalıbı listesi düzenleyicisi (sunucu:araç kalıpları; Enter ya da Ekle ile eklenir).
import { Plus, X } from "lucide-react";
import { useId, useState } from "react";
import { useT } from "../../lib/i18n";
import { PATTERN_RE } from "../../lib/tools";
import { toolsMsg } from "../../locales/tools";
import { Badge, Button, Field } from "../ui";

export function PatternList({ label, hint, value, onChange, tone = "muted", disabled }:
  { label: string; hint?: string; value: string[]; onChange: (v: string[]) => void; tone?: string; disabled?: boolean }) {
  const t = useT(toolsMsg);
  const [draft, setDraft] = useState("");
  const inputId = useId();
  const hintId = useId();
  const clean = draft.trim();
  const invalid = clean !== "" && !PATTERN_RE.test(clean);
  const add = () => {
    if (!clean || invalid || value.includes(clean)) { if (value.includes(clean)) setDraft(""); return; }
    onChange([...value, clean]);
    setDraft("");
  };
  return (
    <Field label={<label htmlFor={inputId}>{label}</label>} hint={hint && <span id={hintId}>{hint}</span>}>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={label}>
          {value.map((p) => (
            <li key={p}>
              <Badge tone={tone} className="font-mono !pr-1">
                <span className="break-all">{p}</span>
                <button type="button" disabled={disabled} onClick={() => onChange(value.filter((x) => x !== p))}
                  aria-label={t("remove", { p })} className="rounded-sm p-0.5 hover:bg-panel-3 focus-visible:outline-2">
                  <X size={12} aria-hidden />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2 min-w-0">
        <input id={inputId} className="input font-mono flex-1 min-w-0" value={draft} disabled={disabled}
          placeholder={t("pattern_placeholder")} aria-invalid={invalid || undefined} aria-describedby={hint ? hintId : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <Button size="sm" icon={<Plus size={14} aria-hidden />} onClick={add} disabled={disabled || !clean || invalid}>{t("add")}</Button>
      </div>
    </Field>
  );
}
