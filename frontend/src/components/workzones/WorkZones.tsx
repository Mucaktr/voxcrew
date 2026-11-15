/**
 * WORK-ZONES (ürün sahibi 2026-10-28, plan §5 C2) — çalışma yeri arayüzü:
 * - `WorkZonePicker`: görev penceresinde ("Görev ver") görsel seçici — her bölge bir kart (simge, ad, mimari, masa sayısı) ve seçili
 * ofisin mini harita ipucu (ana ofise göre yönü; konum tahmini). Varsayılan "Ofis" (ya da ajanın varsayılanı). Yalnız ofis binası
 * olan şehir sahnelerinde görünür; öteki sahnelerde tek seçenek olduğundan hiç çizilmez.
 * - `AgentZoneLine`: ajan panelinde "Çalıştığı yer: <bölge>", ana ofise dönüş nedeni ve varsayılan seçimi.
 * - `RunZoneBadge`: görev kartında bölge rozeti. `WorkZoneChips`: dünya alt şeridinde ofisteki ajan sayısı ve dönüş uyarıları.
 * Dil TR/EN; klavye (düğmeler sekme sırasında, Enter/Boşluk), `aria-pressed`, 375 px'te tek sütun.
*/
import clsx from "clsx";
import { Building2, Home, MapPin } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { currentLocale, tp, useT } from "../../lib/i18n";
import { useStudio } from "../../lib/store";
import { ensureWorkZones, useAgentZone, useWorkZones, workZonesApi } from "../../lib/workZones";
import { workZonesMsg } from "../../locales/workZones";
import { BASE_ZONE, OFFICE_DESKS, hasOffices, isZoneFor, parseZone, zoneName, zonesFor, type WorkZone } from "../../voxel/workzones/registry";
import { Badge, Field } from "../ui";

const lang = () => (currentLocale() === "en" ? "en" : "tr");
const zName = (z: WorkZone) => (lang() === "en" ? z.en : z.tr);

// AUDIT-FIX #5: mini harita bütün voxel şehir kodunu (voxel/scenes, ~1,5 MB) çeker; giriş paketine girmesin diye tembel
const ZoneMiniMap = lazy(() => import("./WorkZoneMap"));

/** Görev penceresi seçicisi. `value`: bölge kimliği (`office` varsayılan). Sahnede ofis yoksa hiçbir şey çizmez. */
export function WorkZonePicker({ scene, value, onChange, agent }: { scene: string | null; value: string; onChange: (z: string) => void; agent?: string }) {
  const t = useT(workZonesMsg);
  useEffect(() => { ensureWorkZones(); }, []);
  const zones = zonesFor(scene);
  const active = useWorkZones((s) => s.active);
  const { def } = useAgentZone(agent);
  // ajan değişince (ya da pencere açılınca) varsayılan çalışma yeri — bu sahnede geçerliyse
  useEffect(() => { onChange(def && isZoneFor(def, scene) ? def : BASE_ZONE); }, [agent, def, scene]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!hasOffices(scene)) return null;
  const busy = active.filter((r) => r.zone === value).reduce((s, r) => s + r.agents.filter((a) => a !== agent).length, 0);
  return (
    <Field label={t("field")} hint={t("hint")}>
      <div className="grid gap-2 sm:grid-cols-2">
        {zones.map((z) => {
          const office = !!z.office;
          return (
            <button key={z.id} type="button" aria-pressed={z.id === value} onClick={() => onChange(z.id)}
              className="card-select flex items-center gap-2.5 px-3 py-2 min-w-0">
              <span className={clsx("grid place-items-center w-9 h-9 rounded-lg shrink-0", office ? "bg-info-soft text-info" : "bg-panel text-ink-2")} aria-hidden>
                {office ? <Building2 size={18} /> : <Home size={18} />}
              </span>
              <span className="min-w-0">
                <span className="block font-semibold text-sm truncate">{zName(z)}</span>
                <span className="block text-xs text-muted truncate">
                  {office ? `${t(`look_${z.look ?? "modern"}` as const)} · ${t("office_desc", { n: OFFICE_DESKS })}` : t("base_desc")}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {value !== BASE_ZONE && <Suspense fallback={null}><ZoneMiniMap scene={scene} zone={value} /></Suspense>}
      {value !== BASE_ZONE && busy >= OFFICE_DESKS && <p role="status" className="text-sm text-warn mt-1">{t("full_warn", { busy, n: OFFICE_DESKS })}</p>}
    </Field>
  );
}

/** Ajan paneli: çalıştığı yer + (sahnede ofis varsa) varsayılan çalışma yeri seçimi. */
export function AgentZoneLine({ slug }: { slug: string }) {
  const t = useT(workZonesMsg);
  useEffect(() => { ensureWorkZones(); }, []);
  const scene = useStudio((s) => s.scene);
  const { zone, def } = useAgentZone(slug);
  const seat = useWorkZones((s) => s.seat[slug]);
  const [saved, setSaved] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const showPicker = hasOffices(scene);
  if (!zone && !showPicker) return null;
  const here = zone ?? BASE_ZONE;
  const fallback = zone && seat && seat.zone === zone && seat.state !== "ok" ? t(`state_${seat.state}` as const, { zone: zoneName(zone, lang()) }) : null;
  const curDef = def && isZoneFor(def, scene) ? def : BASE_ZONE;
  return (
    <div className="mt-1.5 flex flex-col gap-1">
      <p className="text-sm flex items-center gap-1.5 min-w-0">
        <MapPin size={14} aria-hidden className="text-accent shrink-0" />
        <span className="truncate">{t("where", { zone: zoneName(here, lang()) })}</span>
      </p>
      {fallback && <p role="status" className="text-xs text-warn">{fallback}</p>}
      {showPicker && (
        <label className="text-xs text-muted flex flex-wrap items-center gap-2">
          {t("default_label")}
          <select className="select !py-1 !text-sm max-w-full" value={curDef} onChange={async (e) => {
            setErr(null); setSaved(null);
            try { await workZonesApi.setDefault(slug, e.target.value); setSaved(t("default_saved")); void useWorkZones.getState().refresh(); }
            catch (x) { setErr(x instanceof Error ? x.message : String(x)); }
          }}>
            {zonesFor(scene).map((z) => <option key={z.id} value={z.id}>{zName(z)}</option>)}
          </select>
          {saved && <span role="status" className="text-ok">{saved}</span>}
          {err && <span role="alert" className="text-bad">{err}</span>}
        </label>
      )}
    </div>
  );
}

/** Görev kartı rozeti (bölgesi olan koşu). */
export function RunZoneBadge({ run }: { run: { id: string } & Record<string, unknown> }) {
  const t = useT(workZonesMsg);
  const live = useWorkZones((s) => s.active.find((r) => r.run_id === run.id)?.zone ?? null);
  const zone = (typeof run.work_zone === "string" ? run.work_zone : null) ?? live;
  if (!zone || !parseZone(zone)) return null;
  return <Badge tone="info" title={t("where_short")}><Building2 size={12} aria-hidden />{t("where", { zone: zoneName(zone, lang()) })}</Badge>;
}

/** Dünya alt şeridi: ofiste çalışan ajan sayısı ve ana ofise dönüş uyarıları. */
export function WorkZoneChips() {
  const t = useT(workZonesMsg);
  const seat = useWorkZones((s) => s.seat);
  const agents = useStudio((s) => s.agents);
  const rows = Object.entries(seat);
  if (!rows.length) return null;
  const ok = rows.filter(([, v]) => v.state === "ok").length;
  const bad = rows.filter(([, v]) => v.state !== "ok");
  return (
    <>
      {ok > 0 && <span className="chip !bg-panel/90"><Building2 size={12} aria-hidden />{tp(workZonesMsg, "chip_at_office", ok)}</span>}
      {bad.map(([slug, v]) => (
        <span key={slug} role="status" className="chip tone-warn !whitespace-normal max-w-full pointer-events-auto">
          {t("chip_fallback", { name: agents.find((a) => a.slug === slug)?.name ?? slug,
            reason: t(`state_${v.state}` as "state_full", { zone: zoneName(v.zone, lang()) }) })}
        </span>
      ))}
    </>
  );
}
