// Kullanıcı varlığı: kullanıcıya ait uçlar (onay kararı, yönetici, mağaza, model
// politikası, yürüme, takdir…) sayfa jetonu + sunucunun verdiği HttpOnly oturum çerezi + aynı köken Origin ister.
// Jeton her sayfa yüklemesinde yeniden alınır ve yalnızca bu sekmenin belleğindedir; JSON oturum ucu yoktur, jeton
// sunucunun gizli bir iframe'e açtığı oturum belgesinden okunur. Sarmalayıcı stüdyonun kendi `/api` adresine giden her
// durum değiştiren isteğe jetonu (ve arayüz dilini) ekler; ~30 ayrı `fetch` çağrısı değişmeden kalır.
// Sunucu yeniden başlarsa ya da jeton düşerse 403 `user_presence_required` gelir: oturum bir kez yenilenip istek
// tekrarlanır (kullanıcı fark etmez).

import { currentLocale } from "./i18n";

const UI_HEADER = "X-Studio-UI";
const LANG_HEADER = "X-Studio-Lang";
const BOOTSTRAP_URL = "/api/ui/bootstrap";
const DENIED_CODE = "user_presence_required";
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
const BOOTSTRAP_TIMEOUT_MS = 10_000;

let tokenPromise: Promise<string | null> | null = null;

function readToken(frame: HTMLIFrameElement): string | null {
  try {
    const meta = frame.contentDocument?.querySelector('meta[name="vc-ui"]');
    return meta?.getAttribute("content") || null;
  } catch {
    return null; // aynı köken değilse (beklenmez) okunamaz
  }
}

function bootstrap(): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined" || !document.body) {
      resolve(null);
      return;
    }
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.title = "";
    frame.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden";
    let done = false;
    const finish = (token: string | null) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      frame.remove();
      resolve(token);
    };
    const timer = window.setTimeout(() => finish(null), BOOTSTRAP_TIMEOUT_MS);
    frame.addEventListener("load", () => finish(readToken(frame)));
    frame.addEventListener("error", () => finish(null));
    frame.src = `${BOOTSTRAP_URL}?t=${Date.now().toString(36)}`;
    document.body.appendChild(frame);
  });
}

function loadToken(): Promise<string | null> {
  tokenPromise ??= bootstrap().then((token) => {
    if (!token) tokenPromise = null; // sunucu henüz hazır değilse bir sonraki istekte yeniden dene
    return token;
  });
  return tokenPromise;
}

function ownApiUrl(input: RequestInfo | URL): boolean {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  try {
    const url = new URL(raw, window.location.href);
    return url.origin === window.location.origin && url.pathname.startsWith("/api/") && url.pathname !== BOOTSTRAP_URL;
  } catch {
    return false;
  }
}

async function presenceDenied(res: Response): Promise<boolean> {
  if (res.status !== 403) return false;
  try {
    return ((await res.clone().json()) as { code?: string }).code === DENIED_CODE;
  } catch {
    return false;
  }
}

let installed = false;

export function installUserPresence(): void {
  if (installed || typeof window === "undefined" || typeof window.fetch !== "function") return;
  installed = true;
  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (SAFE.has(method) || !ownApiUrl(input)) return nativeFetch(input, init);

    const withToken = (token: string | null): [RequestInfo | URL, RequestInit | undefined] => {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      if (token) headers.set(UI_HEADER, token);
      // Hata iletileri arayüz dilinde gelsin (başlığı unutan çağrılar için; ör. ekip yemeği)
      if (!headers.has(LANG_HEADER)) headers.set(LANG_HEADER, currentLocale());
      return [input, { ...init, headers, credentials: "same-origin" }];
    };

    const first = await loadToken();
    const res = await nativeFetch(...withToken(first));
    // Akış gövdeleri tekrar gönderilemez; diğerleri (JSON metni, FormData, Blob) güvenle yinelenir
    const replayable = !(input instanceof Request) && !(init?.body instanceof ReadableStream);
    if (!replayable || !(await presenceDenied(res))) return res;
    tokenPromise = null;
    const fresh = await loadToken();
    if (!fresh || fresh === first) return res;
    return nativeFetch(...withToken(fresh));
  };

  // İlk kullanıcı işlemi beklemesin: sayfa açılınca oturumu arka planda al
  const warm = () => void loadToken();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", warm, { once: true });
  else window.setTimeout(warm, 0);
}
