// Ekip S26 — koşu denetimi ve iz görünümünün ortak biçimlendiricileri (bileşen dosyalarından ayrı: Fast Refresh).
import { brainLabel } from "../../lib/brainLabel";
import { CONNECTION_META } from "../../lib/format";
import { currentLocale, fmtNumber, type useT } from "../../lib/i18n";
import type { ManifestChange, Run, StepAsk, StepCap, StepRun } from "../../lib/types";
import type { traceMsg } from "../../locales/trace";

export type T = ReturnType<typeof useT<typeof traceMsg.tr>>;

/** Bağlantı türü → görünen ad (S29 `openai_compat` dahil; bilinmeyen tür olduğu gibi). */
export function connectionLabel(t: T, kind?: string | null): string {
  if (!kind) return "";
  if (kind === "openai_compat") return t("conn_openai_compat");
  if (kind === "hermes") return "Hermes";
  return CONNECTION_META[kind]?.short ?? kind;
}

export function fmtUsd(n: number): string {
  return fmtNumber(n, { style: "currency", currency: "USD", minimumFractionDigits: n > 0 && n < 0.01 ? 4 : 2, maximumFractionDigits: n > 0 && n < 0.01 ? 4 : 2 });
}

export function metricLabel(t: T, metric: string): string {
  return metric === "tokens" ? t("metric_tokens") : metric === "cost_usd" ? t("metric_cost_usd")
    : metric === "minutes" ? t("metric_minutes") : metric === "steps" ? t("metric_steps") : metric;
}

export function metricValue(t: T, metric: string, v: number | null | undefined): string {
  if (v == null) return "—";
  if (metric === "cost_usd") return fmtUsd(v);
  if (metric === "minutes") return t("budget_minutes_val", { n: fmtNumber(Math.round(v * 10) / 10) });
  return fmtNumber(Math.round(v));
}

// ------------------------------------------------------------------ G4-REST: manifest farkı ve adım tavanı
function shortVal(t: T, v: unknown): string {
  if (v == null || v === "") return t("mdiff_none");
  if (typeof v === "number") return fmtNumber(v);
  if (typeof v === "string") return /^[0-9a-f]{12,}$/.test(v) ? v.slice(0, 12) : v.length > 40 ? `${v.slice(0, 39)}…` : v;
  const s = JSON.stringify(v);
  return s.length > 40 ? `${s.slice(0, 39)}…` : s;
}

const AGENT_ATTR: Record<string, Parameters<T>[0]> = {
  runtime: "mdiff_a_runtime", connection: "mdiff_a_connection", model: "mdiff_a_model", profile: "mdiff_a_profile",
  permissions: "mdiff_a_permissions", persona: "mdiff_a_persona",
};
// manifest.py LIMIT_KEYS → yerel ad anahtarı `mdiff_l_<anahtar>`
const LIMIT_KEYS: readonly string[] = ["step_tokens", "run_deadline_min", "default_budget", "daily_budget"];
const limitName = (t: T, key: string): string =>
  (LIMIT_KEYS.includes(key) ? t(`mdiff_l_${key}` as Parameters<T>[0]) : key);

/** Ajan alanının değeri: beyin kimliği → ad ("openai_compat" → "OpenAI uyumlu sunucu"); var/yok → metin. */
function attrVal(t: T, attr: string | null | undefined, v: unknown): string {
  if ((attr === "connection" || attr === "runtime") && typeof v === "string" && v) return brainLabel(v, currentLocale());
  if (attr === "agent" && (v === "missing" || v === "present")) return t(v === "missing" ? "mdiff_v_missing" : "mdiff_v_present");
  return shortVal(t, v);
}

/** Tek fark → "Ajan Yazılımcı · beyin: Claude Code → Ollama" (alan, ajan adı ve beyin kimliği yerelleştirilir).
 * `nameOf`: ajan kimliği (slug) → görünen ad; verilmezse kimlik.*/
export function manifestChangeText(t: T, c: ManifestChange, nameOf?: (slug: string) => string): string {
  const name = (slug: string) => (nameOf ? nameOf(slug) : slug);
  const cut = c.field === "skill" && c.key ? c.key.indexOf("/") : -1;  // skill farkı anahtarı: "<ajan>/<skill>"
  const who = !c.key ? "?" : cut > 0 ? `${c.key.slice(cut + 1)} (${name(c.key.slice(0, cut))})` : name(c.key);
  const field = c.field === "studio_version" ? t("mdiff_f_studio") : c.field === "prompt_layout_version" ? t("mdiff_f_layout")
    : c.field === "spec_version" ? t("mdiff_f_spec") : c.field === "workflow_sha" ? t("mdiff_f_workflow")
    : c.field === "agent" ? t("mdiff_f_agent", { key: who }) : c.field === "skill" ? t("mdiff_f_skill", { key: who })
    : c.field === "limits" ? t("mdiff_f_limit", { key: c.key ? limitName(t, c.key) : "?" }) : c.field;
  const attr = c.field === "agent" && c.attr && c.attr !== "agent"
    ? ` · ${AGENT_ATTR[c.attr] ? t(AGENT_ATTR[c.attr]) : c.attr}` : "";
  const at = c.field === "agent" ? c.attr : null;
  return `${field}${attr}: ${attrVal(t, at, c.from)} → ${attrVal(t, at, c.to)}`;
}

/** Adım tavanının kaynağı: "öngörü 200 000 × 3" · "ayar" · "adım bütçesi" … */
export function capSourceText(t: T, cap: StepCap): string {
  if (cap.source === "estimate")  // taban ve tavan rozette de görünür; tekil/çoğul örnek
    return t(cap.samples === 1 ? "cap_src_estimate_one" : "cap_src_estimate", {
      est: fmtNumber(Math.round(cap.estimate ?? 0)), factor: cap.factor ?? 3, n: cap.samples ?? 0,
      floor: fmtNumber(cap.floor ?? 50_000), ceiling: fmtNumber(cap.ceiling ?? 2_000_000) });
  // PROC2-FIX P1: geçmiş yokken beyin başına QA ölçümüne dayanan varsayılan
  if (cap.source === "brain") return t("cap_src_brain", { brain: cap.brain ?? "?", typical: fmtNumber(cap.typical ?? 0) });
  if (cap.source === "setting") return t("cap_src_setting");
  if (cap.source === "step") return t("cap_src_step");
  if (cap.source === "workflow") return t("cap_src_workflow");
  if (cap.source === "raised") return t("cap_src_raised");
  if (cap.source === "off") return t("cap_src_off");
  return t("cap_src_default");
}

/** Onay kartı verisi: canlı adımda `step.ask`; soğuk okumada (yeniden başlatma sonrası) sunucu adımda `ask` vermiyor,
 *  bu yüzden kalıcı olay günlüğündeki `step.added` / `step.awaiting` olaylarından alınır. */
export function stepAsk(run: Run, step: StepRun): StepAsk | null {
  if (step.ask) return step.ask;
  if (step.type !== "approval") return null;
  for (const e of run.events ?? []) {
    if (e.type === "step.added" && e.step && typeof e.step === "object" && (e.step as { id?: string }).id === step.id) {
      const a = (e.step as { ask?: StepAsk }).ask;
      if (a) return a;
    }
    if (e.type === "step.awaiting" && e.step === step.id && e.ask) return e.ask as StepAsk;
  }
  return null;
}

export function isAskCard(run: Run, step: StepRun): boolean {
  const ask = stepAsk(run, step);
  return step.type === "approval" && !!ask && ["on_fail", "unknown_effect", "budget", "step_approval", "manifest_diff"].includes(ask.kind);
}
