/**
 * W3 (WALK-UX) — dünya nesnesi paneli: çıktı panosu (son çıktılar, "Al" → parşömen taşı),
 * kahve makinesi (kendine kahve: ücretsiz, kozmetik · "ısmarla" → GiftDialog), oturma yeri ("Otur"), olta yeri, masa oyunu
 * ve atış masası (WALK-FUN mini oyunları; yerel, model/token/jeton yok). Hiçbiri yakınlıkla kendiliğinden tetiklenmez.
*/
import { Coffee, Gift, Armchair, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { deliverablesApi, type Deliverable } from "../../../lib/deliverables";
import { useT } from "../../../lib/i18n";
import { useStudio } from "../../../lib/store";
import { walk as WM } from "../../../locales/walk";
import { useWalkCarry, useWalkNearby, walkRuntime } from "../../../voxel/walk/walkStore";
import { GIFTS_ENABLED, GiftDialog } from "../../../full/worldGifts"; // EDITION1: free sürümde takdir yok
import { Button, Spinner } from "../../ui";
import { fun } from "./funBridge";
import { mgInRange, minigameForEntity, type MinigameDef } from "../../../voxel/fun/minigames";
import { MINIGAME_ICONS } from "./minigame/registry";
import { entityTypeOf, walkEntity, type WalkEntityType } from "./entities";
import { PanelShell } from "./PanelShell";
import { DeliverableList, type T } from "./TalkPanel";
import { walkRunStarted } from "./walkEvents";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const entityLabelKey = (type: WalkEntityType) => `ent_${type}` as const;

export function EntityPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT(WM);
  const type = entityTypeOf(id);
  if (!type) return null;
  const name = t(entityLabelKey(type));
  const game = minigameForEntity(type);   // olta yeri, masa oyunu, atış masası (kayıttan)
  return (
    <PanelShell label={t("ent_aria", { name })} closeLabel={t("talk_close")} onClose={onClose}
      title={<span className="font-display font-semibold truncate block">{name}</span>}>
      {type === "board" && <BoardBody t={t} />}
      {type === "coffee" && <CoffeeBody t={t} />}
      {type === "bench" && <BenchBody id={id} t={t} onClose={onClose} />}
      {game && <GameBody id={id} game={game} t={t} onClose={onClose} />}
    </PanelShell>
  );
}

function BoardBody({ t }: { t: T }) {
  const [items, setItems] = useState<Deliverable[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const carry = useWalkCarry();
  useEffect(() => {
    let alive = true;
    deliverablesApi.list({ limit: 8 })
      .then((r) => { if (alive) setItems(r.items); })
      .catch((e) => { if (alive) setError(errText(e)); });
    return () => { alive = false; };
  }, []);
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-ink-2">{t("board_text")}</p>
      {error ? <p role="alert" className="text-bad">{t("load_error", { error })}</p>
        : !items ? <p className="text-muted flex items-center gap-2"><Spinner />{t("loading")}</p>
        : !items.length ? <p className="text-muted">{t("out_none")}</p>
        : <DeliverableList items={items} t={t} carryId={carry?.deliverableId ?? null} />}
      {carry && <p role="status" className="text-xs text-ink-2">{t("carry_hint")}</p>}
    </div>
  );
}

function CoffeeBody({ t }: { t: T }) {
  const nearby = useWalkNearby();
  const agents = useStudio((s) => s.agents);
  const near = useMemo(() => nearby.filter((n) => n.kind === "agent").map((n) => agents.find((a) => a.slug === n.id)).filter((a) => !!a),
    [nearby, agents]);
  const [who, setWho] = useState("");
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const target = near.find((a) => a.slug === who) ?? near[0];
  const openComposer = useStudio((s) => s.openComposer);
  // FIX-UX: kahve noktasından görev — pencere aynı TaskComposer (gönderim kullanıcının tıklaması); koşu başlarsa
  // `run_started` (kafeden_gorev). Sunucu koşunun gerçek, arayüzden ve yeni olduğunu doğrular.
  const task = () => openComposer(target?.slug, { onStarted: (runId) => { void walkRunStarted(runId); } });
  const getCoffee = () => {
    if (!fun.self("coffee")) walkRuntime.sip = performance.now() + 3000;
    setDone(true);
  };
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-col gap-1">
        <Button variant="primary" className="self-start min-h-11" icon={<Coffee size={15} />} onClick={getCoffee}>{t("coffee_get")}</Button>
        <span className="text-xs text-ink-2">{t("coffee_get_hint")}</span>
        {done && <span role="status" className="text-xs font-semibold text-ok">{t("coffee_had")}</span>}
      </div>
      <div className="flex flex-col gap-1">
        <Button className="self-start min-h-11" icon={<Send size={15} />} onClick={task}>{t("coffee_task")}</Button>
        <span className="text-xs text-ink-2">{t("coffee_task_hint")}</span>
      </div>
      {GIFTS_ENABLED && <div className="panel-soft p-2.5 rounded-lg flex flex-col gap-2">
        <span className="font-semibold">{t("coffee_treat")}</span>
        {!near.length ? <p className="text-muted">{t("coffee_none")}</p> : (
          <>
            {near.length > 1 && (
              <select className="select min-h-11" aria-label={t("coffee_treat")} value={target?.slug ?? ""} onChange={(e) => setWho(e.target.value)}>
                {near.map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}
              </select>
            )}
            <Button className="self-start min-h-11" icon={<Gift size={15} />} onClick={() => setOpen(true)}>
              {near.length === 1 ? `${t("coffee_treat")}: ${near[0].name}` : t("coffee_treat")}
            </Button>
          </>
        )}
      </div>}
      {target && <GiftDialog agent={target} open={open} onClose={() => setOpen(false)} onGiven={(kind) => { fun.gift(target.slug, kind); }} />}
    </div>
  );
}

function BenchBody({ id, t, onClose }: { id: string; t: T; onClose: () => void }) {
  const sit = () => {
    const e = walkEntity(id);
    if (!e || !e.pose) return;
    walkRuntime.sit = { pose: e.pose, x: e.x, z: e.z, heading: e.face ?? 0, ...(e.seatY != null ? { y: e.seatY } : {}) };
    onClose();
  };
  return (
    <div className="flex flex-col gap-2 text-sm">
      <Button variant="primary" className="self-start min-h-11" icon={<Armchair size={15} />} onClick={sit}>{t("bench_sit")}</Button>
      <p className="text-xs text-ink-2">{t("bench_hint")}</p>
    </div>
  );
}

function GameBody({ id, game, t, onClose }: { id: string; game: MinigameDef; t: T; onClose: () => void }) {
  const [fail, setFail] = useState(false);
  const kind = game.kind;
  // avatar nesneye yaklaşana dek düğme kapalı ("Varınca"); varış 4 Hz yoklanır
  const near = () => { const e = walkEntity(id); return !e || mgInRange(walkRuntime.avatar, e); };
  const [arrived, setArrived] = useState(near);
  useEffect(() => {
    setArrived(near());
    const iv = window.setInterval(() => setArrived(near()), 250);
    return () => window.clearInterval(iv);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const start = () => {
    if (!arrived) return;
    const e = walkEntity(id);
    if (!e) { setFail(true); return; }
    // HQA-FIX: düğmenin adı eylemin kendisi ("Oltayı at") — oyun açılır ve olta hemen atılır; eskiden yalnız oyun açılıyor,
    // aynı adlı ikinci düğme bekleniyordu, şamandıra olta ucunda (kaldırım/tezgâh üstünde) asılı kalıyordu
    const ok = fun.startMinigame(kind, { id, x: e.x, z: e.z, tile: [e.tile[0], e.tile[1]], go: kind === "fishing" });
    if (ok) onClose(); else setFail(true);
  };
  const Icon = MINIGAME_ICONS[kind].start;
  const icon = <Icon size={15} />;
  const label = t(game.locale.start as Parameters<T>[0]);
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-ink-2">{t("mg_text")}</p>
      <Button variant="primary" className="self-start min-h-11" icon={icon} onClick={start} aria-disabled={!arrived || undefined}
        aria-describedby={arrived ? undefined : `${id}-mg-far`} data-mg-far={arrived ? undefined : ""}
        title={arrived ? undefined : t("mg_far_btn")}>{arrived ? label : t("mg_far_btn")}</Button>
      {!arrived && <p id={`${id}-mg-far`} role="status" className="text-xs text-ink-2">{t("mg_far_hint")}</p>}
      {fail && <p role="status" className="text-xs font-semibold text-muted">{t("mg_unavailable")}</p>}
    </div>
  );
}
