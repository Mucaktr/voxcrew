// proje (bellek ad alanı) alanı: görev penceresi ve hedef formu ortak kullanır.
// Değer çıplak proje anahtarıdır ("" = genel bellek); bilinen ad alanları datalist önerisi olarak gelir.
import { useId, useMemo } from "react";
import { useT } from "../../lib/i18n";
import { keyOf, toNamespace, type MemoryNamespace } from "../../lib/memory";
import { memoryMsg } from "../../locales/memory";
import { Field } from "../ui";

export function projectKeyValid(value: string, known?: ReadonlySet<string>): boolean {
  return toNamespace(value, known) !== null;
}

export function knownProjectKeys(list: MemoryNamespace[]): Set<string> {
  return new Set(list.map((n) => keyOf(n.namespace)).filter((k): k is string => !!k));
}

export function ProjectField({ value, onChange, namespaces, hint, className }: {
  value: string; onChange: (v: string) => void; namespaces: MemoryNamespace[]; hint?: string; className?: string;
}) {
  const t = useT(memoryMsg);
  const listId = useId();
  const hintId = useId();
  const known = useMemo(() => knownProjectKeys(namespaces), [namespaces]);
  const invalid = !projectKeyValid(value, known);
  const options = useMemo(() => namespaces.filter((n) => n.key), [namespaces]);
  return (
    <Field label={t("project_label")} className={className}
      hint={<span id={hintId} className={invalid ? "text-bad" : undefined}>{invalid ? t("project_invalid") : hint ?? t("project_hint")}</span>}>
      <input className="input" value={value} list={listId} placeholder={t("project_placeholder")}
        aria-label={t("project_aria")} aria-invalid={invalid || undefined} aria-describedby={hintId}
        autoComplete="off" spellCheck={false} maxLength={70}
        onChange={(e) => onChange(e.target.value)} />
      <datalist id={listId}>
        {options.map((n) => (
          <option key={n.namespace} value={n.key ?? ""}>
            {t("ns_option", { name: n.name ?? n.key ?? "", episodes: n.episodes, facts: n.facts })}
          </option>
        ))}
      </datalist>
    </Field>
  );
}
