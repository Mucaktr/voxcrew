// yapılandırılmış hata gövdesi → okunur TR/EN ileti. Ham JSON hiçbir zaman kullanıcıya gösterilmez.
// Saf modül (içe aktarma yok): `node --test scripts/qa19_fix.test.mjs` doğrudan sınar. Dil çağırandan gelir.
//
// Öncelik: `detail` dizgisi → `detail.message` (sunucu istek dilinde üretir) → `error`/`detail` dizgisi → bilinen
// `code` (plan_limit, sealed …) → doğrulama hatası listesi (FastAPI 422) → genel "İstek tamamlanamadı (409)".

export type ErrLocale = "tr" | "en";

type Pair = { tr: string; en: string };

/** Bilinen hata kodları (sunucunun `code` alanı) → anlaşılır ileti. `message` varsa o kullanılır; bu yalnız yedek. */
export const ERROR_CODE_TEXT: Record<string, Pair> = {
  plan_limit: {
    tr: "Paket sınırına takıldı. Ücretsiz çözümler ve paketler için Paket sayfasına bakabilirsin.",
    en: "You reached a plan limit. See the Plan page for free fixes and plan options.",
  },
  sealed: {
    tr: "Değerlendirme sürüyor; bu kayıt değerlendirme bitince değiştirilebilir.",
    en: "An evaluation is running; this record can be changed when it finishes.",
  },
  recipe_team: {
    tr: "Tarifin ekibindeki bir ajan şu an kullanılamıyor (yedekte ya da eksik). Önce kadroya al.",
    en: "An agent in this recipe's team is not available right now (benched or missing). Move them to the roster first.",
  },
  needs_confirm: { tr: "Devam etmek için onayın gerekiyor.", en: "Your confirmation is needed to continue." },
  busy: { tr: "Şu anda başka bir iş sürüyor; bitince yeniden dene.", en: "Something else is running; try again when it finishes." },
  accepted_final: {
    tr: "Bu iş kabul edildi ve kilitlendi; değişiklik için yeni bir sürüm aç.",
    en: "This work was accepted and is locked; open a new revision to change it.",
  },
  already_accepted: { tr: "Bu iş zaten kabul edildi.", en: "This work is already accepted." },
  superseded: { tr: "Bu kaydın yerine daha yeni bir sürüm var.", en: "A newer version replaced this record." },
  injection_text: {
    tr: "Metinde talimat enjeksiyonu şüphesi var; içeriği gözden geçir.",
    en: "The text looks like a prompt injection; review the content.",
  },
};

const GENERIC: Pair = { tr: "İstek tamamlanamadı ({status}).", en: "The request could not be completed ({status})." };
/** gövdesiz / JSON olmayan yanıtlar (kapalı sunucu önündeki vekilin 502/500'ü, ağ kopması = 0) ham "500 Internal Server
 * Error" yerine okunur cümle olur. 4xx için genel cümle kalır.*/
const DOWN: Pair = { tr: "VoxCrew sunucusuna ulaşılamıyor. Biraz sonra yeniden dene.", en: "Can't reach the VoxCrew server. Try again in a moment." };
const SERVER_ERR: Pair = { tr: "Sunucu şu an yanıt vermiyor. Biraz sonra yeniden dene.", en: "The server is not responding right now. Try again in a moment." };
const NOT_FOUND: Pair = { tr: "Aradığın kayıt bulunamadı.", en: "That item was not found." };

/** Sunucuya hiç ulaşılamadı mı (ağ hatası ya da vekilin 502/503/504'ü)? Durum noktası bunu "Bağlantı yok" gösterir. */
export function isUnreachableStatus(status: number): boolean {
  return status === 0 || status === 502 || status === 503 || status === 504;
}

function statusFallback(status: number, locale: ErrLocale): string {
  if (isUnreachableStatus(status)) return DOWN[locale];
  if (status >= 500) return SERVER_ERR[locale];
  if (status === 404) return NOT_FOUND[locale];
  return GENERIC[locale].replace("{status}", String(status));
}

const INVALID: Pair = { tr: "Geçersiz istek: {list}", en: "Invalid request: {list}" };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function validationText(list: unknown[], locale: ErrLocale): string | null {
  const parts: string[] = [];
  for (const it of list.slice(0, 3)) {
    if (typeof it === "string" && it.trim()) parts.push(it.trim());
    else if (it && typeof it === "object") {
      const o = it as { msg?: unknown; message?: unknown; loc?: unknown };
      const msg = str(o.msg) ?? str(o.message);
      if (!msg) continue;
      const loc = Array.isArray(o.loc) ? o.loc.filter((x) => x !== "body" && x !== "query").map(String).join(".") : "";
      parts.push(loc ? `${loc}: ${msg}` : msg);
    }
  }
  if (!parts.length) return null;
  return INVALID[locale].replace("{list}", parts.join("; "));
}

/** `detail` (dizgi, nesne ya da liste) → okunur metin; çıkarılamazsa null. */
export function detailText(detail: unknown, locale: ErrLocale = "tr"): string | null {
  const s = str(detail);
  if (s) return s;
  if (Array.isArray(detail)) return validationText(detail, locale);
  if (!detail || typeof detail !== "object") return null;
  const d = detail as Record<string, unknown>;
  const direct = str(d.message) ?? str(d.error) ?? str(d.detail);
  if (direct) return direct;
  if (d.detail && typeof d.detail === "object") {
    const inner = detailText(d.detail, locale);
    if (inner) return inner;
  }
  const code = str(d.code);
  if (code && ERROR_CODE_TEXT[code]) return ERROR_CODE_TEXT[code][locale];
  if (Array.isArray(d.errors)) return validationText(d.errors, locale);
  return null;
}

/** Hata yanıtı gövdesi (`{"detail": …}` ya da doğrudan detay) → kullanıcıya gösterilecek ileti. */
export function errorMessage(status: number, body: unknown, locale: ErrLocale = "tr"): string {
  const hasDetail = !!body && typeof body === "object" && !Array.isArray(body) && "detail" in (body as object);
  const detail = hasDetail ? (body as { detail: unknown }).detail : body;
  return detailText(detail, locale)
    // `{detail: …}` dışında kalan kardeş alanlar (`{"detail": {...}, "code": "sealed"}` gibi)
    ?? (hasDetail ? detailText({ ...(body as object), detail: undefined }, locale) : null)
    ?? statusFallback(status, locale);
}
