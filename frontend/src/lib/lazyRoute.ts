// UXF-A — dayanıklı tembel parçalar. Ağ ya da sunucu bir sayfa parçasını (ör. `RunsPage-*.js`) indirirken düşerse
// React.lazy reddedilen sözü önbelleğe alır ve hata kökten yukarı çıkıp tüm uygulamayı söküyordu (kabuk dahil bomboş ekran).
//  - `importWithRetry`: parça hatasında bir kez, kısa bir beklemeyle kendiliğinden yeniden dener (başka hatalar beklemeden geçer).
//  - `lazyRoute`: React.lazy gibi kullanılır; yükleme reddedilirse hata sınıra gider ve sınır sıfırlanınca (`resetLazyRoutes`:
//    "Tekrar dene" ya da rota değişimi) TAZE bir lazy kurulur — parça gerçekten yeniden istenir, eski red yeniden fırlatılmaz.
//    Sıfırlamadan önce aynı (reddedilmiş) lazy kalır: React'in hata sonrası yeniden çizimi yeni bir istek başlatıp askıya
//    düşmesin (geçişte eski sayfa görünür kalıp sonsuz istek döngüsü olurdu).
//  - `isChunkError` / `chunkUrlOf` / `probeChunk`: hatayı sınıflar — ağ yok (çevrimdışı ya da sunucu kapalı) mı, yoksa yeni bir
//    derlemeden sonra eski karma adlı parça artık yok mu (404 → sayfayı yenile önerisi).
import { createElement, lazy, type ComponentType } from "react";

const CHUNK_RE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Failed to load module script|ChunkLoadError|Loading (?:CSS )?chunk [\w-]+ failed/i;

/** Dinamik içe aktarma / parça yükleme hatası mı (tarayıcıdan bağımsız iletiler). */
export function isChunkError(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e ?? "");
  return CHUNK_RE.test(msg);
}

/** Hata iletisindeki parça adresi (tam URL ya da kök göreli yol); yoksa null. */
export function chunkUrlOf(e: unknown): string | null {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  const m = /https?:\/\/[^\s'"]+?\.(?:m?js|css|tsx?)\b|(?:\/[\w.@~-]+)+\.(?:m?js|css|tsx?)\b/.exec(msg);
  return m ? m[0] : null;
}

/** Kendiliğinden yeniden denemeden önceki bekleme (ms); n. denemede n katı. */
export const RETRY_DELAY_MS = 700;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Parça hatasında `retries` kez (varsayılan 1) kısa beklemeyle yeniden dener; başka hatalar hemen geçer. */
export async function importWithRetry<T>(load: () => Promise<T>,
  { retries = 1, delayMs = RETRY_DELAY_MS, wait = sleep }: { retries?: number; delayMs?: number; wait?: (ms: number) => Promise<void> } = {}): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await load();
    } catch (e) {
      if (i >= retries || !isChunkError(e)) throw e;
      await wait(delayMs * (i + 1));
    }
  }
}

/**
 * React.lazy'nin yeniden denenebilir hâli (App.tsx'te `lazy` adıyla içe aktarılır). Yükleme (otomatik yeniden denemeden sonra
 * da) reddedilirse hata sınırına gider ve sarmalayıcı bir sonraki çizim için yeni bir lazy kurar.
 */
let resetGen = 0;
/** Hata sınırı sıfırlanınca çağrılır: reddedilmiş tembel parçalar bir sonraki çizimde yeniden istenir. */
export function resetLazyRoutes(): void { resetGen++; }

export function lazyRoute<T extends ComponentType<any>>(load: () => Promise<{ default: T }>): T { // eslint-disable-line @typescript-eslint/no-explicit-any
  let failedAt = -1;
  const make = () => lazy(() => importWithRetry(load).catch((e: unknown) => { failedAt = resetGen; throw e; }));
  let current = make();
  const Route = (props: object) => {
    if (failedAt !== -1 && failedAt !== resetGen) { current = make(); failedAt = -1; }
    return createElement(current as unknown as ComponentType<object>, props);
  };
  return Route as unknown as T;
}

export type ChunkFailure = "offline" | "stale" | "error";

/**
 * Hata türü: parça değilse "error" (sayfa içi hata). Parça hatasında tarayıcı çevrimdışıysa "offline"; değilse parçanın adresi
 * önbelleksiz yoklanır — 404 ya da HTML yanıtı = derleme değişmiş, eski parça yok ("stale"); ağ hatası/5xx = "offline".
 */
export async function probeChunk(e: unknown, opts: { online?: boolean; fetcher?: typeof fetch } = {}): Promise<ChunkFailure> {
  if (!isChunkError(e)) return "error";
  const online = opts.online ?? (typeof navigator === "undefined" ? true : navigator.onLine);
  if (!online) return "offline";
  const url = chunkUrlOf(e);
  const f = opts.fetcher ?? (typeof fetch === "undefined" ? null : fetch);
  if (!url || !f) return "offline";
  try {
    const r = await f(url, { method: "HEAD", cache: "no-store" });
    if (r.status === 404 || r.status === 410) return "stale";
    if (r.ok && /text\/html/i.test(r.headers.get("content-type") ?? "")) return "stale";
    return "offline";
  } catch {
    return "offline";
  }
}
