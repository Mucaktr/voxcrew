// PROC-FIX akışın teslim adımı. Sunucudaki kuralın (backend/studio/workflow/spec.py `deliverable_warning`)
// arayüz karşılığı: teslim seçilmemişken son ajan adımı denetim türündeyse (açık `kind: review` ya da ajanın rolü /
// açıklaması denetçi/review diyorsa) düzenleyici uyarır.
// PROC2-FIX teslim birden çok adım olabilir; öneri denetim adımının denetlediği (bağımlı olduğu) yazan /
// üreten adımlardır, asla denetim adımı değildir. zayıf yazar uyarısı (`weak_writer_warnings` karşılığı).
import type { Agent, Workflow, WorkflowStep } from "../../lib/types";

const AGENTIC = new Set(["agent", "delegate", "orchestrate"]);
const REVIEW_WORDS = ["denetçi", "denetci", "denetim", "review", "reviewer", "auditor", "audit", "gözden geçir", "hakem"];
const STEP_REF = /\{\{\s*steps\.([a-z0-9_-]+)\.[a-z_]+\s*\}\}/gi;

export function reviewLike(step: WorkflowStep, agent?: Agent): boolean {
  if (!AGENTIC.has(step.type)) return false;
  if (step.kind === "review") return true;
  const text = [agent?.role, agent?.title, agent?.name, step.role].filter(Boolean).join(" ").toLocaleLowerCase("tr");
  return REVIEW_WORDS.some((w) => text.includes(w));
}

/** Teslim adımı kimlikleri (sıralı): metin ya da liste. */
export function deliverableIds(wf: Pick<Workflow, "deliverable">): string[] {
  const raw = wf.deliverable;
  if (!raw) return [];
  return (Array.isArray(raw) ? raw : [raw]).filter((x, i, a) => !!x && a.indexOf(x) === i);
}

/** Seçili kimlikler → kayıt biçimi: yok → undefined, tek → metin, çok → adım sırasıyla liste. */
export function deliverableValue(wf: Workflow, ids: string[]): string | string[] | undefined {
  const order = wf.steps.map((s) => s.id);
  const sorted = [...new Set(ids)].filter((x) => order.includes(x)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return sorted.length === 0 ? undefined : sorted.length === 1 ? sorted[0] : sorted;
}

/** Etkin bağımlılıklar: `depends_on` + istem/iletideki `{{steps.X.output}}` (sırada önce gelen X). */
function effectiveDeps(wf: Workflow, step: WorkflowStep): Set<string> {
  const order = wf.steps.map((s) => s.id);
  const pos = order.indexOf(step.id);
  const out = new Set(step.depends_on ?? []);
  for (const text of [step.prompt ?? "", step.message ?? ""]) {
    for (const m of text.matchAll(STEP_REF)) {
      const ref = m[1];
      if (ref !== step.id && order.indexOf(ref) >= 0 && order.indexOf(ref) < pos) out.add(ref);
    }
  }
  return out;
}

export interface DeliverableWarning { step: string; suggest: string | null; suggestAll: string[] }

export function deliverableWarning(wf: Workflow, agents: Agent[]): DeliverableWarning | null {
  if (deliverableIds(wf).length) return null;
  const agentic = wf.steps.filter((s) => AGENTIC.has(s.type));
  if (!agentic.length) return null;
  const of = (s: WorkflowStep) => agents.find((a) => a.slug === s.agent);
  const last = agentic[agentic.length - 1];
  if (!reviewLike(last, of(last))) return null;
  const reviewed = effectiveDeps(wf, last);
  let producers = agentic.slice(0, -1).filter((s) => reviewed.has(s.id) && !reviewLike(s, of(s))).map((s) => s.id);
  if (!producers.length) {
    const fallback = [...agentic.slice(0, -1)].reverse().find((s) => !reviewLike(s, of(s)));
    producers = fallback ? [fallback.id] : [];
  }
  return { step: last.id, suggest: producers[0] ?? null, suggestAll: producers };
}

// ---------------------------------------------------------------- zayıf yazar uyarısı
const FAITHFUL_RE = /do[gğ]rulama\s+tablo|do[gğ]rulanm[ıi][sş]\s+olgu|verification\s+table|verified\s+facts/i;
const VERIFY_TITLE_RE = /do[gğ]rula|verif/i;
const SIZE_RE = /(?<![\d.])(\d+(?:\.\d+)?)\s*b(?![a-z])/i;
export const SMALL_MODEL_B = 9;

export function modelSizeB(model?: string | null): number | null {
  const m = SIZE_RE.exec(model ?? "");
  return m ? Number(m[1]) : null;
}

export function needsFaithfulWriter(wf: Workflow, step: WorkflowStep): boolean {
  if (!AGENTIC.has(step.type) || step.kind === "review") return false;
  if (FAITHFUL_RE.test(step.prompt ?? "")) return true;
  const deps = effectiveDeps(wf, step);
  return wf.steps.some((s) => deps.has(s.id) && (s.kind === "review" || VERIFY_TITLE_RE.test(s.title ?? "")));
}

/** Adımın beyni bu bilgisayarda mı ve hangi model: adımın açık bağlantı/modeli ya da ajanın rotası. */
function stepBrain(step: WorkflowStep, agent?: Agent): { local: boolean; model: string | null } {
  const route = agent?.route;
  const conn = step.connection || route?.connection || agent?.connection;
  const model = step.model || route?.model || agent?.model || null;
  const local = conn === "ollama" || (conn === "openai_compat" && !!route && !route.remote);
  return { local, model };
}

export interface WeakWriterWarning { step: string; model: string; size: number }

/** Doğrulanmış olgulara sadakat isteyen adım ≤ 9B yerel modele verildiyse uyarı (beyin otomatik değişmez). */
export function weakWriterWarnings(wf: Workflow, agents: Agent[]): WeakWriterWarning[] {
  const out: WeakWriterWarning[] = [];
  for (const s of wf.steps) {
    if (!needsFaithfulWriter(wf, s)) continue;
    const { local, model } = stepBrain(s, agents.find((a) => a.slug === s.agent));
    const size = modelSizeB(model);
    if (local && model && size != null && size <= SMALL_MODEL_B) out.push({ step: s.id, model, size });
  }
  return out;
}
