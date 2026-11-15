/**
 * S33 — duvar skor panosu verisi ve çizimi. Yalnızca EKİP ilerlemesi gösterilir (bireysel sıralama/karşılaştırma yok —
 * locales/game.ts "lider tablosu yok" kuralı): bugün biten görevler + son 8 saat çubukları, şu an aktif ajan sayısı,
 * ekip (ofis) seviyesi ve saat. Kaynak S35'in `useTeamScore()` seçicisi; o yüklenene dek koşu listesinden türetilir.
 * Tuval dokusu en çok saniyede bir yeniden çizilir (yalnızca içerik değişince).
 */
import { useMemo } from "react";
import { useGame, useGameVisible, useTeamScore } from "../../lib/game";
import { tx } from "../../lib/i18n";
import { useStudio } from "../../lib/store";
import type { Run } from "../../lib/types";
import { world as M } from "../../locales/world";

export interface BoardData {
  tasksToday: number;
  /** son 8 saat, eskiden yeniye */
  hourly: number[];
  active: number;
  /** oyun katmanı gizliyse null */
  level: number | null;
  progress: number;
}

const DAY_START_HOUR = 4;

function dayStart(now = new Date()): number {
  const d = new Date(now);
  if (d.getHours() < DAY_START_HOUR) d.setDate(d.getDate() - 1);
  d.setHours(DAY_START_HOUR, 0, 0, 0);
  return d.getTime();
}

/** Yedek: koşu listesinden bugün biten görevler ve saatlik çubuklar. */
function fromRuns(runs: Run[], now = Date.now()): { tasksToday: number; hourly: number[] } {
  const start = dayStart(new Date(now));
  const hourly = new Array(8).fill(0) as number[];
  const hourNow = new Date(now); hourNow.setMinutes(0, 0, 0);
  let tasksToday = 0;
  for (const r of runs) {
    if (r.status !== "done" || !r.finished_at) continue;
    const ts = Date.parse(r.finished_at);
    if (!Number.isFinite(ts)) continue;
    if (ts >= start) tasksToday++;
    // son çubuk içinde bulunulan saat; önceki saatler sola
    const idx = ts >= hourNow.getTime() ? 7 : 7 - Math.ceil((hourNow.getTime() - ts) / 3_600_000);
    if (idx >= 0 && idx <= 7) hourly[idx]++;
  }
  return { tasksToday, hourly };
}

/** Pano verisi; `active`: dünyada şu an çalışan/düşünen/onay bekleyen ajan sayısı (yerel sayım). */
export function useBoardData(active: number): BoardData {
  const score = useTeamScore();
  const gameOn = useGameVisible();
  const office = useGame((s) => s.profile?.office ?? null);
  const runList = useStudio((s) => s.runList);
  const fallback = useMemo(() => (score ? null : fromRuns(runList)), [score, runList]);
  return useMemo(() => ({
    tasksToday: score?.tasksToday ?? fallback?.tasksToday ?? 0,
    hourly: score?.hourly ?? fallback?.hourly ?? new Array(8).fill(0),
    active: score?.activeAgents ?? active,
    level: gameOn ? score?.level ?? office?.level ?? null : null,
    progress: gameOn ? score?.progress ?? office?.progress ?? 0 : 0,
  }), [score, fallback, active, gameOn, office]);
}

export const BOARD_W = 512;
export const BOARD_H = 236;
const FONT = "'Pixelify Sans Variable', 'Bricolage Grotesque Variable', system-ui, sans-serif";

const pad2 = (n: number) => String(n).padStart(2, "0");
export function boardClock(d = new Date()): string { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }

/** Panoyu tuvale çizer (koyu zemin, yeşil/altın vurgular; metin ≥ 18 px). */
export function drawBoard(ctx: CanvasRenderingContext2D, d: BoardData, clock: string) {
  const W = BOARD_W, H = BOARD_H;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#0E1424";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#2A3550"; ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, W - 4, H - 4);
  // sol: ✓ bugün biten görevler + saatlik çubuklar
  ctx.fillStyle = "#7BD152";
  ctx.font = `600 54px ${FONT}`;
  ctx.textBaseline = "top";
  ctx.fillText("✓", 22, 16);
  ctx.fillStyle = "#F2EFE7";
  ctx.fillText(String(d.tasksToday), 64, 16);
  ctx.fillStyle = "#A9B4CC";
  ctx.font = `500 22px ${FONT}`;
  ctx.fillText(tx(M, "board_tasks"), 24, 78);
  const max = Math.max(1, ...d.hourly);
  const bx = 24, by = H - 22, bw = 268, bh = 96, gap = 8, w = (bw - gap * 7) / 8;
  ctx.fillStyle = "#1C2538";
  ctx.fillRect(bx - 4, by - bh - 6, bw + 8, bh + 10);
  d.hourly.forEach((v, i) => {
    const h = Math.max(4, Math.round((v / max) * bh));
    ctx.fillStyle = i === d.hourly.length - 1 ? "#9BE57A" : "#4E9A63";
    ctx.fillRect(bx + i * (w + gap), by - h, w, h);
  });
  // ayraç
  ctx.fillStyle = "#2A3550";
  ctx.fillRect(310, 16, 4, H - 32);
  // sağ: saat, aktif ajan, ekip seviyesi
  const rx = 330;
  ctx.strokeStyle = "#F2B33D"; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(rx + 16, 40, 14, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(rx + 16, 40); ctx.lineTo(rx + 16, 30); ctx.moveTo(rx + 16, 40); ctx.lineTo(rx + 24, 44); ctx.stroke();
  ctx.fillStyle = "#F2EFE7";
  ctx.font = `600 38px ${FONT}`;
  ctx.fillText(clock, rx + 40, 20);
  // aktif ajan: iki küçük kafa simgesi
  ctx.fillStyle = "#8CC0F0";
  for (const [x, s] of [[rx + 8, 1], [rx + 22, 0.85]] as [number, number][]) {
    ctx.fillRect(x, 92, 10 * s, 10 * s); ctx.fillRect(x - 2, 104, 14 * s, 10 * s);
  }
  ctx.fillStyle = "#F2EFE7";
  ctx.font = `600 34px ${FONT}`;
  ctx.fillText(String(d.active), rx + 46, 84);
  const aw = ctx.measureText(String(d.active)).width;
  ctx.fillStyle = "#A9B4CC";
  ctx.font = `500 22px ${FONT}`;
  ctx.fillText(tx(M, "board_active"), rx + 54 + aw, 94);
  if (d.level != null) {
    ctx.fillStyle = "#F2B33D";
    ctx.font = `600 28px ${FONT}`;
    ctx.fillText(`${tx(M, "board_level")} ${d.level}`, rx, 146);
    ctx.fillStyle = "#1C2538";
    ctx.fillRect(rx, 186, 152, 18);
    ctx.fillStyle = "#7BD152";
    ctx.fillRect(rx + 3, 189, Math.round(146 * Math.max(0, Math.min(1, d.progress))), 12);
  }
}

export const boardSig = (d: BoardData, clock: string, locale: string) =>
  `${d.tasksToday}|${d.hourly.join(",")}|${d.active}|${d.level}|${Math.round(d.progress * 50)}|${clock}|${locale}`;
