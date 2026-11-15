// canlı akış birleştirme (saf; node tür ayıklamasıyla test edilir: scripts/uxfc_stream.test.mjs).
// Kök neden: motor parçayı adım çıktısına HEMEN ekler, `step.delta` olayını ~120 ms toplayıp gönderir; istemci de parçaları
// ~120 ms biriktirip uygular. Arada alınan koşu ayrıntısı (GET /api/runs/{id}: sayfa açılışı, yeniden bağlanma, bütçe
// tazelemesi) parçayı zaten içerir; ardından gelen parça yine eklenince "Görevi aldım. Görevi aldım." olur.
// Çözüm: olay parçanın çıktıdaki başlangıç konumunu (`at`) taşır; istemci parçayı o konuma koyar. Aynı olayın iki kez
// teslimi de `seq` ile ayıklanır.

/** Bir akış parçasını adım çıktısına koyar. `at` yoksa (eski olay / değiştirilmiş çıktı) eskisi gibi sona ekler. */
export function mergeDelta(cur: string, text: string, at?: unknown): string {
  if (!text) return cur;
  if (typeof at !== "number" || !Number.isInteger(at) || at < 0) return cur + text;
  if (cur.length >= at + text.length) return cur;          // anlık görüntü bu parçayı zaten içeriyor
  if (cur.length >= at) return cur.slice(0, at) + text;    // kısmen içeriyor: parça yerine konur
  return cur + text;                                       // boşluk (atılan parça): en iyi çaba, sona ekle
}

/** Koşu ayrıntısı geldiğinde çalışan adımın canlı çıktısı anlık görüntüden İLERİDEYSE (istek uçuştayken parça geldi)
 *  canlı olan korunur; aksi hâlde anlık görüntü kazanır. */
export function keepLiveOutput(live: string | null | undefined, snap: string | null | undefined): string {
  const a = live || "";
  const b = snap || "";
  return a.length > b.length && a.startsWith(b) ? a : b;
}

/** Son görülen olay sıra numaraları (sınırlı): aynı olay iki kez teslim edilirse ikincisi atılır. */
export class SeenSeq {
  private readonly set = new Set<number>();
  private readonly order: number[] = [];
  private readonly cap: number;
  constructor(cap = 4096) { this.cap = cap; }
  /** true = ilk kez görüldü (uygula); false = tekrar (at). Sıra numarası olmayan olay her zaman uygulanır. */
  first(seq: unknown): boolean {
    if (typeof seq !== "number" || !Number.isFinite(seq) || seq <= 0) return true;
    if (this.set.has(seq)) return false;
    this.set.add(seq);
    this.order.push(seq);
    if (this.order.length > this.cap) this.set.delete(this.order.shift() as number);
    return true;
  }
  clear(): void { this.set.clear(); this.order.length = 0; }
}
