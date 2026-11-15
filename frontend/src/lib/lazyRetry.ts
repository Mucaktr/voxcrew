/**
 * HQA-FIX — tembel yüklenen parçanın içe aktarımı ağ geçişinde (Wi-Fi yeniden bağlanma, VPN; Chrome `ERR_NETWORK_CHANGED`)
 * bir kez düşünce sayfa "Sayfa yüklenemedi" hata ekranına dönüyor, yürüyüş durumu kayboluyordu. İçe aktarım kısa aralıklarla yeniden
 * denenir; hepsi düşerse hata eskisi gibi hata sınırına gider.
*/
export const IMPORT_RETRY_MS = [400, 1200, 3000] as const;

export function retryImport<T>(load: () => Promise<T>, waits: readonly number[] = IMPORT_RETRY_MS, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))): Promise<T> {
  return load().catch(async (err: unknown) => {
    for (const ms of waits) {
      await sleep(ms);
      try { return await load(); } catch (e) { err = e; }
    }
    throw err;
  });
}
