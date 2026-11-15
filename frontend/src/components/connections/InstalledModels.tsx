// UI-CLARITY — kurulu Ollama modelleri: sade kart (ad, boyut, 1-2 rozet) + tıklayınca ayrıntı çekmecesi.
import { ChevronRight, Cpu } from "lucide-react";
import { useState } from "react";
import { bytes } from "../../lib/format";
import { fmtNumber, useT } from "../../lib/i18n";
import type { OllamaModel } from "../../lib/types";
import { cx } from "../../locales/connections";
import { uiclMsg } from "../../locales/uiclarity";
import { Badge, DetailDrawer, SectionTitle } from "../ui";

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 py-2 border-b border-line-soft last:border-0">
      <dt className="text-xs font-semibold text-muted w-36 shrink-0">{k}</dt>
      <dd className="text-sm min-w-0 flex-1 break-words">{children}</dd>
    </div>
  );
}

export function InstalledModels({ models }: { models: OllamaModel[] }) {
  const t = useT(cx);
  const tu = useT(uiclMsg);
  const [sel, setSel] = useState<string | null>(null);
  const m = models.find((x) => x.name === sel) ?? null;
  if (models.length === 0) return null;
  const where = m ? (m.cloud ? tu("cn_m_cloud") : m.local ? tu("cn_m_local") : tu("cn_m_remote")) : "";
  return (
    <div className="mt-5 flex flex-col gap-2">
      <SectionTitle as="h3" size="sm" hint={tu("cn_installed_hint")}>{t("installed_models")}</SectionTitle>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {models.map((x) => (
          <li key={x.name} className="flex min-w-0">
            <button type="button" onClick={() => setSel(x.name)} aria-haspopup="dialog"
              className="panel-soft p-3 flex items-center gap-3 min-w-0 w-full text-left hover:border-ink-2 transition-colors">
              <span className="h-9 w-9 shrink-0 rounded-lg grid place-items-center border-2 border-line-soft bg-panel-2 text-ink-2" aria-hidden><Cpu size={16} /></span>
              <span className="min-w-0 flex-1 flex flex-col gap-1">
                <span className="font-semibold font-mono text-sm truncate">{x.name}</span>
                <span className="flex flex-wrap items-center gap-1">
                  <span className="text-xs text-muted num">{bytes(x.size_bytes)}</span>
                  {x.parameter_size && <Badge>{x.parameter_size}</Badge>}
                  {x.hermes_ready && <Badge tone="info">{t("ctx_hermes_ok")}</Badge>}
                </span>
              </span>
              <ChevronRight size={16} className="shrink-0 text-muted" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      {m && (
        <DetailDrawer open onClose={() => setSel(null)} icon={<Cpu size={18} />} title={<span className="font-mono text-lg break-all">{m.name}</span>} label={m.name}
          subtitle={`${bytes(m.size_bytes)}${m.parameter_size ? ` · ${m.parameter_size}` : ""}`}
          status={<>{m.hermes_ready && <Badge tone="info">{t("ctx_hermes_ok")}</Badge>}<Badge tone={m.local ? "ok" : "warn"}>{where}</Badge></>}>
          <dl className="flex flex-col">
            <Row k={tu("cn_m_family")}>{m.family ?? tu("cn_m_unknown")}</Row>
            <Row k={tu("cn_m_params")}>{m.parameter_size ?? tu("cn_m_unknown")}</Row>
            <Row k={tu("cn_m_quant")}>{m.quantization ?? tu("cn_m_unknown")}</Row>
            <Row k={tu("cn_m_size")}>{bytes(m.size_bytes)}</Row>
            <Row k={tu("cn_m_ctx")}>{m.num_ctx ? fmtNumber(m.num_ctx) : tu("cn_m_unknown")}</Row>
            <Row k={tu("cn_m_ctx_max")}>{m.context_max ? fmtNumber(m.context_max) : tu("cn_m_unknown")}</Row>
            <Row k={tu("cn_m_caps")}>
              <span className="flex flex-wrap gap-1">{m.capabilities.length ? m.capabilities.map((c) => <Badge key={c}>{c}</Badge>) : tu("cn_m_unknown")}</span>
            </Row>
            <Row k={tu("cn_m_where")}>{where}{m.host ? ` · ${m.host}` : ""} · {m.free ? tu("cn_m_free") : tu("cn_m_paid")}</Row>
          </dl>
        </DetailDrawer>
      )}
    </div>
  );
}
