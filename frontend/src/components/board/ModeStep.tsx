// DASH-MVP kurulum sihirbazı adımı "Nasıl çalışmak istersin?" (lead kararı 2:
// seçili kart YOK, geçilirse Dünya Görünümü). Radyo grubu semantiği: fieldset + legend + gerçek input[type=radio]
// (ok tuşlarıyla seçilir); seçili durum yalnız kenar rengiyle değil onay işaretiyle de. Küçük resimler statik SVG (WebGL yok).
// Seçim hemen kaydedilir (ui.mode); Pano Görünümü seçilince sihirbaz "sahne" adımını atlar.
// PANO-FIX daha önce açıkça seçilmiş görünüm (sunucuda ui.mode) sihirbaz yeniden açıldığında seçili gelir; "seçmeden
// geçersen Dünya açılır" notu yalnız hiç seçim yokken. Pano küçük resmi kırpılmaz (oranı korunur, zemin dolgulu).
import clsx from "clsx";
import { Check } from "lucide-react";
import { useId, useState } from "react";
import { useT } from "../../lib/i18n";
import { useUiMode, type UiMode } from "../../lib/uiMode";
import { viewMsg } from "../../locales/view";

function WorldThumb() {
  return (
    <svg viewBox="0 0 160 92" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <rect width="160" height="92" fill="#bfe3f5" />
      <path d="M0 70 L80 50 L160 70 L160 92 L0 92Z" fill="#6dbe45" />
      <path d="M50 58 L80 46 L110 58 L80 70Z" fill="#e8e1d3" /><path d="M50 58 L80 70 L80 84 L50 72Z" fill="#c9bfae" />
      <path d="M110 58 L80 70 L80 84 L110 72Z" fill="#b3a993" />
      <rect x="62" y="40" width="6" height="10" fill="#2f7fc4" /><rect x="88" y="38" width="6" height="10" fill="#e9a92a" />
      <rect x="62" y="34" width="6" height="6" fill="#f1c27d" /><rect x="88" y="32" width="6" height="6" fill="#ffdbac" />
    </svg>
  );
}

/** Pano küçük resmi tema belirteçleriyle (açık/koyu doğru görünür). */
function BoardThumb() {
  const v = (n: string) => `var(--${n})`;
  return (
    <svg viewBox="0 0 160 92" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" aria-hidden style={{ background: v("bg") }}>
      <rect width="160" height="92" fill={v("bg")} />
      <rect x="6" y="6" width="34" height="80" rx="3" fill={v("panel-2")} />
      {[0, 1, 2, 3].map((i) => <rect key={i} x={46 + i * 27} y="6" width="23" height="16" rx="3" fill={v("panel")} stroke={v("line-soft")} />)}
      <rect x="46" y="27" width="70" height="59" rx="3" fill={v("panel")} stroke={v("line-soft")} />
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x="50" y={33 + i * 17} width="2" height="11" fill={v("attn")} />
          <rect x="56" y={33 + i * 17} width="46" height="4" rx="2" fill={v("ink-2")} />
          <rect x="56" y={40 + i * 17} width="32" height="3" rx="1.5" fill={v("line-soft")} />
        </g>
      ))}
      <rect x="121" y="27" width="33" height="59" rx="3" fill={v("panel")} stroke={v("line-soft")} />
      {["#2f7fc4", "#7c5ce0", "#1fa9a4", "#e9a92a"].map((c, i) => (
        <g key={c}><rect x="125" y={32 + i * 13} width="7" height="7" rx="2" fill={c} /><rect x="135" y={34 + i * 13} width="15" height="3" rx="1.5" fill={v("ink-2")} /></g>
      ))}
    </svg>
  );
}

export function ModeStep() {
  const t = useT(viewMsg);
  const name = useId();
  const [picked, setPicked] = useState<UiMode | null>(() => {
    const st = useUiMode.getState();
    return st.explicit ? st.mode : null;
  });
  const error = useUiMode((s) => s.error);
  const pick = (m: UiMode) => {
    setPicked(m);
    void useUiMode.getState().setMode(m, { announce: false });
  };
  const cards: { value: UiMode; title: string; points: string[]; thumb: React.ReactNode }[] = [
    { value: "world", title: t("view_world"), points: [t("wiz_world_1"), t("wiz_world_2"), t("wiz_world_3")], thumb: <WorldThumb /> },
    { value: "board", title: t("view_board"), points: [t("wiz_board_1"), t("wiz_board_2"), t("wiz_board_3")], thumb: <BoardThumb /> },
  ];
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-2">{t("wiz_text")}</p>
      <fieldset className="grid gap-3 sm:grid-cols-2 border-0 p-0 m-0 min-w-0">
        <legend className="sr-only">{t("view_label")}</legend>
        {cards.map((c) => {
          const on = picked === c.value;
          return (
            <label key={c.value} className={clsx("relative flex flex-col gap-2 rounded-xl p-3.5 cursor-pointer transition-colors border-[1.5px] min-w-0",
              "has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[color:var(--focus)]",
              on ? "border-primary bg-panel shadow-[0_0_0_1px_var(--primary)]" : "border-line-soft bg-panel-2 hover:border-line-field")}>
              <input type="radio" name={name} value={c.value} checked={on} onChange={() => pick(c.value)} className="sr-only"
                aria-labelledby={`${name}-${c.value}`} aria-describedby={`${name}-${c.value}-d`} />
              <span aria-hidden className={clsx("absolute top-3 right-3 grid place-items-center h-5 w-5 rounded-full border-[1.5px]",
                on ? "bg-primary border-primary text-[color:var(--on-primary)]" : "bg-panel border-line-field")}>
                {on && <Check size={13} strokeWidth={3} />}
              </span>
              <span className="block h-[92px] rounded-lg border border-line-soft overflow-hidden">{c.thumb}</span>
              <span id={`${name}-${c.value}`} className="font-display text-lg font-semibold">{c.title}</span>
              <ul id={`${name}-${c.value}-d`} className="list-disc pl-4 text-dense text-ink-2 flex flex-col gap-0.5">
                {c.points.map((p) => <li key={p}>{p}</li>)}
              </ul>
            </label>
          );
        })}
      </fieldset>
      <p className="text-xs text-muted" role="status">
        {picked === "board" ? t("wiz_chosen_board") : picked === "world" ? t("wiz_chosen_world") : t("wiz_skip_note")}
      </p>
      {error && <p role="alert" className="text-xs font-semibold text-bad">{t("switch_failed", { error })}</p>}
    </div>
  );
}
