// AUDIT-FIX #4: her sekme kendi SSE akışını açınca HTTP/1.1'in adres başına 6 bağlantı
// sınırı dolar ve 7. sekmenin istekleri sonsuza dek sırada bekler. Burada sekmeler tek akışı paylaşır:
//  - Lider seçimi Web Locks ile (`navigator.locks`): kilidi tutan sekme lider; sekme kapanınca tarayıcı kilidi bırakır ve
//    sıradaki sekme lider olup akışı (son olay imleciyle) yeniden açar. Kalp atışı/zaman aşımı gerekmez.
//  - Yalnız lider EventSource açar; her olayı ve bağlantı durumunu BroadcastChannel ile öbür sekmelere dağıtır.
//    Gizli sekmeler de olay alır (bildirimler buna dayanır).
//  - BroadcastChannel ya da Web Locks yoksa eski davranış: sekme kendi akışını açar ("solo").
// Saf kısım (DOM yok) — scripts/sse_share.test.mjs düğüm testinde sahte kilit/kanalla sınanır.

export type SseMsg =
  | { t: "ev"; data: string; id: string }   // sunucu olayı (ham JSON metni + Last-Event-ID)
  | { t: "open"; url: string }              // akış açıldı (url: ?since= ile mi açıldı)
  | { t: "down" }                           // akış koptu
  | { t: "hello" }                          // yeni sekme: lider durumu söylesin
  | { t: "state"; connected: boolean };     // liderin yanıtı

export interface ChannelLike {
  postMessage(m: unknown): void;
  onmessage: ((e: MessageEvent) => void) | null;
  close(): void;
}

export interface LocksLike {
  request(name: string, cb: () => Promise<void>): Promise<unknown>;
}

export interface ShareOptions {
  locks?: LocksLike | null;
  channel?: ChannelLike | null;
  /** Lider (ya da solo) sekmede akışı açar; her olay/durum için `emit` çağırır, kapatma işlevi döner. */
  open: (emit: (m: SseMsg) => void) => () => void;
  /** Mesajı bu sekmede uygular (lider kendi olaylarını da buradan alır). */
  deliver: (m: SseMsg) => void;
}

export type ShareRole = "solo" | "leader" | "follower" | "stopped";

export const SSE_LOCK = "voxcrew-sse-leader";
export const SSE_CHANNEL = "voxcrew-sse";

export function shareEvents(o: ShareOptions): { role: () => ShareRole; stop: () => void } {
  let role: ShareRole = "follower";
  let close: (() => void) | null = null;
  const ch = o.locks && o.channel ? o.channel : null;
  if (!ch || !o.locks) {
    role = "solo";
    try { o.channel?.close(); } catch { /* yok say */ }
    close = o.open(o.deliver);
    return { role: () => role, stop: () => { role = "stopped"; close?.(); close = null; } };
  }
  let connected = false;
  let release: (() => void) | null = null;
  const emit = (m: SseMsg) => {
    if (m.t === "open") connected = true;
    else if (m.t === "down") connected = false;
    o.deliver(m);
    try { ch.postMessage(m); } catch { /* kanal kapandı */ }
  };
  ch.onmessage = (e) => {
    const m = e.data as SseMsg | null;
    if (!m || typeof m !== "object" || typeof m.t !== "string") return;
    if (role === "leader") {
      if (m.t === "hello") ch.postMessage({ t: "state", connected } satisfies SseMsg);
      return;
    }
    if (role === "follower" && m.t !== "hello") o.deliver(m);
  };
  ch.postMessage({ t: "hello" } satisfies SseMsg);
  void o.locks.request(SSE_LOCK, () => new Promise<void>((res) => {
    if (role === "stopped") { res(); return; }
    role = "leader";
    release = res;
    close = o.open(emit);
  })).catch(() => {
    // kilit isteği reddedildi (ör. güvenli olmayan bağlam): bu sekme kendi akışıyla devam eder
    if (role === "follower") { role = "solo"; close = o.open(o.deliver); }
  });
  return {
    role: () => role,
    stop: () => {
      role = "stopped";
      close?.(); close = null;
      release?.(); release = null;
      ch.onmessage = null;
      try { ch.close(); } catch { /* yok say */ }
    },
  };
}
