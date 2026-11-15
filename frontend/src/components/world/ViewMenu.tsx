/**
 * S47 — "Görünüm" açılır paneli: etiket yoğunluğu, ışık (otomatik/gündüz/gece), ortam canlılığı ve eğlenceli hareketler;
 * yürüme görüş açısı kaydırıcısı (50–75°, Sıfırla).
 * Tek simge düğmesi (aramanın yanında); içeride simgeli bölümlü seçiciler (ui.tsx `Segmented`). Esc ve dışarı tıklama
 * kapatır, odak düğmeye döner. Uzun açıklamalar satır etiketinin ipucu ve ekran okuyucu açıklamasıdır (panel kısa kalır). Yeni geçişler buraya bir satır olarak eklenir; durum `viewSettings.ts` içindedir.
*/
import clsx from "clsx";
import { Bird, CloudRain, CloudSun, Eye, EyeOff, Focus, MousePointer2, Moon, PartyPopper, RotateCcw, SlidersHorizontal, Sun, SunMoon, Tag, Tags } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useT } from "../../lib/i18n";
import { world as M } from "../../locales/world";
import { Segmented } from "../ui";
import { FUN_LEVELS, LABEL_MODES, LIGHT_MODES, useAmbientLife, useFunMoments, useLabelMode, useLightMode, useWalkFov, useWeatherFx, useWeatherMoments, WALK_FOV_DEFAULT, WALK_FOV_MAX,
  WALK_FOV_MIN, WALK_FOV_STEP, type FunLevel, type LabelMode, type LightMode } from "./viewSettings";
import { WelcomeSetting } from "../welcome/WelcomeSetting";
import { FocusViewRow } from "./focus/FocusViewRow";
import "./world.css";

const LABEL_ICON: Record<LabelMode, ReactNode> = { minimal: <Tag size={13} aria-hidden="true" />, hover: <MousePointer2 size={13} aria-hidden="true" />, all: <Tags size={13} aria-hidden="true" /> };
const LIGHT_ICON: Record<LightMode, ReactNode> = { auto: <SunMoon size={13} aria-hidden="true" />, day: <Sun size={13} aria-hidden="true" />, night: <Moon size={13} aria-hidden="true" /> };
const FUN_ICON: Record<FunLevel, ReactNode> = { on: <PartyPopper size={13} aria-hidden="true" />, few: <PartyPopper size={13} aria-hidden="true" className="opacity-60" />, off: <EyeOff size={13} aria-hidden="true" /> };

function Row({ label, hint, icon, children }: { label: string; hint?: string; icon: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <div className="vmenu-row" role="group" aria-labelledby={`${id}-l`} aria-describedby={hint ? `${id}-h` : undefined}>
      <div className="vmenu-label" title={hint}>
        <span aria-hidden="true" className="text-muted">{icon}</span>
        <span id={`${id}-l`}>{label}</span>
      </div>
      {children}
      {hint && <span id={`${id}-h`} className="sr-only">{hint}</span>}
    </div>
  );
}

const opt = (icon: ReactNode, text: string) => <span className="inline-flex items-center gap-1">{icon}<span>{text}</span></span>;

export function ViewMenu({ className }: { className?: string }) {
  const t = useT(M);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const labels = useLabelMode((s) => s.mode);
  const setLabels = useLabelMode((s) => s.setMode);
  const light = useLightMode((s) => s.mode);
  const setLight = useLightMode((s) => s.setMode);
  const ambient = useAmbientLife((s) => s.on);
  const setAmbient = useAmbientLife((s) => s.setOn);
  const fun = useFunMoments((s) => s.level);
  const setFun = useFunMoments((s) => s.setLevel);
  const weather = useWeatherFx((s) => s.on);
  const setWeather = useWeatherFx((s) => s.setOn);
  const moments = useWeatherMoments((s) => s.on);
  const setMoments = useWeatherMoments((s) => s.setOn);
  const fov = useWalkFov((s) => s.fov);
  const setFov = useWalkFov((s) => s.setFov);
  const resetFov = useWalkFov((s) => s.reset);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    // açılınca ilk seçili seçeneğe odaklan
    root.current?.querySelector<HTMLButtonElement>(".vmenu [aria-pressed='true']")?.focus();
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open]);

  return (
    <div ref={root} className={clsx("vmenu-wrap", className)}>
      <button ref={btn} type="button" className={clsx("wtools-btn", open && "is-open")} aria-expanded={open} aria-controls={panelId} aria-haspopup="dialog"
        aria-label={t("view_open")} title={t("view_open")} onClick={() => setOpen((v) => !v)}>
        <SlidersHorizontal size={14} aria-hidden="true" />
        <span className="hidden sm:inline">{t("view_title")}</span>
      </button>
      {open && (
        <div id={panelId} role="dialog" aria-label={t("view_open")} className="vmenu">
          <Row label={t("labels_mode")} hint={t("labels_hint")} icon={<Tag size={13} />}>
            <Segmented<LabelMode> className="vmenu-seg" value={labels} onChange={setLabels}
              options={LABEL_MODES.map((m) => ({ value: m, label: opt(LABEL_ICON[m], t(`labels_${m}`)) }))} />
          </Row>
          <Row label={t("light_mode")} hint={light === "auto" ? t("light_auto_hint") : undefined} icon={<SunMoon size={13} />}>
            <Segmented<LightMode> className="vmenu-seg" value={light} onChange={setLight}
              options={LIGHT_MODES.map((m) => ({ value: m, label: opt(LIGHT_ICON[m], t(`light_${m}`)) }))} />
          </Row>
          <Row label={t("amb_label")} hint={t("amb_hint")} icon={<Bird size={13} />}>
            <Segmented<"on" | "off"> className="vmenu-seg" value={ambient ? "on" : "off"} onChange={(v) => setAmbient(v === "on")}
              options={[{ value: "on", label: opt(<Eye size={13} aria-hidden="true" />, t("amb_on")) }, { value: "off", label: opt(<EyeOff size={13} aria-hidden="true" />, t("amb_off")) }]} />
          </Row>
          {/* SP-W0: sahne havası (yağmur, kar…) */}
          <Row label={t("weather_label")} hint={t("weather_hint")} icon={<CloudRain size={13} />}>
            <Segmented<"on" | "off"> className="vmenu-seg" value={weather ? "on" : "off"} onChange={(v) => setWeather(v === "on")}
              options={[{ value: "on", label: opt(<CloudRain size={13} aria-hidden="true" />, t("weather_on")) }, { value: "off", label: opt(<EyeOff size={13} aria-hidden="true" />, t("weather_off")) }]} />
          </Row>
          {/* (A5): kısa, seyrek hava anları (sağanak, sabah sisi, kar taneleri); yalnız hava durumu açıkken anlamlı*/}
          {weather && (
            <Row label={t("moments_label")} hint={t("moments_hint")} icon={<CloudSun size={13} />}>
              <Segmented<"on" | "off"> className="vmenu-seg" value={moments ? "on" : "off"} onChange={(v) => setMoments(v === "on")}
                options={[{ value: "on", label: opt(<CloudSun size={13} aria-hidden="true" />, t("weather_on")) }, { value: "off", label: opt(<EyeOff size={13} aria-hidden="true" />, t("weather_off")) }]} />
            </Row>
          )}
          <Row label={t("fun_moments")} hint={t("fun_hint")} icon={<PartyPopper size={13} />}>
            <Segmented<FunLevel> className="vmenu-seg" value={fun} onChange={setFun}
              options={FUN_LEVELS.map((m) => ({ value: m, label: opt(FUN_ICON[m], t(`fun_${m}`)) }))} />
          </Row>
          {/* (K3): yürüme kamerasının görüş açısı; yürürken anında uygulanır (WalkRig her karede okur). Ok tuşları 1°, Home/End uçlar.*/}
          <Row label={t("fov_label")} hint={t("fov_hint")} icon={<Focus size={13} />}>
            <div className="flex items-center gap-2 min-w-0">
              <input type="range" className="flex-1 min-w-0 h-8 accent-primary cursor-pointer" min={WALK_FOV_MIN} max={WALK_FOV_MAX} step={WALK_FOV_STEP}
                value={fov} onChange={(e) => setFov(Number(e.target.value))} aria-label={t("fov_label")} aria-valuetext={t("fov_valuetext", { n: fov })} />
              <output className="num text-xs font-semibold w-8 text-right" aria-hidden="true">{t("fov_value", { n: fov })}</output>
              <button type="button" className="btn btn-ghost btn-sm min-h-8 !px-2 inline-flex items-center gap-1" disabled={fov === WALK_FOV_DEFAULT}
                onClick={resetFov} aria-label={t("fov_reset_aria", { n: WALK_FOV_DEFAULT })} title={t("fov_reset_aria", { n: WALK_FOV_DEFAULT })}>
                <RotateCcw size={13} aria-hidden="true" /><span>{t("fov_reset")}</span>
              </button>
            </div>
          </Row>
          {/* (K4): yürürken sayfa panellerini gizle*/}
          <FocusViewRow />
          {/* şehre ilk girişte "Hoş geldin" kartı*/}
          <WelcomeSetting />
        </div>
      )}
    </div>
  );
}
