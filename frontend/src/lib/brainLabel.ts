// beyin/bağlantı kimliği → okunur ad (TR/EN). Arayüzde `openai_compat`, `profile` gibi ham kimlik
// gösterilmez. Saf modül (içe aktarma yok): `node --test scripts/qa19_fix.test.mjs` doğrudan sınar.

export type BrainLocale = "tr" | "en";

const LABELS: Record<string, { tr: string; en: string }> = {
  ollama: { tr: "Ollama", en: "Ollama" },
  codex: { tr: "Codex CLI", en: "Codex CLI" },
  claude: { tr: "Claude Code", en: "Claude Code" },
  openai_compat: { tr: "OpenAI uyumlu sunucu", en: "OpenAI-compatible server" },
  hermes: { tr: "Hermes", en: "Hermes" },
  profile: { tr: "Hermes profil ayarı", en: "Hermes profile setting" },
  gemini: { tr: "Gemini", en: "Gemini" },
  direct: { tr: "Doğrudan", en: "Direct" },
};

/** Bilinen kimlik → ad; bilinmeyen kimlik olduğu gibi (boşsa ""). */
export function brainLabel(id: string | null | undefined, locale: BrainLocale = "tr"): string {
  if (!id) return "";
  return LABELS[id]?.[locale] ?? id;
}

/** "openai_compat / mistral-small" gibi "bağlantı / model" çiftini okunur yazar. */
export function brainModelLabel(id: string | null | undefined, model: string | null | undefined,
  locale: BrainLocale = "tr"): string {
  const b = brainLabel(id, locale);
  return model ? (b ? `${b} / ${model}` : model) : b;
}
