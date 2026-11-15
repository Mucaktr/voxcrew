// Paid-feature types that kept (edition-neutral) code reads. Single source for both editions: the paid libs re-export them,
// full/*/index fallbacks re-export them too. Types only (no runtime code, no paid imports).

export type ExternalSource = "claude-code" | "codex";
export type ExternalStatus = "active" | "waiting" | "idle" | "ended";

export interface ExternalAgent {
  /** ExternalSession.id */
  id: string;
  source: ExternalSource;
  title: string;
  /** Project.key — kararlı avatar bu anahtardan türetilir */
  projectKey: string;
  projectName: string;
  status: ExternalStatus;
  /** "Düşünüyor", "Bash çalıştırıyor", "İzin bekliyor" gibi kısa etiket */
  activity?: string | null;
  tool?: string | null;
  /** alt ajansa üst oturum kimliği */
  parent?: string | null;
  isSubagent: boolean;
  startedAt?: string | null;
  lastEventAt?: string | null;
}

export interface ResumeAsk {
  kind: "approval" | "tool_approval" | "paused" | "message"; run_id: string | null; step_id: string | null; run_title: string;
  text: string; since: string | null; link: string;
  /** PANO-FIX kararın kartına inen bağlantı (`?karar=<adım>`)*/
  deep_link?: string;
  /** PANO-FIX (yalnız `order=oldest`): blocking | question | paused */
  group?: "blocking" | "question" | "paused";
  /** adım kartı türü (`plan_approval`, `gate`…), onay kartı türü (`budget`, `step_approval`…), araç ve komut */
  step_kind?: string; ask_kind?: string; tool?: string; command?: string;
}
export interface ResumeView {
  acceptances: { items: { id: string; run_id: string; title: string; created_at: string; verification_status: string; can_accept: boolean;
    link: string; deep_link?: string }[]; total: number; oldest?: string | null };
  /** PANO-FIX `oldest` ve `blocking` kırpılmamış kümeden (yalnız `order=oldest`)*/
  asks: { items: ResumeAsk[]; total: number; oldest?: string | null; blocking?: number };
  order?: "oldest";
  /** PROC2-FIX P3: `version_state` = yerine yeni sürüm geldi (`superseded`) ya da revizyonu sürüyor (`revising`) */
  deliverables: { items: { id: string; title: string; kind: string; run_id: string; created_at: string; unread: boolean;
    version_state?: "superseded" | "revising"; link: string }[]; total: number };
}

export interface EstimateSpec {
  kind: "task" | "workflow" | "recipe" | "custom";
  agent?: string; prompt?: string; connection?: string; brain?: string; model?: string;
  workflow_id?: string; inputs?: Record<string, unknown>;
  steps?: { id: string; type?: string; agent?: string; role?: string; brain?: string; connection?: string; model?: string; prompt?: string; depends_on?: string[] }[];
}

export interface BudgetCap { tokens: number | null; cost_usd: number | null; on_exceeded: "ask" | "pause" | "stop" }
export interface CapState { enabled: boolean; cap: BudgetCap }

export interface ShelfItem { ref: string; kind: string; item?: string | null; label: string; label_en: string; ts: string }
export interface Shelf { items: ShelfItem[]; count: number }
