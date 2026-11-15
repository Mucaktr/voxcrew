import { Dices, Lock } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { ensureGameLoaded, sendGameSignal, useGame, useGameLocks, type LockedItem } from "../lib/game";
import type { Avatar, Mood } from "../lib/types";
import { MOOD_LABEL } from "../lib/format";
import { fmtNumber, useT } from "../lib/i18n";
import { shell } from "../locales/shell";
import { presentationMsg } from "../locales/presentation";
import { isPresentation, presentationOfName, type Presentation } from "../lib/presentation";
import {
  ACCENT_COLORS, BEARDS, FUR_TONES, GLASSES, HAIR, HAIR_COLORS, HATS, looksFor, OUTFIT_COLORS, OUTFITS, randomAnimal, randomHuman, SKIN_TONES, SPECIES,
} from "../voxel/avatar";
import { AvatarPreview } from "../voxel/AvatarPreview";
import type { Motion } from "../voxel/Character";
import { PurchaseDialog } from "./game/ShopView";
import { PixelFace } from "./PixelFace";
import { HeroGearFields } from "./heroes/HeroGearFields";
import { Button, Field, OptionGrid, Segmented, Swatches } from "./ui";

const PREVIEW: { mood: Mood; motion: Motion }[] = [
  { mood: "idle", motion: "idle" }, { mood: "thinking", motion: "think" }, { mood: "working", motion: "type" },
  { mood: "done", motion: "jump" }, { mood: "error", motion: "shake" }, { mood: "offline", motion: "sleep" },
];

// S5: kilitli kozmetikler (oyunlaştırma açık ve yaratıcı mod kapalıyken). Kimlik ifadesi (tür, saç, ten, renk) hiçbir
// zaman kilitlenmez; ajanın üzerindeki bir eşya kilitli olsa bile çıkarılmaz.
type LockSlot = "hat" | "glasses" | "outfit";
const previewed = new Set<string>();
const SAFE: Record<LockSlot, string> = { hat: "none", glasses: "none", outfit: "tshirt" };

function useLock(): (slot: LockSlot, id: string) => LockedItem | undefined {
  const locks = useGameLocks();
  const active = useGame((s) => !!s.profile?.enabled && !s.profile?.creative);
  return (slot, id) => (active ? locks[`${slot}:${id}`] : undefined);
}

function LockableGrid<T extends string>({ slot, options, value, onPick, onLocked, cols, render, lockOf }:
  { slot: LockSlot; options: { id: T; label: string }[]; value: T; onPick: (v: T) => void; cols: number;
    onLocked: (slot: LockSlot, id: T, lock: LockedItem) => void; render?: (id: T) => ReactNode;
    lockOf: (slot: LockSlot, id: string) => LockedItem | undefined }) {
  const t = useT(shell);
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const lock = lockOf(slot, o.id);
        const worn = o.id === value;
        return (
          <button key={o.id} type="button" aria-pressed={worn}
            aria-label={lock ? t("lock_aria", { label: o.label, worn: worn ? t("lock_worn") : "", price: fmtNumber(lock.price) }) : undefined}
            title={lock ? `${t("lock_title", { label: o.label, price: fmtNumber(lock.price) })}${lock.min_level ? t("lock_level", { n: lock.min_level }) : ""}` : undefined}
            onClick={() => (lock && !worn ? onLocked(slot, o.id, lock) : onPick(o.id))}
            className="card-select px-2 py-1.5 min-h-[2rem] text-xs font-semibold flex items-center gap-1.5 min-w-0">
            {render?.(o.id)}
            <span className="truncate">{o.label}</span>
            {lock && (
              <span className="ml-auto shrink-0 inline-flex items-center gap-0.5 text-muted" aria-hidden>
                <Lock size={11} /><span className="num font-medium">{fmtNumber(lock.price)}</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function AvatarEditor({ value, onChange, name }: { value: Avatar; onChange: (a: Avatar) => void; /** UXF-E: "Otomatik"ın çözüldüğü stil addan türetilir*/ name?: string }) {
  const t = useT(shell);
  const tg = useT(presentationMsg);
  const [pose, setPose] = useState(0);
  const set = <K extends keyof Avatar>(k: K, v: Avatar[K]) => onChange({ ...value, [k]: v });
  const human = value.species === "human";
  // GIFTS-GENDER: giyim tarzı (açık seçim ya da addan türetilmiş); hazır görünümler ve rastgele buna uyar
  const curPres: Presentation = isPresentation(value.presentation) ? value.presentation : "n";
  // "Otomatik" neye çözüldü (açık türetilmiş stil ya da addan; rol adları Nötr)
  const autoPres: Presentation = isPresentation(value.presentation) && value.presentationAuto ? value.presentation : presentationOfName(name);
  const presMode: "auto" | Presentation = value.presentationAuto || !isPresentation(value.presentation) ? "auto" : value.presentation;
  const keepPres = { ...(value.presentation ? { presentation: value.presentation } : {}), ...(value.presentationAuto ? { presentationAuto: true } : {}) };
  const setPres = (v: "auto" | Presentation) => onChange({ ...value, presentation: v === "auto" ? undefined : v, presentationAuto: undefined });
  const p = PREVIEW[pose];
  const lockOf = useLock();
  const [buying, setBuying] = useState<{ slot: LockSlot; id: string; lock: LockedItem } | null>(null);
  useEffect(() => { void ensureGameLoaded(); }, []);
  const onLocked = (slot: LockSlot, id: string, lock: LockedItem) => setBuying({ slot, id, lock });
  const randomize = () => {
    // S34: türü korur (insan → rastgele insan, hayvan → rastgele hayvan); yalnızca ücretsiz eşya seçilir
    const a = human ? { ...randomHuman(curPres), ...keepPres } : randomAnimal();
    (["hat", "glasses", "outfit"] as LockSlot[]).forEach((slot) => {
      if (lockOf(slot, a[slot])) (a as unknown as Record<string, string>)[slot] = SAFE[slot];
    });
    onChange(a);
  };
  const previewSpecies = (id: string) => {
    if (previewed.has(id)) return;
    previewed.add(id);
    sendGameSignal("species.previewed", { species: id });
  };

  // Önizleme her zaman görünür kalır: dar alanda kaydırırken üstte yapışık, geniş alanda solda sabit sütun (UX, 2026-10-19)
  return (
    <div className="@container">
    <div className="grid gap-5 @3xl:grid-cols-[minmax(15rem,20rem)_minmax(0,1fr)] @3xl:items-start">
      <div className="sticky top-0 z-10 flex flex-col gap-2 bg-panel pb-2 border-b-2 border-line @3xl:border-b-0 @3xl:pb-0">
        <AvatarPreview avatar={value} mood={p.mood} motion={p.motion} height={220} />
        <div className="flex items-center gap-2 flex-wrap">
          <Segmented value={String(pose)} onChange={(v) => setPose(Number(v))}
            options={PREVIEW.map((x, i) => ({ value: String(i), label: MOOD_LABEL[x.mood] }))} className="flex-wrap" />
          <Button size="sm" icon={<Dices size={15} />} className="ml-auto" onClick={randomize}>{t("random")}</Button>
        </div>
      </div>

      <div className="flex flex-col gap-5 min-w-0">
      <Field label={t("species")}>
        <div className="grid grid-cols-4 gap-1.5">
          {SPECIES.map((s) => (
            <button key={s.id} type="button" aria-pressed={value.species === s.id}
              onClick={() => { previewSpecies(s.id); onChange({ ...value, species: s.id, skin: s.id === "human" ? SKIN_TONES[2] : s.fur,
                hair: s.id === "human" ? (value.hair === "none" ? "short" : value.hair) : "none", beard: s.id === "human" ? value.beard : "none" }); }}
              className="card-select flex flex-col items-center gap-1 py-2 text-xs font-semibold">
              <PixelFace avatar={{ ...value, species: s.id, skin: s.id === "human" ? SKIN_TONES[2] : s.fur, hat: "none", glasses: "none",
                hair: s.id === "human" ? "short" : "none", beard: "none" }} size={34} />
              {s.label}
            </button>
          ))}
        </div>
      </Field>

      {human && (
        <>
        <Field label={tg("pres_label")} hint={tg("pres_hint")}>
          <Segmented<"auto" | Presentation> value={presMode} onChange={setPres}
            options={[{ value: "auto", label: tg("pres_auto_now", { pres: tg(autoPres === "m" ? "pres_m" : autoPres === "f" ? "pres_f" : "pres_n") }) },
              { value: "m", label: tg("pres_m") }, { value: "f", label: tg("pres_f") }, { value: "n", label: tg("pres_n") }]} />
        </Field>
        <Field label={t("ready_looks")}>
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
            {looksFor(presMode === "auto" ? "n" : presMode).map((l, i) => ( /* otomatik sunum listeyi daraltmaz */
              <button key={i} type="button" aria-label={t("ready_look_aria", { n: i + 1 })}
                aria-pressed={JSON.stringify({ ...l, ...keepPres }) === JSON.stringify(value)}
                className="card-select flex items-center justify-center p-1" onClick={() => onChange({ ...l, ...keepPres })}>
                <PixelFace avatar={l} size={30} />
              </button>
            ))}
          </div>
        </Field>
        </>
      )}

      <Field label={human ? t("skin") : t("fur")}>
        <Swatches colors={human ? SKIN_TONES : FUR_TONES} value={value.skin} onChange={(c) => set("skin", c)} />
      </Field>

      {human && (
        <>
          <Field label={t("hair")}>
            <OptionGrid options={HAIR} value={value.hair} onChange={(v) => set("hair", v)} cols={3} />
            <Swatches colors={HAIR_COLORS} value={value.hairColor} onChange={(c) => set("hairColor", c)} />
          </Field>
          <Field label={t("beard")}>
            <OptionGrid options={BEARDS} value={value.beard} onChange={(v) => set("beard", v)} cols={3} />
          </Field>
        </>
      )}

      <Field label={t("outfit")}>
        <LockableGrid slot="outfit" options={OUTFITS} value={value.outfit} onPick={(v) => set("outfit", v)} cols={2}
          lockOf={lockOf} onLocked={onLocked} />
        <div className="grid sm:grid-cols-2 gap-3 mt-1">
          <div className="flex flex-col gap-1.5"><span className="text-xs text-ink-2 font-semibold">{t("main_color")}</span>
            <Swatches colors={OUTFIT_COLORS} value={value.outfitColor} onChange={(c) => set("outfitColor", c)} /></div>
          <div className="flex flex-col gap-1.5"><span className="text-xs text-ink-2 font-semibold">{t("accent_color")}</span>
            <Swatches colors={ACCENT_COLORS} value={value.accent} onChange={(c) => set("accent", c)} /></div>
        </div>
      </Field>

      <Field label={t("glasses")}>
        <LockableGrid slot="glasses" options={GLASSES} value={value.glasses} onPick={(v) => set("glasses", v)} cols={3}
          lockOf={lockOf} onLocked={onLocked} />
      </Field>
      <Field label={t("hat")}>
        <LockableGrid slot="hat" options={HATS} value={value.hat} onPick={(v) => set("hat", v)} cols={3}
          lockOf={lockOf} onLocked={onLocked} render={(id) => <PixelFace avatar={{ ...value, hat: id }} size={22} />} />
      </Field>
      <HeroGearFields value={value} onChange={onChange} />
      </div>
    </div>
      {buying && (
        <PurchaseDialog avatar={value}
          item={{ id: buying.lock.id, label: buying.lock.label, price: buying.lock.price, kind: buying.lock.kind,
                  min_level: buying.lock.min_level, unlock_level: buying.lock.unlock_level }}
          onClose={() => setBuying(null)}
          onDone={() => { const b = buying; setBuying(null); onChange({ ...value, [b.slot]: b.id }); }} />
      )}
    </div>
  );
}
