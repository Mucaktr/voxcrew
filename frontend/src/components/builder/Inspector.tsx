/**
 * Dünya yapıcı — ayrıntı paneli: seçili eşyanın renk/boyut alanları, döndür/kaldır; seçim yoksa dünya ayarları
 * (ad, açıklama, gökyüzü, gece, büyüme kiti, lisans) ve atmosfer listesi (bulut, kar, çiçek, gökyüzü dekoru).
 */
import { RotateCw, Trash2 } from "lucide-react";
import { useId } from "react";
import { Button, Field, Toggle } from "../ui";
import { useT } from "../../lib/i18n";
import { navAt, removePrefab, rotatePrefabAt, rotateStationAt, updatePrefab, useEditor } from "../../lib/builder";
import { builder as M } from "../../locales/builder";
import { world as WM } from "../../locales/world";
import { ATMOSPHERE, cellsOf, type Prefab } from "../../voxel/prefabs";
import { ANNEX_IDS, LICENSES, type WorldFile } from "../../voxel/worldFormat";

type ColorKey = "c" | "top" | "legs" | "glow" | "back" | "post";
const COLOR_FIELDS: Partial<Record<Prefab["t"], ColorKey[]>> = {
  cube: ["c"], flag: ["c"], sea: ["c"], crate: ["c"], bookshelf: ["c"], rock: ["c"], wall: ["c"],
  desk: ["top", "legs"], table: ["top"], sofa: ["c", "back"], lantern: ["glow", "post"], lamp: ["glow"],
};
const COLOR_LABEL: Record<ColorKey, "color" | "color_top" | "color_legs" | "color_glow" | "color_back"> = {
  c: "color", top: "color_top", legs: "color_legs", glow: "color_glow", back: "color_back", post: "color_legs",
};
const NUM_FIELDS: Partial<Record<Prefab["t"], [string, "width" | "length" | "height", number, number][]>> = {
  desk: [["w", "width", 1, 4]], wall: [["len", "length", 1, 24], ["h", "height", 1, 6]], sandbags: [["len", "length", 1, 24]],
  tree: [["h", "height", 2, 6]],
};

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <input id={id} type="color" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())}
        className="h-9 w-12 shrink-0 cursor-pointer rounded-md border-2 border-line bg-panel" />
      <label htmlFor={id} className="label">{label}</label>
      <span className="ml-auto font-mono text-xs text-muted">{value}</span>
    </div>
  );
}

function PrefabPanel({ p, idx }: { p: Prefab; idx: number }) {
  const t = useT(M);
  const apply = useEditor((s) => s.apply);
  const setE = useEditor((s) => s.set);
  const anchor = "i" in p ? [p.i, p.j] : null;
  const colors = COLOR_FIELDS[p.t] ?? [];
  const nums = NUM_FIELDS[p.t] ?? [];
  const rec = p as unknown as Record<string, unknown>;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="font-display font-semibold text-ink">{t(`type_${p.t}` as never)}</p>
        {anchor && <p className="text-xs text-muted">{t("selected_at", { i: anchor[0], j: anchor[1] })}</p>}
      </div>
      {colors.map((k) => typeof rec[k] === "string" && (
        <ColorInput key={k} label={t(COLOR_LABEL[k])} value={rec[k] as string}
          onChange={(v) => apply((w) => updatePrefab(w, idx, k === "c" && p.t === "wall" ? { c: v, colors: undefined } : { [k]: v }), `c${idx}${k}`)} />
      ))}
      {nums.map(([k, label, min, max]) => (
        <Field key={k} label={t(label)}>
          <input type="number" className="input w-24" min={min} max={max} value={rec[k] as number}
            onChange={(e) => {
              const v = Math.max(min, Math.min(max, Math.round(Number(e.target.value) || min)));
              apply((w) => updatePrefab(w, idx, { [k]: v }), `n${idx}${k}`);
            }} />
        </Field>
      ))}
      <p className="text-xs text-muted">{t("move_hint")}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon={<RotateCw size={14} />} onClick={() => apply((w) => rotatePrefabAt(w, idx))}>{t("rotate")}</Button>
        <Button size="sm" variant="danger" icon={<Trash2 size={14} />} onClick={() => { apply((w) => removePrefab(w, idx)); setE({ selected: null }); }}>{t("remove")}</Button>
      </div>
    </div>
  );
}

function WorldSettings({ world }: { world: WorldFile }) {
  const t = useT(M);
  const tw = useT(WM);
  const apply = useEditor((s) => s.apply);
  const meta = (patch: Partial<WorldFile["meta"]>, stroke: string) => apply((w) => ({ ...w, meta: { ...w.meta, ...patch } }), stroke);
  return (
    <div className="flex flex-col gap-3">
      <Field label={t("name")}>
        <input className="input" maxLength={80} value={world.meta.name} onChange={(e) => meta({ name: e.target.value }, "meta-name")} />
      </Field>
      <Field label={t("description")}>
        <textarea className="textarea" rows={2} maxLength={500} value={world.meta.description} onChange={(e) => meta({ description: e.target.value }, "meta-desc")} />
      </Field>
      <ColorInput label={t("sky")} value={world.env.sky}
        onChange={(v) => apply((w) => ({ ...w, env: { ...w.env, sky: v, swatch: [w.env.swatch[0], v] } }), "env-sky")} />
      <Toggle checked={world.env.night} label={t("night")} onChange={(v) => apply((w) => ({ ...w, env: { ...w.env, night: v } }))} />
      <Field label={t("annex")} hint={t("annex_hint")}>
        <select className="select" value={world.grid.annex} onChange={(e) => apply((w) => ({ ...w, grid: { ...w.grid, annex: e.target.value as WorldFile["grid"]["annex"] } }))}>
          {ANNEX_IDS.map((id) => <option key={id} value={id}>{tw(`scene_${id}` as never)}</option>)}
          <option value="none">{t("annex_none")}</option>
        </select>
      </Field>
      <Field label={t("license")}>
        <select className="select" value={world.meta.license} onChange={(e) => meta({ license: e.target.value as WorldFile["meta"]["license"] }, "meta-license")}>
          {LICENSES.filter((l) => (l !== "MIT" && l !== "LicenseRef-PolyForm-Shield-1.0.0") || world.meta.license === l).map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </Field>
    </div>
  );
}

export function Inspector({ world }: { world: WorldFile }) {
  const t = useT(M);
  const selected = useEditor((s) => s.selected);
  const cursor = useEditor((s) => s.cursor);
  const apply = useEditor((s) => s.apply);
  const setE = useEditor((s) => s.set);
  const p = selected != null ? world.layers.prefabs[selected] : undefined;
  const nav = navAt(world, cursor[0], cursor[1]);
  const atmos = world.layers.prefabs.map((q, k) => [q, k] as const).filter(([q]) => ATMOSPHERE.has(q.t) || (q.t === "decor" && q.free));
  return (
    <div className="flex flex-col gap-4">
      {p && selected != null && cellsOf(p).length > 0 ? <PrefabPanel p={p} idx={selected} /> : <WorldSettings world={world} />}
      {nav && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border-2 border-line-soft bg-panel-2 p-2">
          <span className="text-sm text-ink-2">{t("nav_here", { what: nav.kind === "spot" ? t("nav_spot", { kind: t(`kind_${nav.spot}` as never) }) : t(`nav_${nav.kind}` as never) })}</span>
          {nav.kind === "station" && (
            <Button size="sm" icon={<RotateCw size={14} />} onClick={() => apply((w) => rotateStationAt(w, cursor[0], cursor[1]))}>{t("rotate_station")}</Button>
          )}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <h3 className="panel-title">{t("atmosphere")}</h3>
        {!atmos.length && <p className="text-sm text-muted">{t("atmosphere_empty")}</p>}
        <ul className="flex flex-col gap-1">
          {atmos.map(([q, k]) => (
            <li key={k} className="flex items-center gap-2 text-sm">
              <span className="flex-1 min-w-0 truncate">{q.t === "decor" ? t("free_decor") : t(`type_${q.t}` as never)}</span>
              <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} aria-label={`${t("remove")}: ${q.t === "decor" ? t("free_decor") : t(`type_${q.t}` as never)}`}
                onClick={() => { apply((w) => removePrefab(w, k)); setE({ selected: null }); }} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
