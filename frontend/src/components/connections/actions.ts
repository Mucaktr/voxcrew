// S29 — kart eylemleri: tek yerde mantık (sihirbaz, Bağlantılar ve Hermes sayfası aynı kancayı kullanır).
import { useCallback, useState } from "react";
import { connectionsApi, publishOne, publishStates, refreshConnections, type ConnectionState, type Fix, type TestResult } from "../../lib/connections";
import { tx } from "../../lib/i18n";
import { cx } from "../../locales/connections";

export type ModalKind = "models" | "hermes_home" | "openai_compat" | "gateway" | "install" | null;

export interface ActionFeedback { kind: "ok" | "warn" | "bad" | "info"; text: string; provider?: string }

export function useConnectionActions(openModal: (m: ModalKind, args?: Record<string, unknown>) => void) {
  const [busy, setBusy] = useState<string | null>(null);           // "<kind>:<action>"
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const [tests, setTests] = useState<Record<string, TestResult>>({});

  const run = useCallback(async (c: ConnectionState, fix: Fix | null | undefined, actionOverride?: string) => {
    const action = actionOverride ?? fix?.action;
    // SETUP: kurulum rehberi olan bağlantı uygulama içinde adım adım kartı açar (dış adres kartta, kaynaklarla)
    if (fix?.kind === "link" && fix.guide) { openModal("install", { kind: fix.guide }); return; }
    if (fix?.kind === "link" && fix.url) { window.open(fix.url, "_blank", "noopener"); return; }
    if (fix?.kind === "command" && fix.command) {
      try { await navigator.clipboard?.writeText(fix.command); setFeedback({ kind: "info", text: `${tx(cx, "copied")}: ${fix.command}`, provider: c.kind }); }
      catch { setFeedback({ kind: "info", text: fix.command, provider: c.kind }); }
      return;
    }
    if (!action) return;
    const key = `${c.kind}:${action}`;
    setBusy(key);
    setFeedback(null);
    try {
      switch (action) {
        case "rescan":
          publishStates(await connectionsApi.rescan(3));
          break;
        case "ollama.start":
          publishOne((await connectionsApi.ollamaStart()).state);
          await refreshConnections(true);
          break;
        case "ollama.stop":
          await connectionsApi.ollamaStop();
          await refreshConnections(true);
          break;
        case "ollama.pick_model":
          openModal("models");
          break;
        case "hermes.apply_home": {
          // önizle → onayla: seçici, önerilen klasör için önce neyin değişeceğini gösterir; kullanıcı onaylayınca yazar
          const path = String(fix?.args?.path ?? "");
          openModal("hermes_home", path ? { path } : undefined);
          break;
        }
        case "hermes.pick_home":
          openModal("hermes_home");
          break;
        case "hermes.enable_api":
        case "hermes.start_gateway":
          openModal("gateway");
          break;
        case "codex.login":
        case "claude.login": {
          const res = await connectionsApi.login(c.kind);
          setFeedback({ kind: res.opened ? "info" : "warn", provider: c.kind,
            text: (res.opened ? tx(cx, "login_opened", { cmd: res.shown }) : tx(cx, "login_manual", { cmd: res.command })) + " " + tx(cx, "login_next") });
          break;
        }
        case "openai_compat.configure": {
          const base_url = String(fix?.args?.base_url ?? "");
          if (!base_url) { openModal("openai_compat"); break; }
          // S37: keşfedilen yerel sunucu adlandırılmış bir API bağlantısı olarak eklenir (varsa var olanlara dokunmaz)
          publishOne((await connectionsApi.addEndpoint({ base_url, label: String(fix?.args?.label ?? "") || undefined, make_default: true })).state);
          await refreshConnections(true);
          break;
        }
        case "openai_compat.edit":
        case "openai_compat.pick":
          openModal("openai_compat", fix?.args);
          break;
        default:
          if (action.endsWith(".test") || action === "test") {
            const res = await connectionsApi.test(c.kind, fix?.args ?? {});
            setTests((t) => ({ ...t, [c.kind]: res }));
            await refreshConnections(false);
          }
      }
    } catch (e) {
      setFeedback({ kind: "bad", text: e instanceof Error ? e.message : String(e), provider: c.kind });
    } finally {
      setBusy(null);
    }
  }, [openModal]);

  return { run, busy, feedback, setFeedback, tests };
}

/** Birincil eylem: ilk engelleyen sorunun düzeltmesi; hazırsa "Test et"; yakında ise yok. */
export function primaryFix(c: ConnectionState): { fix: Fix | null; action: string; label: string } | null {
  if (c.ready === "soon") return null;
  const blocking = c.problems.find((p) => p.severity === "block" && p.fix) ?? c.problems.find((p) => p.fix && p.severity !== "info");
  if (blocking?.fix) return { fix: blocking.fix, action: blocking.fix.action ?? blocking.fix.kind, label: blocking.fix.label };
  if (c.ready === "ok" && c.kind !== "gemini") return { fix: null, action: `${c.kind}.test`, label: tx(cx, "test") };
  const info = c.problems.find((p) => p.fix);
  if (info?.fix) return { fix: info.fix, action: info.fix.action ?? info.fix.kind, label: info.fix.label };
  return null;
}
