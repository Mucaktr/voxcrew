// "Görev ver" (Ctrl+K) ajan seçimi: yedekteki ajan (koltuk dışı) önceden seçilmez ve seçilemez.
// Saf modül (içe aktarma yok): `node --test scripts/qa19_fix.test.mjs` doğrudan sınar.

export interface PickableAgent {
  slug: string;
  hidden?: boolean;
  benched?: boolean;
}

/** Ajan yedekte mi ( E1: koltuk doluyken doğan ya da değişimle yedeğe alınan)?*/
export function isBenched(a: object | null | undefined): boolean {
  return Boolean(a && (a as { benched?: unknown }).benched === true);
}

/**
 * Seçilecek ajan: `preset` etkin kadrodaysa o; değilse şu anki seçim (hâlâ etkinse); değilse ilk etkin ajan.
 * `presetBenched`: açan yer yedekteki bir ajanı istedi (arayüz bunu söyler, sessizce başkasına geçmez).
 */
export function pickComposerAgent(agents: readonly PickableAgent[], preset?: string | null,
  current?: string | null): { slug: string; presetBenched: boolean } {
  const visible = agents.filter((a) => !a.hidden);
  const active = visible.filter((a) => !isBenched(a));
  const want = preset ? visible.find((a) => a.slug === preset) : undefined;
  const presetBenched = Boolean(want && isBenched(want));
  if (want && !presetBenched) return { slug: want.slug, presetBenched };
  const cur = current ? active.find((a) => a.slug === current) : undefined;
  if (cur) return { slug: cur.slug, presetBenched };
  return { slug: active[0]?.slug ?? "", presetBenched };
}
