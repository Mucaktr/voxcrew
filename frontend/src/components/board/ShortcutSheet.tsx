// DASH-MVP klavye kısayolları penceresi. Var olan Modal: odak tuzağı,
// Esc ve odağı açan düğmeye geri verme. Global tek harfli kısayol eklenmez; onay/ret için tuş yoktur.
import { useT } from "../../lib/i18n";
import { boardDetailMsg } from "../../locales/boardDetail";
import { Button, Modal } from "../ui";

export function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT(boardDetailMsg);
  const rows: [string[], string][] = [
    [["Ctrl", "K"], t("sc_compose")],
    [["↓", "J"], t("sc_next")],
    [["↑", "K"], t("sc_prev")],
    [["Home", "End"], t("sc_ends")],
    [["Enter"], t("sc_enter")],
    [["Esc"], t("sc_esc")],
  ];
  return (
    <Modal open={open} onClose={onClose} title={t("sc_title")} width={480}
      footer={<Button variant="primary" onClick={onClose}>{t("sc_ok")}</Button>}>
      <div className="flex flex-col gap-4">
        <dl className="bd-keys">
          {rows.map(([keys, label]) => (
            <div key={label} className="contents">
              <dt>{keys.map((k) => <kbd key={k} className="kbd">{k}</kbd>)}</dt>
              <dd>{label}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-ink-2">{t("sc_note")}</p>
      </div>
    </Modal>
  );
}
