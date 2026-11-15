// "Unut" önizleme penceresi: plan (sayılar + örnekler) → onay → uygula → geri al.
// Plan hiçbir şey yazmaz; onay sunucuda yedek alır, türevleri karartır ve mezar kaydı bırakır.
// plan ayırt edici jetonları (kod, sayı, e-posta…) listeler; kullanıcı işaret kaldırır / terim ekler, plan
// seçimle yeniden hesaplanır. kapsamda süren koşu varsa onay kapalıdır; "durdur ve unut" yalnız kullanıcıdan.
// işaretsiz terim hedefin kendi kayıtlarında yine de karartılır (kullanıcı kapatabilir); okunur KALACAK kayıtlar
// bağlantılarıyla listelenir (plan ve sonuç), ayraçla eşleşenler ayrı başlıkta, yalnız bu bellek alanının etkilendiği ve
// başka alanlardaki kopya sayısı söylenir. Sonuç metni bir şey okunur kaldıysa yalnız "N düğüm silindi" demez.
// sonuç uygulamadan sonraki doğrulama taramasından gelir (kavram adı dahil bütün kayıt türleri); ayraçlı her
// eşleşmede uygulamanın kararı ("aralık karartılır" / "kayıt silinir") yazar; tutar gibi yazılmış sayılara kullanıcı
// açıkça izin vermedikçe dokunulmaz; geri alma sonucu başarı tonunda gösterilir ve eski sonuç bloğu kalkar.
// "okunur kalacaklar" önizlemesi uygulamanın doğrulama taramasının kuru çalıştırmasıdır (sonuçla aynı sayılar);
// kayıt türü okunur adla, kavram iç kimliği yerine adıyla; başka alan sayısı kendi çoğuluyla yazılır.
import { Plus, RotateCcw, Square, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Checkbox, Modal, Spinner } from "../ui";
import { ApiError } from "../../lib/api";
import {
  forgetApi, type ForgetEntry, type ForgetOtherProjects, type ForgetPlan, type ForgetRecord, type ForgetRemain,
  type ForgetScope, type ForgetToken,
} from "../../lib/forget";
import { tp, useT } from "../../lib/i18n";
import { nsLabel } from "../../lib/memory";
import { forgetMsg } from "../../locales/forget";

type Row = { key: keyof ForgetPlan["counts"]; label: keyof (typeof forgetMsg)["tr"]; tone?: "keep" | "warn" };
const ROWS: Row[] = [
  { key: "nodes", label: "row_nodes" },
  { key: "sibling_facts", label: "row_siblings", tone: "warn" },  // aynı cümleyi içeren kardeş bilgiler
  { key: "token_facts", label: "row_token_facts", tone: "warn" },  // seçili jetonu taşıyan bilgiler
  { key: "edges", label: "row_edges" }, { key: "fts_rows", label: "row_fts" },
  { key: "checkpoints", label: "row_checkpoints" }, { key: "summaries", label: "row_summaries" },
  { key: "derived", label: "row_derived" }, { key: "run_events", label: "row_run_events" },
  { key: "event_log", label: "row_event_log" }, { key: "concepts_unlinked", label: "row_concepts" },
  { key: "booster_rows", label: "row_booster", tone: "keep" }, { key: "metrics_rows", label: "row_metrics" },
  { key: "active_runs", label: "row_active", tone: "warn" },
  { key: "running", label: "row_running", tone: "warn" },
  { key: "hermes_memory", label: "row_hermes", tone: "warn" },  // değiştirilmez, kullanıcıya söylenir
];
const KIND_LABEL: Record<ForgetToken["kind"], keyof (typeof forgetMsg)["tr"]> = {
  code: "token_kind_code", number: "token_kind_number", random: "token_kind_random", email: "token_kind_email",
  handle: "token_kind_handle", name: "token_kind_name", custom: "token_kind_custom",
  pin: "token_kind_pin", card: "token_kind_card", iban: "token_kind_iban", phone: "token_kind_phone", plate: "token_kind_plate",
};
const STATUS_LABEL: Record<string, keyof (typeof forgetMsg)["tr"]> = {
  running: "status_running", paused: "status_paused", pending: "status_pending",
  awaiting_approval: "status_awaiting", interrupted: "status_interrupted",
};
/** sunucunun kanonik biçimine yakın istemci denetimi (harf/rakam sayısı) — çok kısa terim sessizce düşmez*/
const termLen = (v: string) => (v.match(/[\p{L}\p{N}]/gu) ?? []).length;

/** sayılar dil kurallarıyla (EN tekil/çoğul), virgülle*/
function countParts(c: { facts?: number; deliverables?: number; messages?: number }): string {
  return [tp(forgetMsg, "n_facts", c.facts ?? 0), tp(forgetMsg, "n_outputs", c.deliverables ?? 0),
    tp(forgetMsg, "n_messages", c.messages ?? 0)].join(", ");
}
const REM_KEYS = ["facts_user", "facts_run", "deliverables", "messages", "episodes", "concepts", "steps", "runs",
  "other", "run_events", "event_log", "sse", "tool_outputs", "fts", "inside"] as const;
function remParts(r: ForgetRemain): string {
  return REM_KEYS.filter((k) => (r[k] ?? 0) > 0).map((k) => tp(forgetMsg, `rem_${k}`, r[k] ?? 0)).join(", ");
}
/** Kayıt bağlantısı: çıktı → çıktılar sayfası, mesaj/anı → koşu, bilgi → bellek grafında odak */
function recHref(r: ForgetRecord, ns: string): string {
  if (r.type === "Deliverable") return `/ciktilar/${encodeURIComponent(r.id)}`;
  if ((r.type === "Message" || r.type === "Episode") && r.run_id) return `/gorevler/${encodeURIComponent(r.run_id)}`;
  return `/bellek?focus=${encodeURIComponent(r.id)}&proje=${encodeURIComponent(ns)}`;
}

const REC_TYPES = new Set(["Fact", "Deliverable", "Message", "Episode", "Concept", "Step", "Run"]);
/** önizlemenin maskeli etiketi ("•••") okunur değil; kavramın adı terimin kendisidir (satırda zaten yazılı)*/
const maskOnly = (s: string) => !s.replace(/•••/g, "").trim();

function RecordList({ records, total, ns, labels, term, onNavigate }: {
  records: ForgetRecord[]; total: number; ns: string; labels: Map<string, string>; term?: string;
  onNavigate: () => void;
}) {
  const t = useT(forgetMsg);
  if (!records.length) return null;
  // tür okunur adla; kavram iç kimlikle (con_…) değil adıyla gösterilir (etiketler yalnız arayüzde)
  const name = (r: ForgetRecord): string => {
    const label = r.label || labels.get(r.id) || "";
    if (r.type === "Concept" && term && (!label || maskOnly(label))) return `“${term}”`;
    return label || r.id;
  };
  return (
    <ul className="flex flex-col gap-0.5 pl-3 text-xs">
      {records.map((r) => (
        <li key={`${r.type}:${r.id}`} className="break-words">
          <span className="text-muted">{t(REC_TYPES.has(r.type) ? `rec_type_${r.type}` as "rec_type_Fact" : "rec_type_other")}</span>{" "}
          {r.origin === "user" && <span className="text-muted">({t("rec_user")}) </span>}
          <Link to={recHref(r, ns)} onClick={onNavigate} className="underline underline-offset-2">
            {name(r)}
          </Link>
        </li>
      ))}
      {total > records.length && <li className="text-muted">{tp(forgetMsg, "rem_more", total - records.length)}</li>}
    </ul>
  );
}

function Remains({ items, ns, labels, title, onNavigate }: {
  items: ForgetRemain[]; ns: string; labels: Map<string, string>; title: string; onNavigate: () => void;
}) {
  const t = useT(forgetMsg);
  if (!items.length) return null;
  return (
    <div role="status" className="panel-soft px-2.5 py-1.5 flex flex-col gap-1">
      <p className="font-semibold text-warn">{title}</p>
      {items.map((r) => (
        <div key={`${r.kind}:${r.text}`} className="flex flex-col gap-0.5">
          {r.total > 0 && (
            <p className="text-ink-2 break-words">
              {r.kind === "sentence" ? t("remains_sentence", { parts: remParts(r) })
                : t("remains_line", { term: r.text, parts: remParts(r) })}
            </p>
          )}
          <RecordList records={r.records} total={r.total - r.inside} ns={ns} labels={labels}
            term={r.kind === "sentence" ? undefined : r.text} onNavigate={onNavigate} />
          {(r.plain ?? 0) > 0 && (
            <p className="text-xs text-muted break-words">{tp(forgetMsg, "remains_plain", r.plain ?? 0, { term: r.text })}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function OtherCopies({ other }: { other?: ForgetOtherProjects }) {
  if (!other || !other.total) return null;
  // alan sayısı kendi çoğuluyla ("1 space" / "2 spaces"; TR "1 alan")
  const spaces = tp(forgetMsg, "n_spaces", other.projects);
  return <p className="text-xs text-warn break-words">{tp(forgetMsg, "other_copies", other.total, { k: other.projects, spaces })}</p>;
}

export function ForgetDialog({ open, onClose, scope, id, project, name, onDone }: {
  open: boolean; onClose: () => void; scope: ForgetScope; id?: string; project?: string | null; name?: string;
  onDone: () => void;
}) {
  const t = useT(forgetMsg);
  const [plan, setPlan] = useState<ForgetPlan | null>(null);
  const [entry, setEntry] = useState<ForgetEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [replanning, setReplanning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const [unscoped, setUnscoped] = useState<string[]>([]);  // hedefin kayıtlarında da karartılmasın
  const [amounts, setAmounts] = useState<string[]>([]);  // tutar gibi yazılmış hâli de karartılsın
  const [notice, setNotice] = useState<string | null>(null);  // başarı bildirimi (geri alındı)
  const seq = useRef(0);
  const fail = (e: unknown) => setMsg(t("failed", { msg: e instanceof ApiError || e instanceof Error ? e.message : String(e) }));

  // seçim değişince plan yeniden hesaplanır (en son istek kazanır)
  const replan = (tokens: string[] | undefined, extraTerms: string[] = [], keep: string[] = unscoped,
    amts: string[] = amounts) => {
    const n = ++seq.current;
    setReplanning(true); setMsg(null);
    forgetApi.plan(scope, { id, project }, { tokens, extraTerms, unscoped: keep, amounts: amts })
      .then((p) => { if (seq.current === n) setPlan(p); })
      .catch((e) => { if (seq.current === n) fail(e); })
      .finally(() => { if (seq.current === n) setReplanning(false); });
  };

  useEffect(() => {
    if (!open) return;
    setPlan(null); setEntry(null); setMsg(null); setNotice(null); setTerm(""); setUnscoped([]); setAmounts([]);
    replan(undefined, [], [], []);
    return () => { seq.current++; };
  }, [open, scope, id, project]); // eslint-disable-line react-hooks/exhaustive-deps

  const tokens = plan?.tokens ?? [];
  const selected = tokens.filter((x) => x.selected).map((x) => x.text);
  const toggle = (tok: ForgetToken) =>
    replan(tok.selected ? selected.filter((x) => x !== tok.text) : [...selected, tok.text]);
  const minTerm = plan?.min_term ?? 2;
  const addTerm = () => {
    const v = term.trim();
    if (!v) return;
    if (termLen(v) < minTerm) {  // kısa terim için açık geri bildirim
      setMsg(t("term_too_short", { n: minTerm }));
      return;
    }
    setTerm("");
    replan(selected, [v]);
  };
  const impact = new Map((plan?.token_impact ?? []).map((x) => [x.text, x]));
  const rejected = plan?.rejected_terms ?? [];
  const running = plan?.samples.running ?? [];
  const kwonly = new Set(plan?.keyword_only_terms ?? []);
  const off = new Set(plan?.unscoped_terms ?? []);
  // sonuçta etiketler önizlemeden eşlenir (uygulama yanıtı içerik taşımaz)
  const labels = new Map<string, string>();
  for (const r of plan?.remains ?? []) for (const x of r.records) if (x.label) labels.set(x.id, x.label);
  for (const x of plan?.separator_matches ?? []) if (x.label) labels.set(x.id, x.label);
  const toggleScoped = (text: string, on: boolean) => {
    const next = on ? unscoped.filter((x) => x !== text) : [...unscoped, text];
    setUnscoped(next);
    replan(selected, [], next);
  };
  const toggleAmount = (text: string, on: boolean) => {  // açık izin
    const next = on ? [...amounts.filter((x) => x !== text), text] : amounts.filter((x) => x !== text);
    setAmounts(next);
    replan(selected, [], unscoped, next);
  };
  const amountMatches = plan?.amount_matches ?? [];

  const confirm = async (stopRuns = false) => {
    if (!plan) return;
    setBusy(true); setMsg(null);
    try {
      setEntry(await forgetApi.apply(plan.id, { stopRuns }));
      onDone();
    } catch (e) {
      fail(e);
      if (e instanceof ApiError && e.status === 409) replan(selected);  // süren koşular planda görünsün
    } finally { setBusy(false); }
  };
  const undo = async () => {
    if (!entry) return;
    setBusy(true); setMsg(null);
    try {
      const res = await forgetApi.undo(entry.id) as ForgetEntry & { restored?: { nodes?: number } };
      // başarı tonu; eski "unutuldu / okunur kalanlar" bloğu kalkar (artık geçerli değil)
      setNotice(tp(forgetMsg, "undone", res.restored?.nodes ?? 0));
      setEntry({ ...entry, undone: true, remains: [], other_projects: undefined });
      onDone();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const title = scope === "fact" ? t("title_fact") : scope === "episode" ? t("title_episode")
    : t("title_project", { name: name ?? project ?? "" });
  const hours = Math.round((plan?.undo_window_s ?? 86400) / 3600);
  const footer = entry ? (
    <>
      {!entry.undone && <Button icon={<RotateCcw size={14} />} onClick={undo} disabled={busy}>{t("undo")}</Button>}
      <Button variant="primary" onClick={onClose}>{t("close")}</Button>
    </>
  ) : (
    <>
      <Button onClick={onClose} disabled={busy}>{t("cancel")}</Button>
      {running.length > 0 ? (
        <Button variant="danger" icon={<Square size={14} />} onClick={() => confirm(true)}
          disabled={!plan || busy || replanning}>{t("stop_and_forget")}</Button>
      ) : (
        <Button variant="danger" icon={<Trash2 size={14} />} onClick={() => confirm(false)}
          disabled={!plan || busy || replanning}>{t("confirm")}</Button>
      )}
    </>
  );

  return (
    <Modal open={open} onClose={onClose} title={title} width={620} footer={footer}>
      <div className="flex flex-col gap-3 text-sm" aria-live="polite">
        {msg && <p role="alert" className="text-bad break-words">{msg}</p>}
        {notice && <p role="status" className="text-ok font-semibold break-words">{notice}</p>}
        {entry?.undone ? null : entry ? (
          <div className="flex flex-col gap-1.5">
            <p className="font-semibold">{t("done_title")}</p>
            <p className="text-ink-2">{tp(forgetMsg, "done_text", entry.counts.nodes)}</p>
            <Remains items={entry.remains ?? []} ns={entry.namespace} labels={labels} title={t("remains_after_title")}
              onNavigate={onClose} />
            {entry.verified === false && <p role="alert" className="text-warn break-words">{t("done_unverified")}</p>}
            {(entry.counts.vault_unscanned ?? 0) > 0 && (
              <p role="status" className="text-warn break-words">{t("done_unscanned", { n: entry.counts.vault_unscanned ?? 0 })}</p>
            )}
            {entry.verified !== false && !(entry.remains ?? []).some((r) => r.total > 0 || (r.plain ?? 0) > 0)
              && !(entry.other_projects?.total) && !(entry.counts.vault_unscanned) && (
              <p className="text-ink-2">{t("done_clean")}</p>
            )}
            <OtherCopies other={entry.other_projects} />
            {entry.noted_runs.length > 0 && <p className="text-ink-2">{t("done_noted", { n: entry.noted_runs.length })}</p>}
            {!entry.undone && <p className="text-xs text-muted">{t("undo_hint", { hours })}</p>}
          </div>
        ) : !plan ? (
          !msg && <div className="flex items-center gap-2 text-muted"><Spinner />{t("loading")}</div>
        ) : (
          <>
            <p className="text-ink-2">{t("intro")}</p>
            {plan.target.label && (
              <p className="panel-soft px-2.5 py-1.5 break-words"><span className="text-muted">{t("target")}: </span>{plan.target.label}</p>
            )}
            <p className="text-xs text-muted break-words">{t("scope_note", { ns: nsLabel(plan.namespace) })}</p>
            <OtherCopies other={plan.other_projects} />
            {running.length > 0 && (
              <div role="status" className="panel-soft px-2.5 py-1.5 flex flex-col gap-1">
                <p className="font-semibold text-warn">{t("running_title")}</p>
                <p className="text-ink-2">{t("running_text")}</p>
                <ul className="flex flex-col gap-0.5">
                  {running.map((r) => (
                    <li key={r.id} className="break-words"><span className="text-xs text-muted">{STATUS_LABEL[r.status] ? t(STATUS_LABEL[r.status]) : r.status}</span> {r.title || r.id}</li>
                  ))}
                </ul>
              </div>
            )}
            <fieldset className="panel-soft px-2.5 py-1.5 flex flex-col gap-1.5" aria-busy={replanning}>
              <legend className="font-semibold px-1">{t("tokens_title")}</legend>
              <p className="text-xs text-muted">{tokens.length ? t("tokens_hint") : t("tokens_none")}</p>
              {tokens.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {tokens.map((tok) => {
                    const imp = impact.get(tok.text);
                    return (
                      <li key={tok.text} className="flex flex-col gap-0.5">
                        <Checkbox checked={tok.selected} disabled={busy || replanning} onChange={() => toggle(tok)}
                          label={tok.text} labelClassName="font-mono text-xs break-all min-w-0">
                          <span className="text-xs text-muted shrink-0">{t(KIND_LABEL[tok.kind] ?? "token_kind_custom")}</span>
                        </Checkbox>
                        {imp && (
                          <div className="pl-6 flex flex-col gap-0.5 text-xs">
                            <span className={imp.short && tok.selected ? "text-warn" : "text-muted"}>
                              {t("token_impact", { parts: countParts(imp) })}
                              {imp.short && <> {t("token_short_warn")}</>}
                            </span>
                            {(imp.outside?.total ?? 0) > 0 && (
                              <span role={tok.selected ? "alert" : undefined} className="text-warn break-words">
                                {tp(forgetMsg, "token_outside", imp.outside!.total, { parts: countParts(imp.outside!) })}
                                {tok.held && !tok.selected && <> {t("token_held")}</>}
                              </span>
                            )}
                            {!tok.selected && tok.kind !== "name" && (imp.inside_copies ?? 0) > 0 && (
                              <Checkbox checked={!off.has(tok.text)} disabled={busy || replanning}
                                onChange={(v) => toggleScoped(tok.text, v)} label={t("token_scoped", { n: imp.inside_copies ?? 0 })}
                                labelClassName="text-xs" hint={t("token_scoped_hint")} className="flex-wrap" />
                            )}
                            {kwonly.has(tok.text) && !tok.selected && <span className="text-muted">{t("token_kwonly")}</span>}
                            {imp.snippets.length > 0 && (
                              <details>
                                <summary className="cursor-pointer text-muted">{t("token_snippets", { n: imp.snippets.length })}</summary>
                                <ul className="mt-0.5 flex flex-col gap-0.5">
                                  {imp.snippets.map((sn, i) => (
                                    <li key={i} className="break-words text-ink-2">
                                      <span className="text-muted">{sn.type}: </span>{sn.before} <mark className="font-semibold">{sn.match}</mark> {sn.after}
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              <form className="flex items-center gap-2 min-w-0" onSubmit={(e) => { e.preventDefault(); addTerm(); }}>
                <input className="input flex-1 min-w-0" value={term} maxLength={120} aria-label={t("add_term_label")}
                  placeholder={t("add_term_placeholder")} onChange={(e) => setTerm(e.target.value)} disabled={busy} />
                <Button type="submit" size="sm" icon={<Plus size={13} />} disabled={busy || replanning || !term.trim()}>
                  {t("add_term")}
                </Button>
                {term && (
                  <Button type="button" size="sm" icon={<X size={13} />} aria-label={t("cancel")} onClick={() => setTerm("")} />
                )}
              </form>
              {rejected.length > 0 && (
                <p role="alert" className="text-xs text-warn break-words">{t("terms_rejected", { terms: rejected.join(", "), n: minTerm })}</p>
              )}
              <p className="text-xs text-muted">{t("tokens_not_guessed")}</p>
              {replanning && <p className="flex items-center gap-2 text-xs text-muted"><Spinner />{t("replanning")}</p>}
            </fieldset>
            <Remains items={plan.remains ?? []} ns={plan.namespace} labels={labels} title={t("remains_title")}
              onNavigate={onClose} />
            {(plan.separator_matches ?? []).length > 0 && (
              <div className="panel-soft px-2.5 py-1.5 flex flex-col gap-1">
                <p className="font-semibold text-warn">{t("sep_title")}</p>
                <p className="text-xs text-ink-2">{t("sep_text")}</p>
                <ul className="flex flex-col gap-0.5 text-xs">
                  {(plan.separator_matches ?? []).map((x) => (
                    <li key={`${x.term}:${x.type}:${x.id}`} className="break-words">
                      <span className="font-mono">{x.term}</span>{" · "}
                      <span className="text-muted">{x.type} · {t(x.inside ? "sep_inside" : "sep_outside")}</span>{" · "}
                      <span className={x.outcome === "delete" ? "text-warn font-semibold" : "text-ink-2"}>
                        {t(x.outcome === "delete" ? "sep_delete" : "sep_redact")}
                      </span>{" "}
                      <Link to={recHref(x, plan.namespace)} onClick={onClose} className="underline underline-offset-2">
                        {x.label || x.id}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {amountMatches.length > 0 && (
              <div className="panel-soft px-2.5 py-1.5 flex flex-col gap-1">
                <p className="font-semibold">{t("amount_title")}</p>
                {amountMatches.map((a) => (
                  <div key={a.term} className="flex flex-col gap-0.5">
                    <p className="text-xs text-ink-2 break-words">{t("amount_text", { term: a.term })}</p>
                    <RecordList records={a.records} total={a.total} ns={plan.namespace} labels={labels} onNavigate={onClose} />
                    <Checkbox checked={amounts.includes(a.term) || !!a.allowed} disabled={busy || replanning}
                      onChange={(v) => toggleAmount(a.term, v)} label={t("amount_allow", { term: a.term, n: a.total })}
                      labelClassName="text-xs" hint={t("amount_allow_hint")} className="flex-wrap" />
                  </div>
                ))}
              </div>
            )}
            <table className="w-full text-dense">
              <tbody>
                {ROWS.map((r) => {
                  const n = plan.counts[r.key];
                  if (typeof n !== "number" || (n === 0 && r.key !== "nodes")) return null;
                  return (
                    <tr key={r.key} className="border-b border-line-soft">
                      <td className={r.tone === "keep" ? "py-1 pr-2 text-muted" : r.tone === "warn" ? "py-1 pr-2 text-warn" : "py-1 pr-2"}>{t(r.label)}</td>
                      <td className="py-1 text-right num font-semibold">{n}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {(plan.samples.nodes.length > 0 || plan.samples.summaries.length > 0 || plan.samples.active_runs.length > 0) && (
              <details className="panel-soft px-2.5 py-1.5">
                <summary className="cursor-pointer font-semibold">{t("samples")}</summary>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {[...plan.samples.nodes, ...plan.samples.summaries, ...plan.samples.checkpoints].map((n) => (
                    <li key={`${n.type}:${n.id}`} className="break-words"><span className="font-mono text-xs text-muted">{n.type}</span> {n.label}</li>
                  ))}
                  {plan.samples.active_runs.map((r) => (
                    <li key={`run:${r.id}`} className="break-words"><span className="font-mono text-xs text-muted">Run</span> {r.title || r.id}</li>
                  ))}
                </ul>
              </details>
            )}
            <p className="text-xs text-muted">{t("mark_hint", { mark: plan.mark })}</p>
            <p className="text-xs text-muted">{t("undo_hint", { hours })}</p>
            <p className="text-xs text-muted">{t("limits", { hours })}</p>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Geri alınabilir son unutmalar (sayfa yenilense de geri al düğmesi kaybolmaz). */
export function ForgetHistory({ refreshKey, onChanged }: { refreshKey: unknown; onChanged: () => void }) {
  const t = useT(forgetMsg);
  const [items, setItems] = useState<ForgetEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => forgetApi.history().then((r) => setItems(r.items.filter((e) => e.can_undo))).catch(() => undefined);
  useEffect(() => { load(); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!items.length && !msg) return null;
  const undo = async (e: ForgetEntry) => {
    setBusy(e.id); setMsg(null);
    try {
      const res = await forgetApi.undo(e.id) as ForgetEntry & { restored?: { nodes?: number } };
      setMsg(tp(forgetMsg, "undone", res.restored?.nodes ?? 0));
      onChanged();
    } catch (err) {
      setMsg(t("failed", { msg: err instanceof Error ? err.message : String(err) }));
    } finally { setBusy(null); await load(); }
  };
  return (
    <section className="flex flex-col gap-1.5" aria-label={t("history")}>
      <h3 className="font-display font-semibold text-sm">{t("history")}</h3>
      {msg && <p role="status" className="text-xs text-ink-2">{msg}</p>}
      <ul className="flex flex-col gap-1">
        {items.slice(0, 5).map((e) => (
          <li key={e.id} className="panel-soft px-2.5 py-1.5 flex items-center gap-2 text-xs">
            <span className="flex-1 min-w-0 truncate">
              {t(`scope_${e.scope}`)} · {tp(forgetMsg, "history_nodes", e.counts.nodes)}
              {e.scope === "project" ? ` · ${e.namespace.replace(/^project:/, "")}` : ""}
            </span>
            <Button size="sm" icon={<RotateCcw size={13} />} disabled={busy === e.id} onClick={() => undo(e)}>{t("undo")}</Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
