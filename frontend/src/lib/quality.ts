// CG-QUALITY — kalite kapısı istemcisi + rozet mantığı (saf; içe aktarma yok → node --test ile doğrudan sınanır).
// REST: GET /api/quality/deliverables/{id} · GET …/reviewer (beyin + CG-COST maliyeti) · POST …/assess {reviewer?, run_check?}
// · POST …/accept {reason?} · POST …/accept/revoke · POST …/findings/{fid} {false_positive} · POST …/revise {note?}
// (yazma uçları yalnızca kullanıcıdan; MCP 403). Canlı: `deliverable.quality {id, run_id, quality}`.
// Kişisel veri bulguları yalnızca İŞARETTİR: çıktı otomatik maskelenmez (LOGIC-AUDIT) — arayüz bunu iddia etmez.

export type QualityStatus = "passed" | "warn" | "failed";
export type Severity = "info" | "warn" | "error";
export type QLang = "tr" | "en";

export interface QualityBadgeData {
  score: number; status: QualityStatus; summary?: string;
  headline?: { label: string; count: number; key?: string | null } | null;
  counts?: Record<string, number>; accepted_anyway?: boolean; reviewer?: string | null; report_id?: string | null;
}

export interface QualityFinding {
  id: string; check: string; severity: Severity; code: string; message: string; source?: "check" | "reviewer";
  location?: { line?: number | null; excerpt?: string | null } | null; params?: Record<string, unknown>;
  false_positive?: boolean;
}

export interface QualityCheck { id: string; status: "passed" | "failed" | "skipped"; detail?: string; findings?: number }

export interface ReviewerInfo {
  status: "running" | "done" | "error"; score?: number; notes?: string; brain?: string; model?: string | null;
  label?: string; error?: string; estimate?: { money?: unknown; minutes?: unknown } | null;
}

export interface QualityReport {
  id: string; deliverable_id: string; run_id?: string | null; score: number; deterministic_score: number;
  status: QualityStatus; passed: boolean; summary: string; checks: QualityCheck[]; findings: QualityFinding[];
  issues: QualityFinding[]; counts: Record<string, number>; reviewer: ReviewerInfo | null;
  spec?: Record<string, unknown>; accepted_anyway: boolean; accept_reason?: string | null; accepted_at?: string | null;
  revision_run_id?: string | null; created_at?: string | null; gate?: { internal: GateMode; external: GateMode };
  badge?: QualityBadgeData;
}

export type GateMode = "off" | "warn" | "block";

export interface ReviewerPlan {
  brain: string; model: string | null; label: string; local: boolean;
  estimate: { money?: { kind: string; usd: { low: number; high: number } | null; kinds: string[] } | null;
    minutes?: { low: number; high: number } | null } | null;
}

// ---------------------------------------------------------------- saf rozet mantığı
const HEAD: Record<string, { tr: string; en: [string, string] }> = {
  unsourced_claim: { tr: "kaynaksız iddia", en: ["unsourced claim", "unsourced claims"] },
  missing_section: { tr: "eksik bölüm", en: ["missing section", "missing sections"] },
  placeholder: { tr: "yer tutucu", en: ["placeholder", "placeholders"] },
  empty: { tr: "boş çıktı", en: ["empty output", "empty outputs"] },
  pii: { tr: "olası kişisel veri", en: ["possible personal data", "possible personal data"] },
  malformed_link: { tr: "bozuk bağlantı", en: ["broken link", "broken links"] },
  empty_link: { tr: "bozuk bağlantı", en: ["broken link", "broken links"] },
  undefined_ref: { tr: "bozuk bağlantı", en: ["broken link", "broken links"] },
  too_short: { tr: "uzunluk sorunu", en: ["length issue", "length issues"] },
  too_long: { tr: "uzunluk sorunu", en: ["length issue", "length issues"] },
};

/** "8" · "7,5" (TR) · "7.5" (EN) — en çok bir ondalık. */
export function fmtScore(score: number | null | undefined, lang: QLang = "tr"): string {
  if (score == null || Number.isNaN(score)) return "–";
  const r = Math.round(score * 10) / 10;
  const s = Number.isInteger(r) ? String(r) : r.toFixed(1);
  return lang === "tr" ? s.replace(".", ",") : s;
}

/** "2 kaynaksız iddia" · "1 unsourced claim" — yoksa null. */
export function headlineText(q: Pick<QualityBadgeData, "headline"> | null | undefined, lang: QLang = "tr"): string | null {
  const h = q?.headline;
  if (!h || !h.count) return null;
  const known = h.key ? HEAD[h.key] : undefined;
  if (lang === "en") {
    const en = known?.en ?? Object.values(HEAD).find((v) => v.tr === h.label)?.en;
    return `${h.count} ${en ? en[h.count === 1 ? 0 : 1] : h.label}`;
  }
  return `${h.count} ${known?.tr ?? h.label}`;
}

/** Rozet metni: "Kalite 8/10 · 2 kaynaksız iddia" (dil arayüzden; sunucu özeti TR'dir). */
export function badgeText(q: QualityBadgeData | null | undefined, lang: QLang = "tr"): string {
  if (!q) return "";
  const head = `${lang === "en" ? "Quality" : "Kalite"} ${fmtScore(q.score, lang)}/10`;
  const extra = headlineText(q, lang);
  return extra ? `${head} · ${extra}` : head;
}

/** Ton: kabul edildiyse bilgi; yoksa durumdan (başarısız → kötü, uyarı → uyarı, geçti → iyi). */
export function qualityTone(q: Pick<QualityBadgeData, "status" | "accepted_anyway"> | null | undefined): "ok" | "warn" | "bad" | "info" | "muted" {
  if (!q) return "muted";
  if (q.accepted_anyway) return "info";
  return q.status === "failed" ? "bad" : q.status === "warn" ? "warn" : "ok";
}

const SEV_RANK: Record<Severity, number> = { error: 0, warn: 1, info: 2 };

/** Liste sırası: açık bulgular önce (hata → uyarı → bilgi, sonra satır), yanlış-pozitifler en sonda. */
export function sortFindings(list: QualityFinding[]): QualityFinding[] {
  return [...list].sort((a, b) =>
    Number(!!a.false_positive) - Number(!!b.false_positive)
    || SEV_RANK[a.severity] - SEV_RANK[b.severity]
    || (a.location?.line ?? 1e9) - (b.location?.line ?? 1e9)
    || a.id.localeCompare(b.id));
}

/** Dış hedefe teslim engellenir mi (CG-DELIVER aynı kuralı sunucuda uygular; burada yalnızca ipucu). */
export function wouldBlock(r: Pick<QualityReport, "status" | "accepted_anyway"> | null | undefined, mode: GateMode): boolean {
  return !!r && mode === "block" && r.status === "failed" && !r.accepted_anyway;
}

/** Revizyon isteğine girecek bulgu sayısı (açık olanlar). */
export function openCount(r: Pick<QualityReport, "findings"> | null | undefined): number {
  return (r?.findings ?? []).filter((f) => !f.false_positive).length;
}

const EN_FINDING: Record<string, (p: Record<string, unknown>) => string> = {
  missing_section: (p) => `Required section missing: ${String(p.section ?? "")}`,
  placeholder: (p) => `Placeholder text: ${String(p.token ?? "")}`,
  empty: () => "The output is empty",
  empty_section: (p) => `Empty section: ${String(p.section ?? "")}`,
  unsourced_claim: (p) => p.reason === "attribution" ? "Unsourced claim: attribution without a source"
    : "Unsourced claim: number/date without a source",
  pii: (p) => `Possible personal data (${String(p.kind ?? "")})`,
  malformed_link: (p) => `Broken link: ${String(p.url ?? "")}`,
  empty_link: () => "Link address is empty",
  unsafe_link: () => "Unsafe link scheme",
  undefined_ref: () => "Undefined link reference",
  too_short: (p) => `Too short: ${String(p.got)} ${p.unit === "words" ? "words" : "characters"} (min ${String(p.min)})`,
  too_long: (p) => `Too long: ${String(p.got)} ${p.unit === "words" ? "words" : "characters"} (max ${String(p.max)})`,
  unclosed_fence: () => "Code block is not closed (```)",
  table_columns: (p) => `Table row has ${String(p.got)} columns, header has ${String(p.want)}`,
  heading_jump: (p) => `Heading level skipped (H${String(p.from)} → H${String(p.to)})`,
  missing_owner: () => "No owner line",
  missing_date: () => "No date",
};

/** Bulgu metni: TR sunucunun iletisi; EN koddan ve parametrelerden (bilinmeyen kodda sunucu iletisi). */
export function findingText(f: Pick<QualityFinding, "code" | "message" | "params" | "source">, lang: QLang = "tr"): string {
  if (lang !== "en" || f.source === "reviewer") return f.message;
  const fn = EN_FINDING[f.code];
  return fn ? fn(f.params ?? {}) : f.message;
}

// ---------------------------------------------------------------- API
async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const lang = typeof document !== "undefined" && document.documentElement.lang?.startsWith("en") ? "en" : "tr";
  const res = await fetch(url, {
    method,
    headers: { "X-Studio-Lang": lang, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      // okunur ileti, asla ham JSON (bu dosya içe aktarmasız kalır: node testi doğrudan yükler)
      const d = j?.detail;
      msg = typeof d === "string" ? d : typeof d?.message === "string" ? d.message
        : lang === "en" ? `The request could not be completed (${res.status}).` : `İstek tamamlanamadı (${res.status}).`;
    } catch { /* gövde yok */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

const base = (id: string) => `/api/quality/deliverables/${encodeURIComponent(id)}`;

/** FOLLOWUP: kalite kapısı ayarları (PUT yalnızca kullanıcıdan; MCP 403). */
export interface QualitySettings {
  enabled: boolean; gate: GateMode; gate_external: GateMode; block_on_fail: boolean;
  reviewer: { enabled?: boolean; brain?: string; model?: string };
}

export const qualityApi = {
  settings: () => req<QualitySettings>("GET", "/api/quality/settings"),
  saveSettings: (patch: { block_on_fail?: boolean; reviewer?: boolean }) => req<QualitySettings>("PUT", "/api/quality/settings", patch),
  get: (id: string) => req<{ report: QualityReport | null; gate: { internal: GateMode; external: GateMode } }>("GET", base(id)),
  reviewerPlan: (id: string) => req<ReviewerPlan>("GET", `${base(id)}/reviewer`),
  assess: (id: string, opts: { reviewer?: boolean; run_check?: boolean } = {}) =>
    req<{ ok: boolean; report: QualityReport }>("POST", `${base(id)}/assess`, opts),
  accept: (id: string, reason: string) => req<{ ok: boolean; report: QualityReport }>("POST", `${base(id)}/accept`, { reason }),
  revoke: (id: string) => req<{ ok: boolean; report: QualityReport }>("POST", `${base(id)}/accept/revoke`, {}),
  falsePositive: (id: string, fid: string, value: boolean) =>
    req<{ ok: boolean; report: QualityReport }>("POST", `${base(id)}/findings/${encodeURIComponent(fid)}`, { false_positive: value }),
  revise: (id: string, note = "") =>
    req<{ ok: boolean; run_id: string; forked_from: string; step_id: string }>("POST", `${base(id)}/revise`, { note }),
};
