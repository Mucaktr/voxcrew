// S29 — kenar çubuğu durum noktaları: `ready` özetini okur (ok | needs_action | unavailable | checking).
// App.tsx'teki HealthDots listesinin yerine geçmek üzere (teknik lider bağlar): <ConnectionDots />
// Yalnızca renge dayanmaz: dolu kare = hazır, üçgen işaretli = adım gerekli, içi boş = yok; ekran okuyucu metni ayrı.
import clsx from "clsx";
import { useNavigate } from "react-router-dom";
import { useConnectionStates, type ConnectionState } from "../../lib/connections";
import { useT } from "../../lib/i18n";
import { cx } from "../../locales/connections";

const SHORT: Record<ConnectionState["kind"], string> = {
  hermes: "Hermes", ollama: "Ollama", codex: "Codex", claude: "Claude", openai_compat: "OpenAI API", gemini: "Gemini",
};

export function ConnectionDots() {
  const t = useT(cx);
  const conns = useConnectionStates();
  const navigate = useNavigate();
  const shown = conns.filter((c) => c.kind !== "gemini" && (c.kind !== "openai_compat" || c.installed));
  if (!shown.length) return null;
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5" aria-label={t("dots_title")}>
      {shown.map((c) => {
        const ready = c.ready ?? (c.available ? "ok" : "unavailable");
        const label = t(`ready_${ready}` as "ready_ok");
        return (
          <li key={c.kind} className="min-w-0">
            <button type="button" onClick={() => navigate("/baglantilar")}
              title={`${c.name}: ${c.problems?.[0]?.message ?? label}`}
              className={clsx("flex items-center gap-1.5 min-w-0 text-xs font-medium w-full text-left",
                ready === "ok" ? "text-ink-2" : "text-muted")}>
              <span aria-hidden className={clsx("h-2.5 w-2.5 shrink-0 rounded-[3px]",
                ready === "ok" ? "bg-grass border border-line"
                  : ready === "needs_action" ? "bg-gold border border-line"
                    : ready === "checking" ? "border-2 border-line-soft animate-pulse"
                      : "border-2 border-bad")} />
              <span className="truncate">{SHORT[c.kind] ?? c.name}</span>
              <span className="sr-only">{label}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
