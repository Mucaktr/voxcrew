// unutma planı istemcisi (backend/studio/graph/forget.py, forget_api.py).
// REST (yazma uçları yalnız kullanıcı; MCP 403): POST /api/memory/forget/plan {scope, id?, project?, tokens?,
// extra_terms?, unscoped?, amounts?} · POST /api/memory/forget/plans/{id}/apply {confirm: true, stop_runs?} (süren koşu → 409) · POST /api/memory/forget/{change}/undo {confirm: true} ·
// GET /api/memory/forget/history. Arayüz jetonunu lib/presence.ts ekler.
import { ApiError, bodyText } from "./api";
import { currentLocale } from "./i18n";

export type ForgetScope = "fact" | "episode" | "project";

export interface ForgetCounts {
  nodes: number; by_type: Record<string, number>; edges: number; fts_rows: number; checkpoints: number;
  run_events: number; event_log: number; summaries: number; derived: number; concepts_unlinked: number;
  booster_rows: number; metrics_rows: number; active_runs: number; runs: number;
  /** Hermes memories/*.md içinde aynı içerik (değiştirilmez); eski sunucu göndermez*/
  hermes_memory?: number;
  /** aynı cümleyi içeren kardeş bilgiler (düğümlere dahil); eski sunucu göndermez*/
  sibling_facts?: number;
  /** kapsamdaki süren koşular (varken uygulama reddedilir)*/
  running?: number;
  /** seçili jeton sayısı ve onları taşıyan (silinecek) bilgiler*/
  tokens?: number; token_facts?: number; namespace_runs?: number;
  /** işaretsiz terimlerden içeride karartılan kayıtlar; ayraçla eşleştiği için silinmeyip karartılan bilgiler*/
  scoped_redacted?: number; separator_facts?: number;
  /** (uygulamadan sonra): hâlâ okunur kalan kayıt sayısı ve başka bellek alanındaki kopyalar*/
  remains?: number; other_projects?: number;
  /** QA34b-01: çıktı kasasında tam taranamayan (ikili / büyük) dosya sayısı; "temiz" denmez */
  vault_unscanned?: number;
}

/** planın çıkardığı ayırt edici jeton (kod, sayı, e-posta…) ya da kullanıcı terimi*/
export interface ForgetToken {
  text: string; selected: boolean;
  /** yüksek güvenli ama unutulanların dışında etkisi olduğu için varsayılan olarak işaretlenmedi*/
  held?: boolean;
  kind: "code" | "number" | "random" | "email" | "handle" | "name" | "custom" | "pin" | "card" | "iban" | "phone" | "plate";
}

/** jeton başına etki (yalnız arayüz önizlemesi; plan ucu MCP'ye kapalı)*/
export interface ForgetTokenImpact {
  text: string; facts: number; deliverables: number; messages: number; short: boolean;
  /** unutulan kayıtların DIŞINDAKİ etki (varsayılan seçim yalnız total = 0 olanları işaretler)*/
  outside?: { facts: number; deliverables: number; messages: number; total: number; episodes?: number };
  snippets: { type: string; before: string; match: string; after: string }[];
  /** terim işaretsiz kalırsa hedefin kendi kayıtlarında karartılacak kopya sayısı*/
  inside_copies?: number;
}

/** önizlemedeki kayıt (etiket maskelidir: terim •••) — bağlantı için tür/kimlik/koşu*/
export interface ForgetRecord {
  type: "Fact" | "Deliverable" | "Message" | "Episode" | string; id: string; label?: string;
  run_id?: string | null; origin?: "user" | "run";
}

/** terimin okunur kalacağı (uygulamadan sonra: kalan) kayıtlar. uygulama yanıtında doğrulama
 * taramasından gelir (bütün kayıt türleri); `kind: "sentence"` hedef cümlenin kendisidir (metin boş).*/
export interface ForgetRemain {
  text: string; kind: ForgetToken["kind"] | "sentence"; held: boolean; selected: boolean; scoped: boolean; kwonly: boolean;
  facts_user: number; facts_run: number; deliverables: number; messages: number; episodes: number;
  concepts?: number; steps?: number; runs?: number; other?: number; run_events?: number; event_log?: number;
  sse?: number; tool_outputs?: number; fts?: number;
  inside: number; total: number; records: ForgetRecord[];
  /** kısa sayının anahtar sözcüksüz (başka anlamda) geçtiği, korunan kayıt sayısı*/
  plain?: number;
}

/** ayraçla birleşik (tam yazım dışı) eşleşme. `outcome` uygulamanın kararı — "redact" (aralık
 * karartılır) ya da "delete" (karartmadan sonra 3 sözcükten az kalır: kayıt silinir)*/
export interface ForgetSeparatorMatch extends ForgetRecord { term: string; inside: boolean; outcome?: "redact" | "delete" }

/** sayısal terimin tutar gibi yazılmış geçişleri ("900.000 TL"); izin verilmedikçe dokunulmaz*/
export interface ForgetAmountMatch { term: string; total: number; records: ForgetRecord[]; allowed?: boolean }

/** başka bellek alanlarındaki kopya sayısı (içerik yok)*/
export interface ForgetOtherProjects { facts: number; deliverables: number; messages: number; total: number; projects: number }

export interface ForgetSampleNode { id: string; type: string; label: string }

export interface ForgetPlan {
  id: string; scope: ForgetScope; namespace: string;
  target: { id: string; type: string; label: string | null };
  counts: ForgetCounts;
  samples: {
    nodes: ForgetSampleNode[]; checkpoints: ForgetSampleNode[]; summaries: ForgetSampleNode[];
    derived: ForgetSampleNode[]; active_runs: { id: string; title: string }[];
    running?: { id: string; title: string; status: string }[];
    run_events: { run_id: string; seq: number; type: string }[];
    event_log: { seq: number; type: string | null; run_id: string | null }[];
    booster_rows: { run_id: string; step_id: string }[];
    metrics_rows: { event_id: string; event_type: string; run_id: string | null }[];
    edges: { id: string; type: string; src: string; dst: string }[];
  };
  mark: string; expires_in_s: number; undo_window_s: number;
  tokens?: ForgetToken[];
  /** jeton etkisi, reddedilen (çok kısa) terimler, kısa terim eşiği ve en kısa kabul edilen terim*/
  token_impact?: ForgetTokenImpact[]; rejected_terms?: string[]; short_term?: number; min_term?: number;
  /** okunur kalacaklar, ayraçlı eşleşmeler, başka alanlardaki kopyalar, içeride karartılan / dokunulmayan terimler*/
  remains?: ForgetRemain[]; separator_matches?: ForgetSeparatorMatch[]; other_projects?: ForgetOtherProjects;
  scoped_terms?: string[]; unscoped_terms?: string[]; keyword_only_terms?: string[]; loose_min?: number;
  /** tutar biçimli geçişler ve tutar biçimiyle de eşleşmesine izin verilen sayısal terimler*/
  amount_matches?: ForgetAmountMatch[]; amount_terms?: string[];
  /** `remains` uygulamanın doğrulama taramasının kuru çalıştırmasından (false: eski tahmin)*/
  remains_predicted?: boolean;
}

export interface ForgetEntry {
  id: string; ts: number; scope: ForgetScope; namespace: string; target: string; target_type: string;
  counts: ForgetCounts; noted_runs: string[]; undo_until: number; undone: boolean; can_undo?: boolean;
  /** (yalnız uygulama yanıtı; geçmişe yazılmaz): hâlâ okunur kalanlar (etiketsiz) ve dürüst sonuç metni*/
  remains?: ForgetRemain[]; other_projects?: ForgetOtherProjects; message?: { tr: string; en: string };
  /** sonuç uygulamadan sonraki doğrulama taramasından geldi (false: tarama tamamlanamadı)*/
  verified?: boolean;
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "X-Studio-Lang": currentLocale(), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = bodyText(res.status, null);
    try {
      const j = await res.json();
      msg = bodyText(res.status, j);
    } catch { /* gövde yok */ }
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

export const forgetApi = {
  plan: (scope: ForgetScope, target: { id?: string; project?: string | null },
         opts: { tokens?: string[]; extraTerms?: string[]; unscoped?: string[]; amounts?: string[] } = {}) =>
    req<ForgetPlan>("POST", "/api/memory/forget/plan", {
      scope, ...(target.id ? { id: target.id } : {}), ...(target.project ? { project: target.project } : {}),
      ...(opts.tokens ? { tokens: opts.tokens } : {}), ...(opts.extraTerms?.length ? { extra_terms: opts.extraTerms } : {}),
      ...(opts.unscoped?.length ? { unscoped: opts.unscoped } : {}),
      ...(opts.amounts?.length ? { amounts: opts.amounts } : {}) }),
  apply: (planId: string, opts: { stopRuns?: boolean } = {}) =>
    req<ForgetEntry>("POST", `/api/memory/forget/plans/${encodeURIComponent(planId)}/apply`,
      { confirm: true, ...(opts.stopRuns ? { stop_runs: true } : {}) }),
  undo: (changeId: string) =>
    req<ForgetEntry>("POST", `/api/memory/forget/${encodeURIComponent(changeId)}/undo`, { confirm: true }),
  history: () => req<{ items: ForgetEntry[]; undo_window_s: number }>("GET", "/api/memory/forget/history"),
};
