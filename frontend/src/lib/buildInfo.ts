// STALE-DIST — sunulan arayüz derlemesi kaynak koddan eskiyse kapatılabilir uyarı bandı (bileşen: components/StaleBuildBanner).
// Sunucu: GET /api/meta/build (backend/studio/buildinfo.py). Bu dosya saf mantıktır (içe aktarma yok; node --test ile denenir).

export interface BuildMeta {
  stale: boolean;
  built_commit: string | null;
  source_commit: string | null;
  behind: number | null;
  built_at?: string | null;
  method?: string;
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Sunucu yanıtını doğrular; biçim bozuksa null (bant gösterilmez: yanlış alarm, kaçan alarmdan kötüdür). */
export function parseBuildMeta(raw: unknown): BuildMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.stale !== "boolean") return null;
  const behind = typeof o.behind === "number" && Number.isInteger(o.behind) && o.behind >= 0 ? o.behind : null;
  return {
    stale: o.stale, built_commit: str(o.built_commit), source_commit: str(o.source_commit), behind,
    built_at: str(o.built_at), method: str(o.method) ?? undefined,
  };
}

/** Kapatma anahtarı: aynı eski derleme + aynı kaynak için bir kez kapatılır; kaynak ya da derleme değişince bant yeniden çıkar. */
export function dismissKey(meta: BuildMeta): string {
  return `${meta.built_commit ?? meta.built_at ?? "?"}..${meta.source_commit ?? "?"}`;
}

/** Bant görünür mü? Geliştirme sunucusunda (Vite, kaynaktan canlı) gösterilmez: orada dist sunulmaz. */
export function showStaleBanner(meta: BuildMeta | null, opts: { dev: boolean; dismissed: string | null }): boolean {
  if (!meta || opts.dev || meta.stale !== true) return false;
  return opts.dismissed !== dismissKey(meta);
}

/** Yeniden derleme komutu: tarayıcı sunucuyla aynı makinededir (yerel-yalnız), işletim sistemi kullanıcı ajanından okunur. */
export function rebuildCommand(userAgent: string): string {
  return /windows/i.test(userAgent) ? "start.ps1 -Rebuild" : "./start.sh --rebuild";
}

export const DISMISS_STORAGE_KEY = "vc-stale-build-dismissed";
