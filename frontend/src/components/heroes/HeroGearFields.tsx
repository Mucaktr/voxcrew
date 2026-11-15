// S44: görünüm düzenleyicide "Kahraman donanımı" bölümü — pelerin, maske, amblem, bot/eldiven, parıltı, süzülme.
// Ücretsiz ve kilitsizdir (mağaza öğesi değildir); her ajan giyebilir.
import { Sparkles } from "lucide-react";
import { useT } from "../../lib/i18n";
import type { Avatar } from "../../lib/types";
import { heroesMsg } from "../../locales/heroes";
import { AURA_COLORS, CAPE_COLORS, HERO_CAPES, HERO_EMBLEMS, HERO_MASKS } from "../../voxel/avatar";
import { Field, OptionGrid, Swatches, Toggle } from "../ui";

export function HeroGearFields({ value, onChange }: { value: Avatar; onChange: (a: Avatar) => void }) {
  const t = useT(heroesMsg);
  const set = <K extends keyof Avatar>(k: K, v: Avatar[K]) => onChange({ ...value, [k]: v });
  const capeColor = value.capeColor ?? CAPE_COLORS[0];
  const aura = value.aura && value.aura !== "none" ? value.aura : "";
  return (
    <Field label={<span className="inline-flex items-center gap-1.5"><Sparkles size={14} aria-hidden />{t("gear")}</span>} hint={t("gear_hint")}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-ink-2 font-semibold">{t("cape")}</span>
          <OptionGrid options={HERO_CAPES} value={value.cape ?? "none"} cols={3}
            onChange={(v) => onChange({ ...value, cape: v, capeColor: v === "none" ? value.capeColor : capeColor })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-ink-2 font-semibold">{t("cape_color")}</span>
          <Swatches colors={CAPE_COLORS} value={capeColor} onChange={(c) => set("capeColor", c)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-ink-2 font-semibold">{t("mask")}</span>
          <OptionGrid options={HERO_MASKS} value={value.mask ?? "none"} cols={2} onChange={(v) => set("mask", v)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-ink-2 font-semibold">{t("emblem")}</span>
          <OptionGrid options={HERO_EMBLEMS} value={value.emblem ?? "none"} cols={3} onChange={(v) => set("emblem", v)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-ink-2 font-semibold">{t("aura")}</span>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" aria-pressed={!aura} onClick={() => set("aura", "none")}
              className="card-select px-2 py-1 text-xs font-semibold">{t("aura_none")}</button>
            <Swatches colors={AURA_COLORS} value={aura || "#000000"} onChange={(c) => set("aura", c)} />
          </div>
        </div>
        <div className="grid sm:grid-cols-3 gap-2">
          <Toggle checked={!!value.boots} onChange={(v) => set("boots", v)} label={t("boots")} />
          <Toggle checked={!!value.gloves} onChange={(v) => set("gloves", v)} label={t("gloves")} />
          <Toggle checked={!!value.hover} onChange={(v) => set("hover", v)} label={t("hover")} />
        </div>
      </div>
    </Field>
  );
}
