// İkili ofis seçici (sihirbazın "Ekip" adımı;, §6.5). Free'nin iki koltuğunu bir İkili
// ofisle doldurur: ajanlar hiyerarşi sırasıyla kurulur, yerine yedeğe gidecek ajanlar ÖNCE listelenir (
// hiçbir şey silinmez) ve kullanıcı onaylamadan kimse yedeğe alınmaz. Paket sayfası, fiyat ya da tanıtım gösterilmez.
import clsx from "clsx";
import { Check, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useT } from "../../lib/i18n";
import { LoopApiError, loopApi, type FirstOfficePreview, type FirstOfficeResult, type IkiliTemplate } from "../../lib/loop";
import { useStudio } from "../../lib/store";
import type { Avatar } from "../../lib/types";
import { loopMsg } from "../../locales/loop";
import { PixelFace } from "../PixelFace";
import { Badge, Button, Spinner } from "../ui";

// UXF-A: onay bekleyen kurulum (`preview`) sihirbaza bildirilir (`onPending`); sihirbaz "İleri"/adım/kapat ile
// ayrılmak isteyince `nag` artar → onay paneli açık bir uyarı gösterir ve odak "Onayla ve kur"a gider (sessizce kaybolmaz).
export function IkiliOffice({ current, onInstalled, onPending, nag = 0 }:
  { current?: string | null; onInstalled?: (r: FirstOfficeResult) => void; onPending?: (pending: boolean) => void; nag?: number }) {
  const t = useT(loopMsg);
  const [items, setItems] = useState<IkiliTemplate[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<FirstOfficeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<FirstOfficePreview | null>(null);
  const chosen = done?.template ?? current ?? null;
  const storeAgents = useStudio((s) => s.agents);
  const previewBox = useRef<HTMLElement>(null);
  const [nagged, setNagged] = useState(false);
  const pending = preview !== null;
  useEffect(() => { onPending?.(pending); if (!pending) setNagged(false); }, [pending]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onPending?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!nag || !pending) return;
    setNagged(true);
    const confirm = previewBox.current?.querySelector<HTMLButtonElement>("[data-ik-confirm]");
    confirm?.focus({ preventScroll: true });
    previewBox.current?.scrollIntoView?.({ block: "nearest" });
  }, [nag]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let alive = true;
    loopApi.ikili().then((d) => { if (alive) setItems(d); }).catch((e) => { if (alive) setError(String(e.message ?? e)); });
    return () => { alive = false; };
  }, []);

  const errorText = (e: unknown): string => {
    const msg = String((e as Error)?.message ?? e);
    if (e instanceof LoopApiError && e.status === 409) {
      if (msg.includes("local_model")) return t("ik_local_only");
      if (msg.includes("\"busy\"")) return t("ik_blocked");
    }
    return msg;
  };
  const install = async (id: string, confirm = false) => {
    setBusy(id); setError(null);
    try {
      const r = await loopApi.firstOffice(id, confirm);
      setDone(r); setPreview(null);
      onInstalled?.(r);
      await useStudio.getState().refreshAgents().catch(() => undefined);
    } catch (e) { setError(errorText(e)); } finally { setBusy(null); }
  };
  // önce kimin yedeğe gideceğini göster; yedeğe giden biri varsa kurulum yalnız onayla yapılır
  const pick = async (id: string) => {
    if (id === "starter") { await install(id); return; }
    setBusy(id); setError(null); setPreview(null);
    try {
      const p = await loopApi.firstOfficePreview(id);
      if (p.blocked) { setError(t("ik_blocked")); return; }
      if (p.bench_plan.length === 0) { setBusy(null); await install(id); return; }
      setPreview(p);
    } catch (e) { setError(errorText(e)); } finally { setBusy((b) => (b === id ? null : b)); }
  };

  if (!items && !error) return <div className="grid place-items-center py-8"><Spinner size={20} /></div>;
  // kurulumdan sonra masada gerçekten kim varsa onun adı (aynı anahtarlı başlangıç ajanı rolü üstlenir, adı değişmez)
  const doneNames = (done?.active ?? []).map((s) => storeAgents.find((a) => a.slug === s)?.name ?? s).join(" + ");
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-2">{t("ik_intro")}</p>
      <ul className="grid gap-2 grid-cols-1 sm:grid-cols-3" aria-label={t("ik_group")}>
        {(items ?? []).map((tpl) => {
          const active = chosen === tpl.id;
          return (
            <li key={tpl.id} className="min-w-0">
              <article aria-label={tpl.name}
                className={clsx("panel-soft p-3 h-full flex flex-col gap-2 min-w-0", active && "ring-2 ring-primary")}>
                <div className="flex items-center gap-1.5" aria-hidden>
                  {tpl.roles.map((r) => (
                    <PixelFace key={r.key} avatar={r.avatar as Partial<Avatar> | undefined} size={34} ring={r.color} />
                  ))}
                </div>
                <h4 className="font-display font-semibold text-sm leading-5">{tpl.name}</h4>
                <p className="text-xs text-ink-2">{tpl.roles.map((r) => `${r.name} · ${r.title}`).join(" / ")}</p>
                <p className="text-xs text-muted flex-1">{t("ik_flow", { name: tpl.workflow_name })}</p>
                {active ? (
                  <Badge tone="ok"><Check size={12} aria-hidden />{t("ik_picked")}</Badge>
                ) : (
                  <Button size="sm" variant={chosen ? "default" : "primary"} disabled={busy !== null || preview !== null}
                    icon={busy === tpl.id ? <Spinner size={13} /> : <Users size={14} />}
                    aria-label={`${chosen ? t("ik_switch") : t("ik_pick")}: ${tpl.name}`} onClick={() => { void pick(tpl.id); }}>
                    {busy === tpl.id ? t("ik_installing") : chosen ? t("ik_switch") : t("ik_pick")}
                  </Button>
                )}
              </article>
            </li>
          );
        })}
      </ul>
      {preview && (
        <section ref={previewBox} className="panel-soft p-3 flex flex-col gap-2" aria-labelledby="ik-preview-title">
          <h4 id="ik-preview-title" className="font-display font-semibold text-sm">{t("ik_preview_title")}</h4>
          {preview.bench_plan.length === 0 ? <p className="text-sm text-ink-2">{t("ik_preview_none")}</p> : (
            <ul className="flex flex-col gap-1 text-sm">
              {preview.bench_plan.map((a) => (
                <li key={a.slug} className="flex flex-wrap items-center gap-1.5 min-w-0">
                  <span className="font-medium break-words">{a.name}</span>
                  <Badge tone={a.safe ? "muted" : "warn"}>
                    {a.origin === "user" ? t("ik_preview_user") : a.used ? t("ik_preview_used") : t("ik_preview_safe")}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-ink-2">{t("ik_preview_note")}</p>
          {nagged && <p role="alert" className="chip tone-warn !whitespace-normal !rounded-lg !items-start p-2 text-sm font-medium">{t("ik_pending")}</p>}
          <div className="flex flex-wrap gap-2">
            <Button data-ik-confirm="" size="sm" variant="primary" disabled={busy !== null}
              icon={busy === preview.template ? <Spinner size={13} /> : <Check size={14} />}
              onClick={() => { void install(preview.template, true); }}>{t("ik_confirm")}</Button>
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setPreview(null)}>{t("ik_cancel")}</Button>
          </div>
        </section>
      )}
      <div role="status" aria-live="polite" className="flex flex-col gap-1">
        {done && doneNames && <p className="text-sm text-ok">{t("ik_done", { names: doneNames })}</p>}
        {done && done.swapped.length > 0 && <p className="text-xs text-ink-2">{t("ik_swapped")}</p>}
        {done && done.bench.length > 0 && <p className="text-xs text-ink-2">{t("ik_bench", { n: done.bench.length })}</p>}
        {chosen === "starter" && <p className="text-sm text-ink-2">{t("ik_kept")}</p>}
      </div>
      {error && <p role="alert" className="text-sm text-bad break-words">{error}</p>}
      {!chosen && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => { void pick("starter"); }}>
            {t("ik_keep")}
          </Button>
          <span className="text-xs text-muted flex-1 min-w-[min(100%,220px)]">{t("ik_keep_hint")}</span>
        </div>
      )}
    </div>
  );
}
