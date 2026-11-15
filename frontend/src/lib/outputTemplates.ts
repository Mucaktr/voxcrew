// Karar 12 — çıktı şablonları (paylaşımla içe aktarılan): liste, önizleme ve iş akışına uygula öncesi kalite farkı.
// Saf yardımcılar; içe aktarma yok (node --test scripts/output_templates.test.mjs doğrudan çalıştırır).

export interface OutputTemplate {
  id: string; name?: string; description?: string; format?: string;
  sections?: string[]; rules?: string[]; imported?: boolean;
}

export type QualityField = "file_type" | "required_sections" | "rules";
export interface QualityDiffRow { field: QualityField; before: string[]; after: string[]; changed: boolean }

/** Akış kalite bölümü metni: düz metin ya da {title: metin | {tr, en}} / {id} nesnesi. */
export function sectionLabel(s: unknown, lang: "tr" | "en" = "tr"): string {
  if (typeof s === "string") return s;
  if (s && typeof s === "object") {
    const o = s as { title?: unknown; id?: unknown };
    if (typeof o.title === "string") return o.title;
    if (o.title && typeof o.title === "object") {
      const t = o.title as Record<string, unknown>;
      const v = t[lang] ?? t.tr ?? t.en;
      if (typeof v === "string") return v;
    }
    if (typeof o.id === "string") return o.id;
  }
  return String(s ?? "");
}

function list(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.trim()) return [v];
  return [];
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Şablon uygulanınca akışın `quality` bloğunda değişecekler (sunucu `ShareService.apply_output` ile aynı alanlar:
 *  `required_sections` ← bölümler (eski `sections` düşer), `file_type` ← biçim (yoksa md), `rules` ← kurallar). */
export function qualityDiff(quality: unknown, tpl: OutputTemplate, lang: "tr" | "en" = "tr"): QualityDiffRow[] {
  const q = quality && typeof quality === "object" ? (quality as Record<string, unknown>) : {};
  const beforeSecs = list(q.required_sections ?? q.sections).map((s) => sectionLabel(s, lang));
  const beforeType = typeof q.file_type === "string" && q.file_type ? [q.file_type] : [];
  const beforeRules = list(q.rules).map((r) => String(r));
  const afterSecs = (tpl.sections ?? []).map(String);
  const afterType = [tpl.format || "md"];
  const afterRules = (tpl.rules ?? []).map(String);
  return [
    { field: "file_type", before: beforeType, after: afterType, changed: !same(beforeType, afterType) },
    { field: "required_sections", before: beforeSecs, after: afterSecs, changed: !same(beforeSecs, afterSecs) },
    { field: "rules", before: beforeRules, after: afterRules, changed: !same(beforeRules, afterRules) },
  ];
}

/** Kural kimliğini parçalar: `max_words:900` → {key: "max_words", n: "900"}; bilinmeyen kural aynen döner. */
export function parseRule(rule: string): { key: string; n?: string } {
  const m = /^(min|max)_(words|chars):(\d+)$/.exec(rule);
  return m ? { key: `${m[1]}_${m[2]}`, n: m[3] } : { key: rule };
}
