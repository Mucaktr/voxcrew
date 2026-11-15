// DELIV-P0 — çıktı görüntüleyicinin ek parçaları: (D3) "Klasörde göster" onay penceresi, (D4) statik uygulama önizlemesi
// (sandbox'lı iframe), sürüm şeridi. Hiçbir şey kendiliğinden açılmaz: klasör yalnızca plan → açık onayla açılır.
// önizleme VARSAYILAN betiksizdir (`sandbox=""`, sunucu `script-src 'none'`); betikler yalnızca kullanıcının
// açık, önizleme başına onayıyla (`sandbox="allow-scripts"`, allow-same-origin yok) çalışır ve kalıcı değildir.
import { FolderSearch, GitCompareArrows, Play, RefreshCcw, ShieldCheck, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import { Badge, Button, Disclosure, Modal, Spinner } from "../ui";
import { deliverablesApi, type DeliverableContent, type DeliverableVersion, type RevealPlan } from "../../lib/deliverables";
import { fmtNumber, useT } from "../../lib/i18n";
import { deliverablesMsg as m } from "../../locales/deliverables";

// ---------------------------------------------------------------- D3: klasörde göster (plan → onay)
export function RevealDialog({ id, open, onClose }: { id: string; open: boolean; onClose: () => void }) {
  const t = useT(m);
  const [plan, setPlan] = useState<RevealPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const load = useCallback(() => {
    setPlan(null); setError(null); setDone(false);
    deliverablesApi.revealPlan(id)
      .then((r) => setPlan(r.plan))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);
  useEffect(() => { if (open) load(); }, [open, load]);

  const confirm = async () => {
    if (!plan) return;
    setBusy(true); setError(null);
    try {
      await deliverablesApi.revealConfirm(id, plan.plan_hash);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const where = plan?.location === "vault" ? t("reveal_where_vault") : t("reveal_where_workdir");
  const how = plan?.platform === "windows" ? t("reveal_how_windows") : plan?.platform === "macos" ? t("reveal_how_macos") : t("reveal_how_linux");
  return (
    <Modal open={open} onClose={onClose} title={t("reveal_title")} width={520}
      footer={<>
        <Button onClick={onClose}>{done ? t("close") : t("cancel")}</Button>
        {!done && <Button variant="primary" icon={<FolderSearch size={15} />} disabled={!plan || busy} onClick={() => { void confirm(); }}>{t("reveal_confirm")}</Button>}
      </>}>
      <div className="flex flex-col gap-3 text-sm">
        {!plan && !error && <div className="grid place-items-center py-6"><Spinner size={20} /></div>}
        {plan && (
          <>
            <p className="font-semibold break-all">{plan.name}</p>
            <p>{where}</p>
            <p className="text-muted">{how}</p>
            <p className="text-xs text-muted">{t("reveal_nothing_changes")}</p>
          </>
        )}
        {error && <p role="alert" className="text-bad font-semibold break-words">{error}</p>}
        {done && <p role="status" className="text-ok font-semibold">{t("reveal_done")}</p>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- D4: statik uygulama önizlemesi
export function AppPreview({ id, title, content }: { id: string; title: string; content: DeliverableContent }) {
  const t = useT(m);
  const [nonce, setNonce] = useState(0);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // betikler: varsayılan KAPALI, yalnızca bellekte (görüntüleyici kapanınca / çıktı değişince / sayfa yenilenince düşer)
  const [scripts, setScripts] = useState(false);
  const [askScripts, setAskScripts] = useState(false);
  useEffect(() => { setScripts(false); setAskScripts(false); }, [id]);
  // her yüklemede yeni oturum: belirteç yalnızca arayüzün kullanıcı-yalnız isteğiyle alınır (sayfa yenilense de iframe tazelenir)
  useEffect(() => {
    let alive = true;
    setSrc(null); setError(null);
    deliverablesApi.siteSession(id, scripts)
      .then((r) => { if (alive) setSrc(r.url); })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [id, nonce, scripts]);
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        {scripts
          ? <Badge tone="warn"><TriangleAlert size={12} aria-hidden />{t("app_scripts_on")}</Badge>
          : <Badge tone="info"><ShieldCheck size={12} aria-hidden />{t("app_sandboxed")}</Badge>}
        <Button size="sm" icon={<RefreshCcw size={14} />} onClick={() => setNonce((n) => n + 1)}>{t("app_reload")}</Button>
        {scripts
          ? <Button size="sm" icon={<ShieldCheck size={14} />} onClick={() => setScripts(false)}>{t("app_scripts_off")}</Button>
          : <Button size="sm" icon={<Play size={14} />} onClick={() => setAskScripts(true)}>{t("app_scripts_run")}</Button>}
      </div>
      <Modal open={askScripts} onClose={() => setAskScripts(false)} title={t("app_scripts_title")} width={480}
        footer={<>
          <Button onClick={() => setAskScripts(false)}>{t("cancel")}</Button>
          <Button variant="primary" icon={<Play size={15} />} onClick={() => { setScripts(true); setAskScripts(false); }}>{t("app_scripts_confirm")}</Button>
        </>}>
        <p className="text-sm">{t("app_scripts_warning")}</p>
      </Modal>
      {/* sandbox="allow-scripts" YALNIZ açık onayla; varsayılan sandbox="" (betik yok). allow-same-origin yok → opak köken,
          VoxCrew API'sine çerezle ulaşamaz; CSP connect-src 'none' (kendini yönlendirmeyi CSP engelleyemez: bu yüzden varsayılan betiksiz) */}
      {error && <p role="alert" className="text-sm text-bad break-words">{error}</p>}
      {!src && !error && <div className="grid place-items-center h-[62vh] min-h-[320px]"><Spinner size={22} /></div>}
      {src && (
        <iframe key={nonce} title={t("app_frame_title", { title })} src={src}
          sandbox={scripts ? "allow-scripts" : ""} referrerPolicy="no-referrer"
          className="w-full h-[62vh] min-h-[320px] rounded-lg border-2 border-line bg-white" />
      )}
      <p className="text-xs text-muted">{scripts ? t("app_note_scripts") : t("app_note")}</p>
      {!!content.files?.length && (
        <Disclosure summary={t("app_files", { n: content.files.length })}>
          <ul className="text-xs font-mono flex flex-col gap-0.5 break-all">
            {content.files.map((f) => (
              <li key={f.path} className="flex justify-between gap-3">
                <span>{f.path}{f.role === "entry" ? ` · ${t("app_entry")}` : ""}</span>
                <span className="text-muted num shrink-0">{f.size != null ? `${fmtNumber(f.size)} B` : ""}</span>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- sürüm şeridi
// DEPO-TESLIM: `onCompare` verilirse şeritte "Sürümleri karşılaştır" düğmesi çıkar (sürüm listesini üst bileşene verir).
export function VersionStrip({ id, version, onCompare }: { id: string; version?: number; onCompare?: (versions: DeliverableVersion[]) => void }) {
  const t = useT(m);
  const navigate = useNavigate();
  const [items, setItems] = useState<DeliverableVersion[]>([]);
  useEffect(() => {
    let alive = true;
    setItems([]);
    deliverablesApi.versions(id).then((r) => { if (alive) setItems(r.items); }).catch(() => undefined);
    return () => { alive = false; };
  }, [id, version]);
  if (items.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs" role="group" aria-label={t("versions_label")}>
      <span className="font-semibold text-muted">{t("versions_label")}</span>
      {/* UXF-E: hangisi görüntülenen, hangisi güncel açık; sürüm çipleri gerçek düğme (Tab/Enter/Boşluk)*/}
      {items.map((v) => {
        const viewing = v.id === id;
        const label = [t("version_n", { n: v.version }), viewing ? t("version_viewing") : "", v.current ? t("version_latest") : ""].filter(Boolean);
        return (
          <button key={v.id} type="button" aria-current={viewing ? "true" : undefined} aria-label={label.join(", ")}
            className={clsx("chip min-h-11 sm:min-h-0 hover:border-ink-2 cursor-pointer", viewing && "tone-ok font-semibold")}
            onClick={() => { if (!viewing) navigate(`/ciktilar?d=${encodeURIComponent(v.id)}`); }}>
            {t("version_n", { n: v.version })}{viewing ? ` · ${t("version_viewing")}` : ""}{v.current ? ` · ${t("version_latest")}` : ""}
          </button>
        );
      })}
      {onCompare && (
        <Button size="sm" icon={<GitCompareArrows size={14} />} onClick={() => onCompare(items)}>{t("compare_open")}</Button>
      )}
    </div>
  );
}
