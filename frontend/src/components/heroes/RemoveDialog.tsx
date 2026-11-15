// S44: kahraman ajanını kaldır — isteğe bağlı olarak hazır hafızasıyla birlikte.
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useT } from "../../lib/i18n";
import { heroesApi } from "../../lib/heroes";
import { useStudio } from "../../lib/store";
import { heroesMsg } from "../../locales/heroes";
import { Button, Modal, Spinner, Toggle } from "../ui";

export function RemoveDialog({ slug, name, onClose, onDone }: { slug: string; name: string; onClose: () => void; onDone: (msg: string) => void }) {
  const t = useT(heroesMsg);
  const refreshAgents = useStudio((s) => s.refreshAgents);
  const [memory, setMemory] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await heroesApi.remove(slug, memory);
      void refreshAgents();
      onDone(t("removed", { name }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} width={520} title={t("remove_title", { name })}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
        <Button variant="danger" icon={busy ? <Spinner /> : <Trash2 size={16} />} disabled={busy} onClick={run}>
          {busy ? t("removing") : t("remove_confirm")}
        </Button>
      </>}>
      <div className="flex flex-col gap-4">
        <p className="text-sm">{t("remove_body")}</p>
        <Toggle checked={memory} onChange={setMemory} label={t("remove_memory")} hint={t("remove_memory_hint")} />
        {error && <p role="alert" className="text-sm text-bad">{t("error", { msg: error })}</p>}
      </div>
    </Modal>
  );
}
