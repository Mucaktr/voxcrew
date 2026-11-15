// Ayarlar → adım jeton tavanı (`limits.step_tokens`): otomatik (öngörü tabanlı) ya da sabit sayı.
// eski kurulumların dosyaya yazdığı işaretsiz 2 000 000 "otomatik" sayılır; kullanıcının kaydettiği sayı
// (`limits.step_tokens_explicit`, sunucu yazar) 2 000 000 olsa da sabit kalır.
import { Gauge } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { api } from "../../lib/api";
import { estimateBrains } from "../../full/more";
import type { BrainRow, Settings } from "../../lib/types";
import { fmtNumber, useT } from "../../lib/i18n";
import { traceMsg } from "../../locales/trace";
import { Button, SectionTitle } from "../ui";

const AUTO_LEGACY = 2_000_000;
const FLOOR = 50_000;
const BRAIN_LABEL: Record<string, "brain_claude" | "brain_api" | "brain_codex" | "brain_profile" | "brain_local"> = {
  claude: "brain_claude", api: "brain_api", codex: "brain_codex", profile: "brain_profile", local: "brain_local",
};

export function StepCapSettingsRow() {
  const t = useT(traceMsg);
  const id = useId();
  const [mode, setMode] = useState<"auto" | "fixed" | null>(null);
  const [value, setValue] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // beyin başına varsayılan tavan, tipik adım ve tavanın nerede uygulandığı — sunucudaki TEK tablodan
  const [brains, setBrains] = useState<BrainRow[]>([]);

  useEffect(() => {
    estimateBrains().then((r) => setBrains(r.brains ?? [])).catch(() => setBrains([]));
  }, []);

  useEffect(() => {
    api.settings().then((s) => {
      const lim = s.limits as { step_tokens?: unknown; step_tokens_explicit?: unknown } | undefined;
      const raw = lim?.step_tokens;
      const explicit = lim?.step_tokens_explicit === true;
      const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
      if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim().toLowerCase() === "auto")
          || (n === AUTO_LEGACY && !explicit) || !Number.isFinite(n) || n <= 0) {
        setMode("auto");
      } else {
        setMode("fixed");
        setValue(String(Math.round(n)));
      }
    }).catch((e) => setNote(e instanceof Error ? e.message : String(e)));
  }, []);

  const save = async () => {
    setBusy(true); setNote(null);
    try {
      const v = mode === "fixed" ? Math.round(Number(value)) : "auto";
      await api.saveSettings({ limits: { step_tokens: v } } as Partial<Settings>);
      setNote(t("stepcap_saved"));
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };
  if (mode === null) return note ? <p className="text-xs text-bad mt-4">{note}</p> : null;
  const invalid = mode === "fixed" && !(Number(value) >= 1000 && Number(value) <= 100_000_000);
  return (
    <div className="mt-5 pt-4 border-t-2 border-line-soft flex flex-wrap items-start gap-3">
      <Gauge size={18} className="shrink-0 text-ink-2 mt-0.5" aria-hidden />
      <div className="flex-1 min-w-[min(100%,240px)] flex flex-col gap-2">
        <div>
          <SectionTitle as="h3" size="sm">{t("stepcap_title")}</SectionTitle>
          <p className="text-xs text-muted mt-0.5">{t("stepcap_text", { floor: fmtNumber(FLOOR), ceiling: fmtNumber(AUTO_LEGACY) })}</p>
          {brains.length > 0 && (
            <ul className="mt-1 flex flex-col gap-0.5 text-xs text-ink-2" aria-label={t("stepcap_brains_label")}>
              {brains.map((b) => {
                const brain = BRAIN_LABEL[b.key] ? t(BRAIN_LABEL[b.key]) : b.key;
                const enf = t(b.enforcement === "turn" ? "enf_turn" : "enf_step_end");
                return (
                  <li key={b.key} className="break-words">
                    {b.cap > 0
                      ? t("stepcap_brain_row", { brain, cap: fmtNumber(b.cap), typical: fmtNumber(b.typical), enf })
                      : t("stepcap_brain_row_nocap", { brain, typical: fmtNumber(b.typical), enf })}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <fieldset className="flex flex-wrap items-center gap-3 text-sm">
          <legend className="sr-only">{t("stepcap_title")}</legend>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" name={`${id}-mode`} aria-label={t("stepcap_auto")} checked={mode === "auto"} onChange={() => setMode("auto")} />
            {t("stepcap_auto")}
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" name={`${id}-mode`} aria-label={t("stepcap_fixed")} checked={mode === "fixed"} onChange={() => setMode("fixed")} />
            {t("stepcap_fixed")}
          </label>
          {mode === "fixed" && (
            <input className="input w-40 num" type="number" min={1000} max={100000000} step={1000} value={value}
              aria-label={t("stepcap_value")} aria-invalid={invalid} aria-describedby={invalid ? `${id}-range` : undefined}
              onChange={(e) => setValue(e.target.value)} />
          )}
          <Button size="sm" onClick={() => { void save(); }} disabled={busy || invalid}>{t("stepcap_save")}</Button>
        </fieldset>
        {invalid && <p id={`${id}-range`} className="text-xs text-bad">{t("stepcap_range", { min: fmtNumber(1000), max: fmtNumber(100_000_000) })}</p>}
        <p className="text-xs text-muted">{t("stepcap_auto_note", { ceiling: fmtNumber(AUTO_LEGACY) })}</p>
        <p role="status" aria-live="polite" className="text-xs text-muted">{note}</p>
      </div>
    </div>
  );
}
