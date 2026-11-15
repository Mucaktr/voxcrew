// PANO-FIX "Başlarken" kartının verisi (GET /api/game/loop/first-session) ve tembel bileşeni. Karar listesi bu
// kanca `settled` olana dek (en çok START_WAIT_MS) bekler; ilk oturum sürüyorsa kart parçası veriyle BİRLİKTE yüklenir ki
// kart kuyrukla aynı anda çizilsin (sonradan gelip düzeni itmez). İlk oturumu tamamlanmış ya da kartı kapatılmış kurulumda
// bu tarayıcı hiç istek yapmaz (DONE_KEY / HIDE_KEY; "Kapat" Dünya'daki İlk mesai kartıyla ortak).
import { useEffect, useState, type ComponentType } from "react";
import type { FirstSession } from "../../lib/loop";
import { registerEventHandler } from "../../lib/store";

export const HIDE_KEY = "voxcrew.firstSession.hidden";
const DONE_KEY = "vc-board-start-done";
const POLL_MS = 15_000;
/** Karar listesi ilk oturum yanıtını en çok bu kadar bekler (sonra kart gelirse yine kuyruğun altına girer). */
export const START_WAIT_MS = 1500;

const read = (k: string) => { try { return window.localStorage.getItem(k) === "1"; } catch { return false; } };
export const write = (k: string) => { try { window.localStorage.setItem(k, "1"); } catch { /* gizli pencere */ } };

type Card = ComponentType<{ data: FirstSession }>;

/** İlk oturum verisi + kart bileşeni; tamamlanmış ya da gizlenmiş kurulumda hiç istek yok (`settled` hemen true). */
export function useFirstSession(): { data: FirstSession | null; settled: boolean; Card: Card | null } {
  const [skip] = useState(() => read(HIDE_KEY) || read(DONE_KEY));
  const [state, setState] = useState<{ data: FirstSession | null; settled: boolean; Card: Card | null }>(
    () => ({ data: null, settled: skip, Card: null }));
  useEffect(() => {
    if (skip) return;
    let live = true;
    let timer = 0;
    let Card: Card | null = null;
    // tek yoklama zinciri — istek sürerken gelen olay ikinci zincir açmaz; yanıttan sonra bir kez tazelenir
    let busy = false, again = false;
    const load = () => {
      if (busy) { again = true; return; }
      busy = true;
      window.clearTimeout(timer);
      // istemci de tembel: ilk oturumu bitmiş kurulumda (çoğu açılış) lib/loop parçası hiç indirilmez. Kart parçası
      // istekle PARALEL indirilir (zincir değil: kuyruk en çok bir gidiş-dönüş bekler)
      const card = Card ? Promise.resolve(Card) : import("./BoardStartCard").then((m) => m.BoardStartCard);
      import("../../lib/loop").then(({ loopApi }) => loopApi.firstSession()).then(async (d) => {
        if (d.complete) write(DONE_KEY);
        else Card = await card;
        if (!live) return;
        setState({ data: d, settled: true, Card });
        if (!d.complete) timer = window.setTimeout(load, POLL_MS);
      }).catch(() => { if (live) setState((s) => ({ ...s, settled: true })); })
        .finally(() => { busy = false; if (live && again) { again = false; load(); } });
    };
    load();
    const offs = ["acceptance.", "deliverable.", "run.finished", "run.started"].map((p) => registerEventHandler(p, load));
    return () => { live = false; window.clearTimeout(timer); offs.forEach((f) => f()); };
  }, [skip]);
  return state;
}
