// sunucuya ulaşılabiliyor mu? Kenar çubuğu durum noktası yalnız canlı akışa (SSE) bakınca, sunucu kapanınca da
// "Canlı" kalabiliyordu. Bu tek kaynak iki yerden beslenir: (1) api isteği ağ hatası / vekil 502-504 aldı, (2) düzenli
// /api/health yoklaması. İkisi de aynı bayrağı yazar; durum noktası `up === false` ise "Bağlantı yok" der.
import { useEffect } from "react";
import { create } from "zustand";

export const useServerUp = create<{ up: boolean }>(() => ({ up: true }));

export function reportServerUp(up: boolean): void {
  if (useServerUp.getState().up !== up) useServerUp.setState({ up });
}

const POLL_MS = 8000;

async function ping(): Promise<void> {
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    reportServerUp(res.ok);
  } catch {
    reportServerUp(false);
  }
}

/** Uygulama kabuğunda bir kez çağrılır: sekme görünürken düzenli yoklar. */
export function useServerPoll(): void {
  useEffect(() => {
    const tick = () => { if (typeof document === "undefined" || document.visibilityState === "visible") void ping(); };
    const id = window.setInterval(tick, POLL_MS);
    return () => window.clearInterval(id);
  }, []);
}
