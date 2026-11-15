/**
 * Hermes API sunucusunu etkinleştirme önizlemesi (Ekip S2).
 * Kullanıcı kuralı: "Önce profil .env dosyasında yapılacak değişikliği bana göster, onaylayınca uygula."
 * Her .env için maskeli diff + gateway yan etkileri gösterilir; "Onayla ve uygula" ancak kullanıcı yan etkileri
 * okuduğunu işaretledikten sonra açılır. Anahtar düz metni hiçbir zaman tarayıcıya gelmez.
 */
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, FileDiff, KeyRound, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { gatewayApi, type EnableResult, type GatewayPreview } from "../../lib/gateway";
import { useT } from "../../lib/i18n";
import { gatewayMsg as m } from "../../locales/gateway";
import { Badge, Button, Modal } from "../ui";

const ACTION: Record<string, { key: "act_add" | "act_update" | "act_keep"; tone: string }> = {
  add: { key: "act_add", tone: "ok" },
  update: { key: "act_update", tone: "warn" },
  keep: { key: "act_keep", tone: "muted" },
};

export function DiffBlock({ lines }: { lines: string[] }) {
  return (
    <pre className="font-mono text-xs leading-relaxed panel-soft p-3 max-h-64 overflow-auto">
      {lines.map((l, i) => (
        <div key={i} className={clsx(
          l.startsWith("+") && !l.startsWith("+++") && "text-ok bg-[var(--ok-bg)]",
          l.startsWith("-") && !l.startsWith("---") && "text-bad bg-[var(--bad-bg)]",
          l.startsWith("@@") && "text-info")}>{l || " "}</div>
      ))}
    </pre>
  );
}

export function EnableReviewModal({ preview, onClose, onApplied }:
  { preview: GatewayPreview; onClose: () => void; onApplied: (r: EnableResult) => void }) {
  const t = useT(m);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EnableResult | null>(null);
  const changing = preview.plans.filter((p) => !p.no_change);

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await gatewayApi.enable(preview.plans.map((p) => p.id));
      setResult(r);
      onApplied(r);
      if (!r.ok && r.failed) setError(`${r.failed.profile}: ${r.failed.error}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={t("enable_title")} width={880}
      footer={result?.ok ? (
        <Button variant="primary" onClick={onClose}>{t("close")}</Button>
      ) : (<>
        <span className="mr-auto text-xs text-muted self-center max-w-md">
          {t("backup_hint")}
        </span>
        <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
        <Button variant="primary" icon={<ShieldCheck size={16} />} disabled={busy || !ack || changing.length === 0} onClick={apply}>
          {busy ? t("applying") : t("confirm_apply")}
        </Button>
      </>)}>
      <div className="flex flex-col gap-4">
        {result?.ok ? (
          <div className="flex flex-col gap-2">
            <div className="chip tone-ok !rounded-lg !whitespace-normal !items-start font-medium p-3 text-sm">
              <CheckCircle2 size={16} className="shrink-0 mt-0.5" /> {t("applied")}
            </div>
            <ul className="flex flex-col gap-1.5 text-sm">
              {result.applied.map((a) => (
                <li key={a.id} className="panel-soft p-2.5 flex flex-col gap-0.5 min-w-0">
                  <span className="font-semibold">{a.profile} {a.skipped && <Badge>{t("skipped")}</Badge>}</span>
                  <span className="font-mono text-xs text-muted break-all">{a.path}</span>
                  {a.backup && <span className="text-xs text-ink-2 break-all">{t("backup")} <span className="font-mono">{a.backup}</span></span>}
                </li>
              ))}
            </ul>
          </div>
        ) : (<>
          <section className="tone-warn rounded-lg border-2 p-3 flex flex-col gap-2">
            <h3 className="font-display flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle size={16} /> {t("side_effects")}
            </h3>
            <ul className="list-disc pl-5 flex flex-col gap-1 text-sm text-ink">
              {preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </section>

          {preview.plans.map((p) => (
            <section key={p.id} className="flex flex-col gap-2 min-w-0">
              <div className="flex items-start gap-2">
                <FileDiff size={18} className="text-accent shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm flex flex-wrap items-center gap-2">
                    {p.root ? t("root_env") : t("profile_n", { p: p.profile })}
                    {p.no_change && <Badge>{t("no_change_badge")}</Badge>}
                    {!p.exists && <Badge tone="info">{t("new_file_badge")}</Badge>}
                  </div>
                  <div className="font-mono text-xs text-muted break-all">{p.path}</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {p.changes.map((c) => (
                  <Badge key={c.key} tone={ACTION[c.action]?.tone ?? "muted"}>
                    {c.key === "API_SERVER_KEY" && <KeyRound size={12} />}
                    <span className="font-mono">{c.key}={c.value_preview}</span> · {ACTION[c.action] ? t(ACTION[c.action].key) : c.action}
                  </Badge>
                ))}
              </div>
              {!p.no_change && <DiffBlock lines={p.diff} />}
              {!p.no_change && p.backup_pattern && (
                <p className="text-xs text-muted">{t("backup")} <span className="font-mono">{p.backup_pattern}</span> · {t("other_lines")}</p>
              )}
            </section>
          ))}

          <p className="text-xs text-muted">
            {t("masked_note")}
          </p>
          <label className="flex items-start gap-2 text-sm cursor-pointer select-none">
            <input type="checkbox" className="mt-1" aria-label={t("ack")} checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>{t("ack")}</span>
          </label>
        </>)}
        {error && <div className="chip tone-bad !rounded-lg !whitespace-normal !items-start font-medium p-3 text-sm">{error}</div>}
      </div>
    </Modal>
  );
}
