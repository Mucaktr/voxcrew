/**
 * W3 (WALK-FUN) — mini oyun HUD'u: olta, üç taş (masa oyunu), atış. WalkHud içinde bağlanır.
 *
 * Yerel ve deterministik (voxel/fun/minigameLogic.ts): model çağrısı, token ve XP yok; ödül kozmetik koleksiyon kartı (bu
 * tarayıcıda). WORLD-FIX: olta yakalaması sunucu yetkili jeton verir (voxel/fun/fishing.ts + /api/walk/fish/*). Klavye: oyun açıkken Boşluk/Enter/oklar/Esc ve yürüme tuşları burada yakalanır (pencere yakalama evresi), yürüme
 * modunun Esc'si oyunu kapatır, moddan çıkmaz. Hareket azaltmada olta tek tuş, güç çubuğu adımlı; animasyonlu geçiş yok.
 * 375 px'te tek sütun, dokunma hedefleri ≥ 44 px, `aria-live` durum metni.
 *
 * oyun seçimi kayıttan (`MINIGAMES` başlık/metin anahtarı, `MINIGAME_ICONS`, `GAMES` HUD bileşeni). Olta jetonu ve bugünkü
 * sayaç TEK günlük mini oyun havuzundan; vuruş anı sunucuda kalır, ipucu `/api/walk/fish/bite` işaretiyle başlar.
*/
import clsx from "clsx";
import { X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useT } from "../../../../lib/i18n";
import { walk as WM } from "../../../../locales/walk";
import { minigameMsg as MGL } from "../../../../locales/minigame";
import {
  agentMove, ALL_CARDS, BOARD_SECONDS, biomeOf, collectionSize, EMPTY_BOARD, FISH_ASSIST_WINDOW_MS, FISH_BY_ID, FISH_WINDOW_MS, fishRound, fishTier, fishWater, place, powerAt, rng, seedOf, tossScore,
  tossTarget, winner, type Board, type TossResult,
} from "../../../../voxel/fun/minigameLogic";
import { CUE_TIMEOUT_MS, cueNext, fishAction, fishStep, initialFish, isResult, lineTension, SERVER_CUE, type FishEvent, type FishState } from "../../../../voxel/fun/fishing";
import { walkApi, type CueResult } from "../../../../lib/walk";
import { useGame } from "../../../../lib/game";
import { useWalkStore, walkRuntime } from "../../../../voxel/walk/walkStore";
import {
  grantCard, leaveMinigameWalking, mgActor, mgFocus, mgKeyRoute, MINIGAME_BY_KIND, returnWorldFocus, stopMinigame, useCards, useMinigame, walkedAway, type MgSpot, type MinigameKind,
} from "../../../../voxel/fun/minigames";
import { MINIGAME_ICONS } from "./registry";
import { reducedMotion, useReducedMotion } from "../../../../voxel/motion";

type T = ReturnType<typeof useT<typeof WM.tr>>;
type Key = Parameters<T>[0];
const k = (s: string) => s as Key;

/** Oyun açıkken yakalanan tuşlar: oyun tuşları ve yürüme/etkileşim (avatar yerinde kalır). Kamera (Q/E, +/−, V) serbest. */
const CAPTURE = new Set([" ", "Enter", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "a", "s", "d", "W", "A", "S", "D", "f", "F", "y", "Y"]);

/** Düzenden bağımsız tuş (W5-POLISH): fiziksel tuş (`code`) önce — AZERTY/TR-F'de WASD yürüme gibi yakalanır.*/
const CODE_KEY: Record<string, string> = {
  KeyW: "w", KeyA: "a", KeyS: "s", KeyD: "d", KeyF: "f", KeyY: "y", Space: " ", Enter: "Enter", NumpadEnter: "Enter", Escape: "Escape",
  ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight",
};
const mgKey = (e: { key: string; code?: string }) => (e.code && CODE_KEY[e.code]) || e.key;

interface MgKeyEvent { key: string; repeat: boolean }
/** `idle`: FISH-FIX — oyun boşta (tur sürmüyor, yürüme tuşu oyun tuşu değil): yürüme tuşu oyunu kapatıp yürütür (`mgKeyRoute`). */
interface Keys { down?: (e: MgKeyEvent) => void; up?: (e: MgKeyEvent) => void; idle?: () => boolean }

/** tür → HUD gövdesi (kayıt sütunu; `Record` her oyun için zorunlu kılar).*/
interface GameProps { spot: MgSpot; t: T; keys: React.MutableRefObject<Keys>; opponent: { name: string } | null }
const GAMES: Readonly<Record<MinigameKind, (p: GameProps) => React.ReactNode>> = {
  fishing: (p) => <FishingGame spot={p.spot} t={p.t} keys={p.keys} />,
  board: (p) => <BoardGame spot={p.spot} t={p.t} keys={p.keys} name={p.opponent?.name ?? "?"} />,
  toss: (p) => <TossGame spot={p.spot} t={p.t} keys={p.keys} />,
};

export function MinigameHud({ onFocusWorld }: { onFocusWorld?: () => void } = {}) {
  const kind = useMinigame((s) => s.kind);
  const spot = useMinigame((s) => s.spot);
  const opponent = useMinigame((s) => s.opponent);
  const t = useT(WM);
  const titleId = useId();
  const keys = useRef<Keys>({});
  const panel = useRef<HTMLDivElement>(null);
  const cards = useCards((s) => s.cards);

  // FISH-FIX: kapanışta odak dünyaya döner (minigames.ts `stopMinigame` → `returnWorldFocus`; WASD yalnız dünya kabında çalışır)
  useEffect(() => {
    mgFocus.world = onFocusWorld ?? null;
    return () => { if (mgFocus.world === onFocusWorld) mgFocus.world = null; };
  }, [onFocusWorld]);

  useEffect(() => {
    if (!kind) return;
    const down = (e: KeyboardEvent) => {
      // oyun kapandı ama dinleyici henüz sökülmedi (aynı karede): tuş dünyaya kalsın
      if (!useMinigame.getState().kind) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = mgKey(e);
      if (!CAPTURE.has(key)) return;
      const el = e.target as HTMLElement | null;
      // Kapat / Tekrar düğmesinde Enter ve Boşluk düğmenin kendisine kalır
      if ((key === "Enter" || key === " ") && el?.dataset?.mgNative) return;
      e.preventDefault(); e.stopPropagation();
      const route = mgKeyRoute(key, keys.current.idle?.());
      if (route === "close") { stopMinigame(); return; }
      // FISH-FIX: oyun boştayken yürüme tuşu oyunu kapatır; odak dünyaya döner, aynı basış dünyada yürümeyi başlatır
      if (route === "leave") { leaveMinigameWalking(e); return; }
      keys.current.down?.({ key, repeat: e.repeat });
    };
    const up = (e: KeyboardEvent) => {
      if (!useMinigame.getState().kind) return;
      const key = mgKey(e);
      if (!CAPTURE.has(key)) return;
      const el = e.target as HTMLElement | null;
      if ((key === "Enter" || key === " ") && el?.dataset?.mgNative) return;
      e.preventDefault(); e.stopPropagation();
      keys.current.up?.({ key, repeat: e.repeat });
    };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    return () => { window.removeEventListener("keydown", down, true); window.removeEventListener("keyup", up, true); };
  }, [kind]);

  useEffect(() => {
    if (!kind) return;
    const host = panel.current;
    mgFocus.host = host;
    host?.focus();
    // yürüyüp uzaklaşma (dokun-git, joystick, ışınlanma) oyunu kapatır; açılışta süren yol (yere varış) taban noktasını taşır
    const a = walkRuntime.avatar;
    let x0 = a.x, z0 = a.z, arriving = !!a.route;
    const iv = window.setInterval(() => {
      const p = walkRuntime.avatar;
      if (arriving) { if (p.route) { x0 = p.x; z0 = p.z; return; } arriving = false; x0 = p.x; z0 = p.z; }
      if (walkedAway(x0, z0, p.x, p.z)) stopMinigame();
    }, 250);
    return () => {
      window.clearInterval(iv);
      // sökülme her yoldan (oyun kapandı, yürüme HUD'u kapandı): odak HUD'da kaldıysa ya da düştüyse dünyaya döner
      if (mgFocus.host === host) { if (!useMinigame.getState().kind) returnWorldFocus(); mgFocus.host = null; }
    };
  }, [kind]);

  if (!kind || !spot) return null;
  const def = MINIGAME_BY_KIND[kind];
  const title = t(k(def.locale.title));
  const Icon = MINIGAME_ICONS[kind].hud;
  return (
    <div className="absolute left-3 z-30 w-[min(22rem,calc(100%-1.5rem))] pointer-events-none"
      style={{ bottom: "calc(max(var(--walk-inset-b, 0px), env(safe-area-inset-bottom)) + 0.75rem)" }}>
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="false" aria-labelledby={titleId}
        className="panel !rounded-xl shadow-lg pointer-events-auto w-full p-3 flex flex-col gap-2 outline-none max-h-[calc(100dvh-6rem)] overflow-y-auto">
        <div className="flex items-center gap-2">
          <Icon size={16} aria-hidden="true" className="text-ink-2 shrink-0" />
          <h2 id={titleId} className="font-display font-bold text-base flex-1 min-w-0 truncate">{title}</h2>
          <span className="chip num text-xs">{t("mg_collection", { n: collectionSize(cards), total: ALL_CARDS.length })}</span>
          <button type="button" data-mg-native="1" className="btn min-h-11 min-w-11 !px-2" onClick={stopMinigame} aria-label={t("mg_close")} title={t("mg_close")}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        {GAMES[kind]({ spot, t, keys, opponent })}
        <p className="text-xs text-muted">{t(k(def.locale.text))}</p>
      </div>
    </div>
  );
}

/**
 * UXF-E: olta durumu TEK yerde — vuruş ve sonuç (`loud`) bu paragrafın kendisinde assertive duyurulur; ayrı gizli canlı
 * bölge ve ikinci jeton çipi yoktu/yok (eskiden "Şamandıra daldı! · Balık vurdu! Çek! · Çek!" ve "… +6 jeton · +6 jeton" üç kez).
*/
function Status({ children, loud = false }: { children: React.ReactNode; loud?: boolean }) {
  return <p role="status" aria-live={loud ? "assertive" : "polite"} aria-atomic="true" className="text-sm font-semibold min-h-6">{children}</p>;
}

function CardNote({ id, t, isNew }: { id: string | null; t: T; isNew: boolean }) {
  if (!id || !isNew) return null;
  const name = id.startsWith("fish:") ? t(k(`mg_fish_${id.slice(5)}`)) : id === "board" ? t("mg_card_board") : t("mg_card_toss");
  return <p className="chip text-xs self-start">{t("mg_card_new", { name })}</p>;
}

// ------------------------------------------------------------------ olta
/**
 * WORLD-FIX: saf durum makinesi `voxel/fun/fishing.ts` (atış → bekleme → vuruş → çekiş → sonuç). Birincil eylem evreye göre tek
 * anlam taşır (Oltayı at / Oltayı topla / Çek!); düğme, Boşluk/Enter ve dokunma aynı `press` olayına gider (çift basış korumalı).
 * Sonuç ve jeton sunucudan (`/api/walk/fish/*`); sunucu yoksa yerel tur, jeton yok. Vuruş ve sonuç ayrı bir assertive canlı
 * bölgede duyurulur. Görsel evre `mgActor.fp` ile dünyaya (walkFun.drawMinigame) geçer.
 */
const KEY_PRESS = new Set([" ", "Enter"]);

function FishingGame({ spot, t, keys }: { spot: MgSpot; t: T; keys: React.MutableRefObject<Keys> }) {
  const calm = useReducedMotion();
  const fs = useRef<FishState>(initialFish(calm, performance.now()));
  const [, rerender] = useState(0);
  const [card, setCard] = useState<{ id: string; isNew: boolean } | null>(null);
  const [balance, setBalance] = useState<number | null>(() => useGame.getState().profile?.coins ?? null);
  const [today, setToday] = useState<{ used: number; max: number } | null>(null);
  const local = useRef<{ round: number; fish: string } | null>(null);
  const world = useWalkStore((s) => s.world);
  const m = useT(MGL);

  const apply = useCallback((ev: FishEvent) => {
    const prev = fs.current;
    const { state, effects } = fishStep(prev, ev);
    if (state === prev) return;
    fs.current = state;
    const now = performance.now();
    for (const e of effects) {
      if (e === "cast") {
        setCard(null);
        const round = state.round;
        const pond = !!mgActor.fish?.pond;
        const biome = biomeOf(world, pond);
        const offline = () => {
          const lr = fishRound(seedOf(`${spot.id}#${round}#${Date.now()}`), biome, state.calm);
          local.current = { round, fish: lr.fish.id };
          apply({ type: "ack", now: performance.now(), round, castId: null, biteMs: lr.biteMs, windowMs: lr.windowMs, offline: true });
        };
        if (!world) offline();
        else walkApi.fishCast(world, fishWater(world, pond), state.calm).then((r) => {
          if (!r.castId) { offline(); return; }
          // vuruş anı sunucuda; ipucu işaretle başlar (pencere `assist` ile aynı kuraldan)
          apply({ type: "ack", now: performance.now(), round, castId: r.castId, biteMs: SERVER_CUE, windowMs: state.calm ? FISH_ASSIST_WINDOW_MS : FISH_WINDOW_MS });
          waitBite.current(r.castId, round, 0, 0);
          // FISH-FIX: yanıt hiç gelmezse (asılı istek, vekil) tur bekleme evresinde takılmaz
          window.setTimeout(() => applyRef.current({ type: "cueFail", now: performance.now(), round }), CUE_TIMEOUT_MS);
        }, offline);
      } else if (e === "reel") {
        const round = state.round, castId = state.castId;
        // erken toplama: sonuç yerelde kesin; açık atış sunucuda kapanır (jeton yok)
        if (state.phase === "early") { if (castId) walkApi.fishReel(castId).catch(() => undefined); continue; }
        if (!castId) {
          // yerel tur: vuruşta çekildi → yakalandı, jeton yok
          const fish = local.current?.round === round ? local.current.fish : "hamsi";
          apply({ type: "result", now: performance.now(), round, outcome: { result: "caught", fish, coins: 0, reason: "offline", balance: null, today: null } });
          continue;
        }
        walkApi.fishReel(castId).then((r) => {
          apply({ type: "result", now: performance.now(), round, outcome: { result: r.result, fish: r.fish, coins: r.coins, reason: r.reason, balance: r.balance, today: r.today } });
        }, () => {
          apply({ type: "result", now: performance.now(), round, outcome: { result: "caught", fish: null, coins: 0, reason: "offline", balance: null, today: null } });
        });
      } else if (e === "announceResult") {
        const o = state.outcome;
        if (state.phase === "caught" && o) {
          const fish = o.fish ?? (local.current?.round === state.round ? local.current.fish : "hamsi");
          const id = `fish:${fish}`;
          setCard({ id, isNew: grantCard(id) });
          const bal = o.balance;
          if (bal !== null) {
            setBalance(bal);
            useGame.setState((g) => (g.profile ? { profile: { ...g.profile, coins: bal } } : {}));
          }
          if (o.today) setToday(o.today);
          Object.assign(mgActor, { species: fish, catchAt: now, catchCol: FISH_BY_ID[fish]?.col ?? 9 });
        }
      }
    }
    rerender((v) => v + 1);
  }, [spot.id, t, m, world]);

  /**
   * sunucu vuruş anına dek bekler (uzun yoklama); işaret gelince ipucu o karede başlar. Yanıtta zaman yok.
   * FISH-FIX: adım `cueNext`'ten — hata bir kez yeniden denenir; uç yoksa (eski sunucu), atış kapandıysa ya da yoklama tükendiyse
   * `cueFail`: tur cezasız düşer, "balık gelmedi" metni görünür (sessizce geri sarmaz; bekleme evresinde de takılmaz).
*/
  const waitBite = useRef((castId: string, round: number, polls: number, errors: number): void => {
    const next = (r: CueResult | null) => {
      if (fs.current.round !== round) return;
      const step = cueNext(r, polls, errors);
      if (step === "cue") applyRef.current({ type: "cue", now: performance.now(), round });
      else if (step === "poll") waitBite.current(castId, round, polls + 1, errors);
      else if (step === "retry") window.setTimeout(() => waitBite.current(castId, round, polls, errors + 1), 300);
      // sunucudaki açık atış bir sonraki atışta bırakılır
      else applyRef.current({ type: "cueFail", now: performance.now(), round });
    };
    walkApi.fishBite(castId).then(next, () => next(null));
  });
  const applyRef = useRef(apply);
  applyRef.current = apply;

  // bugünkü ortak havuz (olta dahil) açılışta görünür
  useEffect(() => {
    if (!world) return;
    let live = true;
    walkApi.minigamePool().then((p) => { if (live && p) setToday((cur) => cur ?? p); }, () => undefined);
    return () => { live = false; };
  }, [world]);

  // kare döngüsü: zamanlama (ipucu GÖRÜNDÜĞÜ kare) ve dünya görseli
  useEffect(() => {
    let raf = 0;
    const frame = () => {
      const now = performance.now();
      apply({ type: "tick", now });
      const s = fs.current;
      if (mgActor.fp !== s.phase) { mgActor.fp = s.phase; mgActor.fpAt = s.at; }
      mgActor.tension = lineTension(s, now);
      mgActor.meMotion = s.phase === "casting" ? "cast" : s.phase === "reeling" || s.phase === "caught" ? "reel" : "fish";
      mgActor.bite = s.phase === "bite" ? 1 : s.phase === "caught" ? 2 : 0;
      // tür sonuç gelince bilinir (sudan fırlarken renkli); kaçışta ve yeni atışta yok
      const lf = local.current?.round === s.round ? local.current.fish : null;
      mgActor.species = s.phase === "reeling" || s.phase === "caught" ? (s.outcome?.result === "caught" ? s.outcome.fish ?? lf : null) : null;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    // yedek saat: kare döngüsü kısılırsa (gizli bölme, ağır sahne) evreler yine ilerler; ipucu ≤ 100 ms gecikir
    const iv = window.setInterval(() => apply({ type: "tick", now: performance.now() }), 100);
    return () => { cancelAnimationFrame(raf); window.clearInterval(iv); };
  }, [apply]);

  // sayfa gizlenince (sekme/uygulama değişimi, küçültme: zamanlayıcılar kısılır) atış, bekleme ve vuruş cezasız düşer. Yalnız
  // pencere odağı kaybı (görünür kalan sayfa: ikinci ekran, araç penceresi) turu bozmaz — saat ve kareler sürer.
  useEffect(() => {
    const vis = () => { if (document.visibilityState === "hidden") apply({ type: "blur", now: performance.now() }); };
    document.addEventListener("visibilitychange", vis);
    return () => document.removeEventListener("visibilitychange", vis);
  }, [apply]);

  useEffect(() => { apply({ type: "calm", calm }); }, [calm, apply]);
  // geliştirme kancası: canlı denetim betikleri durum makinesini okur (üretim derlemesinde yok)
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __voxcrewFish?: unknown };
    w.__voxcrewFish = () => ({ ...fs.current, local: local.current });
    return () => { delete w.__voxcrewFish; };
  }, []);
  useEffect(() => () => { mgActor.species = null; mgActor.tension = 0; mgActor.fp = "ready"; }, []);

  const press = () => apply({ type: "press", now: performance.now() });
  useEffect(() => { if (spot.go) press(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- HQA-FIX: panelin "Oltayı at"ı atar
  keys.current = { down: (e) => { if (KEY_PRESS.has(e.key) && !e.repeat) press(); }, idle: () => fishAction(fs.current) === "cast" };

  const s = fs.current;
  const act = fishAction(s);
  const o = s.outcome;
  const fishId = s.phase === "caught" ? (o?.fish ?? (local.current?.round === s.round ? local.current.fish : null)) : null;
  const fishName = fishId ? t(k(`mg_fish_${fishId}`)) : "";
  const tier = fishId ? fishTier(fishId) : null;
  const note = s.phase !== "caught" || !o ? null
    : o.reason === "offline" ? t("mg_fish_offline") : o.reason === "admin" || o.reason === "creative" ? t("mg_fish_mode")
    : o.reason === "junk" ? t("mg_fish_junk") : o.reason === "daily_cap" && o.coins === 0 ? m("pool_cap") : null;
  const label = act === "cast" ? (s.phase === "ready" ? t("mg_fish_cast") : t("mg_fish_again"))
    : act === "reelIn" ? t("mg_fish_reelin") : act === "pull" ? t("mg_fish_cue") : s.phase === "casting" ? t("mg_fish_casting") : t("mg_fish_reeling");
  const aria = act === "reelIn" ? t("mg_fish_reelin_aria") : act === "pull" ? t("mg_fish_pull_aria") : label;
  return (
    <>
      <Status loud={s.phase === "bite" || isResult(s.phase)}>
        {s.phase === "ready" && t("mg_fish_hint_wait")}
        {s.phase === "casting" && t("mg_fish_casting")}
        {s.phase === "waiting" && t("mg_fish_wait")}
        {s.phase === "bite" && <span className="text-lg">{t("mg_fish_bite_text")}</span>}
        {s.phase === "reeling" && t("mg_fish_reeling")}
        {s.phase === "early" && t("mg_fish_early")}
        {s.phase === "late" && t("mg_fish_late")}
        {s.phase === "lost" && (s.cueLost ? m("cue_lost") : t("mg_fish_lost"))}
        {s.phase === "caught" && <>{t("mg_fish_caught", { fish: fishName })} {tier && <span className="chip text-xs">{t(k(`mg_tier_${tier}`))}</span>}{o && o.coins > 0 && <span className="chip num text-xs">{t("mg_fish_coins", { n: o.coins })}</span>}</>}
      </Status>
      {note && <p className="text-xs text-ink-2">{note}</p>}
      <CardNote id={card?.id ?? null} isNew={!!card?.isNew} t={t} />
      {(s.phase === "waiting" || s.phase === "casting") && <p className="text-xs text-ink-2">{s.calm ? t("mg_fish_hint_rm") : t("mg_fish_hint")}</p>}
      <button type="button" aria-label={aria} aria-disabled={act === "busy"}
        className={clsx("btn min-h-11 select-none touch-manipulation", (act === "pull" || act === "cast") && "btn-primary", act === "pull" && "motion-safe:animate-pulse",
          act === "busy" && "opacity-70")}
        onPointerDown={(e) => { if (e.button === 0) { e.preventDefault(); press(); } }}
        onClick={(e) => { if (e.detail === 0) press(); }}>
        {label}
      </button>
      {(balance !== null || today) && (
        <p className="text-xs text-ink-2 num flex flex-wrap gap-x-3">
          {balance !== null && <span>{t("mg_fish_balance", { n: balance })}</span>}
          {today && <span title={m("pool_hint")}>{m("pool_today", { used: today.used, max: today.max })}</span>}
        </p>
      )}
    </>
  );
}

// ------------------------------------------------------------------ üç taş
function BoardGame({ spot, t, keys, name }: { spot: MgSpot; t: T; keys: React.MutableRefObject<Keys>; name: string }) {
  const [round, setRound] = useState(0);
  const [board, setBoard] = useState<Board>(EMPTY_BOARD);
  const [turn, setTurn] = useState<1 | 2>(1);
  const [cursor, setCursor] = useState(4);
  const [left, setLeft] = useState(BOARD_SECONDS);
  const [card, setCard] = useState<{ id: string; isNew: boolean } | null>(null);
  const rand = useRef(rng(seedOf(`${spot.id}#b${round}`)));
  const cells = useRef<(HTMLButtonElement | null)[]>([]);
  const w = winner(board);
  const over = w !== 0 || left <= 0;

  useEffect(() => {
    rand.current = rng(seedOf(`${spot.id}#b${round}`));
    setBoard(EMPTY_BOARD); setTurn(1); setLeft(BOARD_SECONDS); setCard(null); setCursor(4);
    mgActor.board = EMPTY_BOARD; mgActor.turn = 1;
    const id = window.setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(id);
  }, [round, spot.id]);

  useEffect(() => { mgActor.board = board; mgActor.turn = turn; }, [board, turn]);
  const granted = useRef(-1);
  useEffect(() => { if (w === 1 && granted.current !== round) { granted.current = round; setCard({ id: "board", isNew: grantCard("board") }); } }, [w, round]);

  // ajan hamlesi: yerel ve rastgele (model yok), kısa bekleme ile
  useEffect(() => {
    if (turn !== 2 || over) return;
    const id = window.setTimeout(() => {
      const i = agentMove(board, rand.current);
      if (i >= 0) setBoard(place(board, i, 2));
      setTurn(1);
    }, 700 + Math.floor(rand.current() * 600));
    return () => window.clearTimeout(id);
  }, [turn, over]); // eslint-disable-line react-hooks/exhaustive-deps

  const play = (i: number) => {
    if (over || turn !== 1 || board[i] !== 0) return;
    setBoard(place(board, i, 1));
    setTurn(2);
  };
  const move = (dr: number, dc: number) => {
    const r = Math.max(0, Math.min(2, Math.floor(cursor / 3) + dr)), c = Math.max(0, Math.min(2, (cursor % 3) + dc));
    setCursor(r * 3 + c);
    cells.current[r * 3 + c]?.focus();
  };
  keys.current = {
    down: (e) => {
      if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") move(-1, 0);
      else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") move(1, 0);
      else if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") move(0, -1);
      else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") move(0, 1);
      else if ((e.key === " " || e.key === "Enter") && !e.repeat) { if (over) setRound((r) => r + 1); else play(cursor); }
    },
  };
  const val = (v: number) => (v === 1 ? t("mg_cell_you") : v === 2 ? t("mg_cell_agent") : t("mg_cell_empty"));
  return (
    <>
      <div className="flex items-center justify-between gap-2 text-xs text-ink-2">
        <span className="truncate">{t("mg_board_vs", { name })}</span>
        <span className="num">{t("mg_board_time", { s: left })}</span>
      </div>
      <Status>
        {w === 1 ? t("mg_board_win") : w === 2 ? t("mg_board_lose", { name }) : w === 3 ? t("mg_board_draw") : left <= 0 ? t("mg_board_timeout")
          : turn === 1 ? t("mg_board_you") : t("mg_board_agent", { name })}
      </Status>
      <div role="grid" aria-label={t("mg_board_title")} className="grid grid-cols-3 gap-1.5 self-center w-48">
        {[0, 1, 2].map((r) => (
          <div role="row" key={r} className="contents">
            {[0, 1, 2].map((c) => {
              const i = r * 3 + c, v = board[i];
              return (
                <button key={i} ref={(el) => { cells.current[i] = el; }} type="button" role="gridcell" tabIndex={i === cursor ? 0 : -1}
                  aria-label={t("mg_board_cell", { r: r + 1, c: c + 1, v: val(v) })} aria-disabled={over || v !== 0 || turn !== 1}
                  onClick={() => { setCursor(i); play(i); }} onFocus={() => setCursor(i)}
                  className={clsx("h-14 rounded-lg border border-line flex items-center justify-center bg-panel-2 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
                    i === cursor && "ring-2 ring-[color:var(--focus)]")}>
                  {v !== 0 && <span aria-hidden="true" className={clsx("block size-6 border-2", v === 1 ? "rounded-full bg-white border-ink-2" : "rotate-45 rounded-sm bg-gold border-ink-2")} />}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <p className="text-xs text-ink-2">{t("mg_board_hint")}</p>
      <CardNote id={card?.id ?? null} isNew={!!card?.isNew} t={t} />
      {over && <button type="button" data-mg-native="1" className="btn btn-primary min-h-11" onClick={() => setRound((x) => x + 1)}>{t("mg_board_again")}</button>}
    </>
  );
}

// ------------------------------------------------------------------ atış
function TossGame({ spot, t, keys }: { spot: MgSpot; t: T; keys: React.MutableRefObject<Keys> }) {
  const calm = reducedMotion();
  const [round, setRound] = useState(0);
  const [held, setHeld] = useState<number | null>(calm ? performance.now() : null);
  const [power, setPower] = useState(0);
  const [res, setRes] = useState<TossResult | null>(null);
  const [card, setCard] = useState<{ id: string; isNew: boolean } | null>(null);
  const target = tossTarget(seedOf(`${spot.id}#t${round}`));

  useEffect(() => {
    setRes(null); setCard(null); setPower(0);
    setHeld(calm ? performance.now() : null);
    mgActor.throwAt = 0; mgActor.meMotion = "idle"; mgActor.target = target;
  }, [round]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (held === null || res) return;
    let raf = 0;
    // yalnız gösterilen yüzde değişince yeniden çizim (her rAF'de yeni değer HUD'u her kare yeniden çiziyordu; görünüm `pct`'den)
    const tick = () => { const p = powerAt(performance.now() - held, calm); setPower((v) => (Math.round(v * 100) === Math.round(p * 100) ? v : p)); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [held, res, calm]);

  const begin = () => { if (!res && held === null) setHeld(performance.now()); };
  const release = () => {
    if (res || held === null) return;
    const p = powerAt(performance.now() - held, calm);
    const r = tossScore(p, target);
    setPower(p); setRes(r); setHeld(null);
    Object.assign(mgActor, { power: p, target, throwAt: performance.now(), meMotion: "toss" });
    if (r.grade === "hit") setCard({ id: "toss", isNew: grantCard("toss") });
  };
  keys.current = {
    down: (e) => {
      if (e.key !== " " && e.key !== "Enter") return;
      if (e.repeat) return;
      if (res) { setRound((x) => x + 1); return; }
      if (calm) release(); else begin();
    },
    up: (e) => { if ((e.key === " " || e.key === "Enter") && !calm) release(); },
    // FISH-FIX: güç basılı tutulmuyorsa (ya da sonuç ekranı) yürüme tuşu oyunu kapatır
    idle: () => calm || held === null || res !== null,
  };
  const pct = Math.round(power * 100);
  return (
    <>
      <Status>
        {res ? (res.grade === "hit" ? t("mg_toss_hit") : res.grade === "near" ? t("mg_toss_near", { n: res.points }) : t("mg_toss_miss"))
          : calm ? t("mg_toss_hint_rm") : t("mg_toss_hint")}
      </Status>
      <div className="relative h-5 rounded-full bg-panel-2 border border-line overflow-hidden" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
        aria-label={t("mg_toss_power", { p: pct })}>
        <div className="absolute inset-y-0 left-0 bg-primary" style={{ width: `${pct}%` }} />
        <div aria-hidden="true" className="absolute inset-y-0 w-1 bg-ink" style={{ left: `calc(${(target * 100).toFixed(1)}% - 2px)` }} />
      </div>
      <p className="text-xs text-ink-2 num">{t("mg_toss_power", { p: pct })}</p>
      <CardNote id={card?.id ?? null} isNew={!!card?.isNew} t={t} />
      {res ? (
        <button type="button" data-mg-native="1" className="btn btn-primary min-h-11" onClick={() => setRound((x) => x + 1)}>{t("mg_toss_again")}</button>
      ) : (
        <button type="button" className="btn btn-primary min-h-11 select-none touch-none"
          onPointerDown={(e) => { e.preventDefault(); if (calm) release(); else begin(); }} onPointerUp={() => { if (!calm) release(); }}
          onPointerLeave={() => { if (!calm && held !== null) release(); }}>
          {t("mg_start_toss")}
        </button>
      )}
    </>
  );
}
