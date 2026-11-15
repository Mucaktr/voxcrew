// S44: kahramanın önerilen beyni — sunucunun zinciri + canlı bağlantı durumu (ConnectionService) + model izinleri (S37).
import { useMemo } from "react";
import { connOf, endpointsOf, useConnectionStates, type ProviderKind } from "../../lib/connections";
import type { BrainKind, HeroBrain } from "../../lib/heroes";
import { decide, usePolicyView } from "../../lib/modelPolicy";

export interface BrainView { pick: BrainKind; state: "ready" | "setup" | "blocked"; chain: BrainKind[] }

export function useHeroBrain(brain: HeroBrain): BrainView {
  const conns = useConnectionStates();
  const view = usePolicyView();
  return useMemo(() => {
    const endpoints = endpointsOf(connOf(conns, "openai_compat"));
    const allowed = (k: BrainKind) => !brain.blocked.includes(k) &&
      decide(view, k === "hermes" ? "profile" : k, null, { endpoints }).allowed;
    if (conns.length) {
      for (const k of brain.chain) {
        const st = connOf(conns, k as ProviderKind);
        if (st?.ready === "ok" && allowed(k)) return { pick: k, state: "ready", chain: brain.chain };
      }
    }
    const pick = brain.pick;
    if (!allowed(pick)) return { pick, state: "blocked", chain: brain.chain };
    return { pick, state: brain.ready && !conns.length ? "ready" : "setup", chain: brain.chain };
  }, [conns, view, brain]);
}
