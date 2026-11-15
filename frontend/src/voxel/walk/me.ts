/**
 * W2 (WALK-INT) — "Ben" avatarının görünümü ( A). W5: sunucu kaydı (`saveMeLook`,
 * `loadMeLook`; `PUT /api/walk/avatar`), localStorage çevrimdışı önbellek.
 *
 * D1 A: ayrı bir "Ben" avatarı; görünüm şimdilik bu tarayıcıda (localStorage) saklanır. İnsan üye düğümü ( b) ya
 * da W4 `game_meta['walk:avatar']` gelince tek kaynak oraya taşınır; bu modül yalnızca okuma/yazma yüzeyini sabit tutar
 * (`useMeLook`, `setMeLook`). Kayıt yoksa ya da bozuksa varsayılan görünüm (insan, ajanlardan ayırt edici sarı-turuncu ton).
 * Avatar ajan değildir: beyni, XP'si, sıralaması yoktur; `live.positions`'a yazılmaz.
*/
import { create } from "zustand";
import type { Avatar } from "../../lib/types";
import { currentLocale } from "../../lib/i18n";
import { normalizeAvatar } from "../avatar";

export interface MeLook {
  /** ad etiketi; boşsa yerel "Ben" / "Me" */
  name: string;
  avatar: Avatar;
  /** etiket çerçevesi rengi (ajan etiketlerinden ayırt edici) */
  color: string;
}

export const ME_KEY = "vc-walk-me";
export const ME_COLOR = "#FFB547";
export const ME_DEFAULT_AVATAR: Avatar = normalizeAvatar({
  species: "human", skin: "#D9A066", hair: "short", hairColor: "#2B1D14", beard: "none",
  outfit: "hoodie", outfitColor: "#F28C28", accent: "#FFE08A", glasses: "none", hat: "none",
});

function load(): MeLook {
  const fallback: MeLook = { name: "", avatar: ME_DEFAULT_AVATAR, color: ME_COLOR };
  try {
    const raw = window.localStorage.getItem(ME_KEY);
    if (!raw) return fallback;
    const v = JSON.parse(raw) as Partial<{ name: unknown; avatar: unknown }>;
    const name = typeof v.name === "string" ? v.name.slice(0, 24) : "";
    const avatar = v.avatar && typeof v.avatar === "object" ? normalizeAvatar(v.avatar as Partial<Avatar>) : ME_DEFAULT_AVATAR;
    return { name, avatar, color: ME_COLOR };
  } catch {
    return fallback;
  }
}

export const useMeLook = create<MeLook>(() => (typeof window === "undefined" ? { name: "", avatar: ME_DEFAULT_AVATAR, color: ME_COLOR } : load()));

/** Görünümü değiştirir ve bu tarayıcıda saklar (yerel önbellek; sunucu kaydı `saveMeLook`). */
export function setMeLook(patch: Partial<Pick<MeLook, "name" | "avatar">>): void {
  const next = { ...useMeLook.getState(), ...patch };
  useMeLook.setState(next);
  try { window.localStorage.setItem(ME_KEY, JSON.stringify({ name: next.name, avatar: next.avatar })); } catch { /* özel pencere: yalnız oturumda */ }
}

// ------------------------------------------------------------------------------------------ W5: sunucu kaydı (D1 A)
/**
 * W5: "Ben" görünümü sunucuda `game_meta['walk:avatar']` (`PUT /api/walk/avatar`, kullanıcı-yalnız; MCP 403) ve
 * `GET /api/walk/state` → `avatar`, `avatar_name`. localStorage çevrimdışı önbellektir: sunucu yanıt vermezse yerel kayıt
 * kullanılır; sunucuda kayıt yoksa ve yerelde varsa yerel kayıt bir kez sunucuya taşınır.
 */
/** Bu tarayıcıda (ya da sunucuda) kayıtlı bir görünüm var mı — ilk girişte editörü açmak için. */
export function hasStoredLook(): boolean {
  if (meServer.loaded && meServer.has) return true;
  try { return !!window.localStorage.getItem(ME_KEY); } catch { return false; }
}

const meServer = { loaded: false, has: false, inflight: null as Promise<void> | null };

async function readJson(res: Response): Promise<unknown> {
  try { return await res.json(); } catch { return null; }
}

/** Sunucudaki görünümü bir kez yükler (sayfa başına). Hata sessizdir (çevrimdışı önbellek kalır). */
export function loadMeLook(): Promise<void> {
  if (meServer.loaded) return Promise.resolve();
  meServer.inflight ??= (async () => {
    try {
      const res = await fetch("/api/walk/state", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await readJson(res)) as { avatar?: unknown; avatar_name?: unknown } | null;
      meServer.loaded = true;
      if (body?.avatar && typeof body.avatar === "object") {
        meServer.has = true;
        const name = typeof body.avatar_name === "string" ? body.avatar_name.slice(0, 24) : "";
        setMeLook({ avatar: normalizeAvatar(body.avatar as Partial<Avatar>), name });
      } else {
        let local: string | null = null;
        try { local = window.localStorage.getItem(ME_KEY); } catch { /* yok */ }
        if (local) { const cur = useMeLook.getState(); void putLook(cur.avatar, cur.name).catch(() => undefined); }
      }
    } catch { /* çevrimdışı: yerel önbellek */ } finally { meServer.inflight = null; }
  })();
  return meServer.inflight;
}

export class MeSaveError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

async function putLook(avatar: Avatar, name: string): Promise<{ avatar: Avatar; name: string }> {
  const res = await fetch("/api/walk/avatar", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Studio-Lang": currentLocale() },
    body: JSON.stringify({ avatar, name }),
  });
  const body = (await readJson(res)) as { avatar?: unknown; name?: unknown; detail?: unknown } | null;
  if (!res.ok) throw new MeSaveError(res.status, typeof body?.detail === "string" ? body.detail : `${res.status}`);
  meServer.has = true;
  return {
    avatar: body?.avatar && typeof body.avatar === "object" ? normalizeAvatar(body.avatar as Partial<Avatar>) : avatar,
    name: typeof body?.name === "string" ? body.name : name,
  };
}

/**
 * Editörün "Kaydet"i: önce sunucu (kilit ve doğrulama orada), başarılıysa yerel önbellek + depo. Sunucuya ulaşılamazsa
 * (ağ hatası) yerelde saklanır ve `offline: true` döner; kilit/doğrulama hatası (4xx) `MeSaveError` fırlatır, yerel değişmez.
 */
export async function saveMeLook(avatar: Avatar, name: string): Promise<{ offline: boolean }> {
  const clean = name.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 24);
  try {
    const r = await putLook(normalizeAvatar(avatar), clean);
    setMeLook({ avatar: r.avatar, name: r.name });
    return { offline: false };
  } catch (e) {
    if (e instanceof MeSaveError) throw e;
    setMeLook({ avatar: normalizeAvatar(avatar), name: clean });
    return { offline: true };
  }
}
