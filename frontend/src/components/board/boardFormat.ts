// DASH-MVP — Pano metin biçimleri: dolar, yüzde, süre ("14 dk'dır bekliyor"), maliyet tabanı, neden. Kodlar
// decisionModel'den, metinler locales/board.ts'ten. Sayılar dile göre (tr: "$0,84", "%90").
// PANO-FIX model birimi her yerde birimiyle yazılır ("18.000 / 20.000 token"); "jeton" oyun parasıdır.
import { fmtNumber, fmtPercent, intlTag, tx } from "../../lib/i18n";
import { boardMsg } from "../../locales/board";
import { waitParts, type CostCode, type WhyCode } from "./decisionModel";

export function usd(n: number): string {
  const small = n > 0 && n < 0.01;
  return fmtNumber(n, { style: "currency", currency: "USD", minimumFractionDigits: small ? 4 : 2, maximumFractionDigits: small ? 4 : 2 });
}

export const pct = (p: number) => fmtPercent(Math.round(p));

/** "14 dk", "2 sa 5 dk", "3 gün" (özet ve KPI: "en eskisi … önce"). */
export function ageText(ms: number): string {
  const w = waitParts(ms);
  switch (w.unit) {
    case "now": return tx(boardMsg, "age_now");
    case "min": return tx(boardMsg, "age_min", { n: w.n });
    case "hm": return tx(boardMsg, "age_hm", { h: w.h, m: w.m });
    case "h": return tx(boardMsg, "age_h", { h: w.h });
    case "d": return tx(boardMsg, "age_d", { d: w.d });
  }
}

/** "14 dk'dır bekliyor" / "waiting 14 min". */
export function waitText(ms: number): string {
  const w = waitParts(ms);
  switch (w.unit) {
    case "now": return tx(boardMsg, "wait_now");
    case "min": return tx(boardMsg, "wait_min", { n: w.n });
    case "hm": return tx(boardMsg, "wait_hm", { h: w.h, m: w.m });
    case "h": return tx(boardMsg, "wait_h", { h: w.h });
    case "d": return tx(boardMsg, "wait_d", { d: w.d });
  }
}

export function costText(c: CostCode): string {
  switch (c.key) {
    case "sub": return tx(boardMsg, "cost_sub");
    case "local": return tx(boardMsg, "cost_local");
    case "unknown": return tx(boardMsg, "cost_unknown");
    case "spent": return tx(boardMsg, "cost_spent", { usd: usd(c.usd) });
    case "est": return tx(boardMsg, "cost_est", { usd: usd(c.usd) });
    case "mixed": return tx(boardMsg, "cost_mixed", { usd: usd(c.usd) });
  }
}

/** Tek değer: "$0,45" ya da "18.000 token". */
export function metricText(metric: "cost_usd" | "tokens", v: number): string {
  return metric === "cost_usd" ? usd(v) : tx(boardMsg, "tokens_n", { n: fmtNumber(Math.round(v)) });
}

/** Değer / tavan: "$0,45 / $0,50" ya da "18.000 / 20.000 token" (birim bir kez). */
export function metricPair(metric: "cost_usd" | "tokens", used: number, cap: number): string {
  return metric === "cost_usd" ? `${usd(used)} / ${usd(cap)}`
    : tx(boardMsg, "tokens_pair", { used: fmtNumber(Math.round(used)), cap: fmtNumber(Math.round(cap)) });
}

export function whyText(w: WhyCode): string {
  switch (w.key) {
    case "plan": return tx(boardMsg, "why_plan");
    case "gate": return tx(boardMsg, "why_gate");
    case "step": return tx(boardMsg, "why_step");
    case "budget_plain": return tx(boardMsg, "why_budget_plain");
    case "tool_plain": return tx(boardMsg, "why_tool_plain");
    case "unknown": return tx(boardMsg, "why_unknown");
    case "message": return tx(boardMsg, "why_message");
    case "budget": return tx(boardMsg, "why_budget", { pair: metricPair(w.metric, w.used, w.cap), pct: pct(w.pct) });
    case "budget_over": return tx(boardMsg, "why_budget_over", { pair: metricPair(w.metric, w.used, w.cap) });
    case "tool": return tx(boardMsg, "why_tool", { tool: w.tool });
    case "accept": return tx(boardMsg, w.status === "passed" ? "why_accept_passed" : w.status === "failed" ? "why_accept_failed" : "why_accept_not_run");
    case "paused": return tx(boardMsg, `why_paused_${w.reason}` as "why_paused_user");
  }
}

/** sunucunun ajan etkinlik metni ("Sırada (ollama)") arayüz dilinde; bilinmeyen metin olduğu gibi.*/
export function activityText(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  const q = /^(?:sırada|queued)\s*(?:\((.+)\))?$/i.exec(s);
  if (q) return q[1] ? tx(boardMsg, "act_queued_on", { brain: q[1] }) : tx(boardMsg, "act_queued");
  return s;
}

/** Saat "17:30" (yerel). */
export function clock(t: number | Date): string {
  return new Date(t).toLocaleTimeString(intlTag(), { hour: "2-digit", minute: "2-digit" });
}
