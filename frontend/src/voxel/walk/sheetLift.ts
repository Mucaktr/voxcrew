// FrameLift.tsx'in saf hesabı (içe aktarma yok; node --test doğrudan yükler).

/**
 * Kaydırma (px, yukarı): avatarın kaydırmasız ekran kutusu [`top`, `bottom`] (kanvasa göre) örten öğenin üst kenarına (`sheetTop`)
 * `margin` kadar yaklaşmasın. Baş üst bandın (`barBottom`) altında kalır; en çok kanvas yüksekliğinin %45'i. Örten yoksa 0.
 */
export function frameLift(top: number, bottom: number, sheetTop: number | null, barBottom: number, h: number, margin = 12): number {
  if (sheetTop == null || !(h > 0) || bottom + margin <= sheetTop) return 0;
  const need = bottom + margin - sheetTop;
  return Math.max(0, Math.round(Math.min(need, top - barBottom - 4, h * 0.45)));
}
