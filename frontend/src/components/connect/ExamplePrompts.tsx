// Ekip S11 — Claude Code / Codex oturumunda kullanılabilecek örnek istemler.
import { MessageSquareText } from "lucide-react";
import { CLIENT_NAMES, type ClientId } from "../../lib/clients";
import { useT } from "../../lib/i18n";
import { connect as m } from "../../locales/connect";
import { Panel } from "../ui";
import { CopyBlock } from "./CopyBlock";

export function ExamplePrompts({ client, examples }: { client: ClientId; examples: string[] }) {
  const t = useT(m);
  return (
    <Panel title={t("examples_title")} icon={<MessageSquareText size={18} />}>
      <p className="text-sm text-ink-2 mb-2">{t("examples_intro", { name: CLIENT_NAMES[client] })}</p>
      <div className="flex flex-col gap-2">
        {examples.map((e, i) => <CopyBlock key={e} text={e} label={t("example_n", { n: i + 1 })} mono={false} />)}
      </div>
    </Panel>
  );
}
