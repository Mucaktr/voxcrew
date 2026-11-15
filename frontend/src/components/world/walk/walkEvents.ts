/**
 * FIX-UX ( "visit" ve "event") — yürüme görevlerinin gerçek işe bağlı olayları.
 *
 * - `walkVisit(slug)`: kullanıcı Konuş panelini açıkça açınca (F, Enter, tık) — gün × ajan bir kez 1 XP.
 * - `walkRunStarted(runId)`: kahve noktasından (kahve makinesi paneli ya da kahvenin yakınındaki Konuş paneli) açılan
 * görev penceresi gerçek bir koşu başlatınca — `kafeden_gorev`. Sunucu koşunun var olduğunu, `origin == "ui"` olduğunu
 * ve ≤ 120 sn önce başladığını doğrular; istemci yalnızca "kahve noktasından" bilgisini taşır.
 * - `walkDeliverableViewed(id)`: Konuş panelinde ya da çıktı panosunda bir çıktıya bakılınca (önizleme ya da Aç) —
 * `ziyaret_turu` (3 farklı ajanın çıktısı).
 *
 * Hepsi kullanıcı-yalnızdır (`X-Studio-UI` jetonunu lib/presence.ts ekler), `client_request_id` ile idempotenttir ve sessiz
 * başarısız olur (admin modunda sunucu kaydetmez; 404/409/429 kullanıcıyı durdurmaz). `keepalive`: Aç bağlantısı ve görev
 * penceresi sayfadan ayrılsa da istek gider.
*/
import { currentLocale } from "../../../lib/i18n";
import { walkRuntime } from "../../../voxel/walk/walkStore";
import { walkEntitiesOf } from "./entities";

export function requestId(): string {
  try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}

export interface WalkEventReply { ok: boolean; status: number; counted: boolean; recorded: boolean; already: boolean }

async function post(url: string, body: Record<string, unknown>): Promise<WalkEventReply> {
  try {
    const res = await fetch(url, {
      method: "POST", keepalive: true,
      headers: { "Content-Type": "application/json", "X-Studio-Lang": currentLocale() },
      body: JSON.stringify(body),
    });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, counted: !!j.counted, recorded: !!j.recorded, already: !!j.already };
  } catch {
    return { ok: false, status: 0, counted: false, recorded: false, already: false };
  }
}

/**
 * W5: sunucunun "gün"ü (`game/rules.py day_of`): yerel saat, 04:00'te başlar. UTC tarihi kullanılınca Türkiye'de
 * 03:00–04:00 arası (ya da Amerika'da akşam) bakış ertesi günün kimliğiyle saklanıyor, ertesi günkü bakış "already" dönüyordu.
*/
export const DAY_START_HOUR = 4;
export function studioDay(now: Date = new Date()): string {
  const d = new Date(now.getTime() - DAY_START_HOUR * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Konuş paneli açıldı: ajan ziyareti. Aynı açılış için tek istek kimliği; aynı kimlik ikinci kez gönderilmez
 *  (React StrictMode etkiyi iki kez çalıştırır; sunucu zaten idempotent ama gereksiz istek olmasın). */
const sentVisits = new Set<string>();
export function walkVisit(agent: string, rid: string = requestId()): Promise<WalkEventReply> {
  if (sentVisits.has(rid)) return Promise.resolve({ ok: true, status: 0, counted: false, recorded: false, already: true });
  if (sentVisits.size > 200) sentVisits.clear();
  sentVisits.add(rid);
  return post("/api/walk/visit", { agent, client_request_id: rid });
}

/** Kahve noktasından başlatılan gerçek koşu. Aynı koşu için istek kimliği koşudan türetilir (yeniden denemede çift sayım yok). */
export const walkRunStarted = (runId: string) =>
  post("/api/walk/event", { type: "run_started", ref: runId, client_request_id: `run_started:${runId}`.slice(0, 80) });

/** Bir çıktıya bakıldı (günde bir kez sayılır; aynı gün aynı çıktı için aynı istek kimliği). */
export function walkDeliverableViewed(id: string): Promise<WalkEventReply> {
  const day = studioDay();
  return post("/api/walk/event", { type: "deliverable_viewed", ref: id, client_request_id: `viewed:${day}:${id}`.slice(0, 80) });
}

/** "Kahve noktası": avatarın bu kadar (birim) yakınında bir kahve makinesi / büfe var. */
export const COFFEE_NEAR = 4;

/** Avatar şu an bir kahve noktasının yakınında mı (§10.2 `kafeden_gorev`). */
export function nearCoffeeSpot(x = walkRuntime.avatar.x, z = walkRuntime.avatar.z, range = COFFEE_NEAR): boolean {
  for (const e of walkEntitiesOf("coffee")) if (Math.hypot(e.x - x, e.z - z) <= range) return true;
  return false;
}
