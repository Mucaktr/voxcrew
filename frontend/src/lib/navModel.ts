// NAV-COPY (2026-10-25): sol menünün yapısı tek yerde (node testleri esbuild ile paketleyip okur: frontend/scripts/_nav_load.mjs).
// Tek içe aktarma full/nav (ücretli girişler; ücretsiz sürümde boş). Etiket, açıklama ve ikonlar App.tsx'te kimliğe (`id`) göre eşlenir;
// metinler locales/shell.ts'tedir. Gerekçe ve önce/sonra tablosu:

import { PAID_NAV } from "../full/nav";

/** Menü bölümleri, görünme sırasıyla. `main` her zaman açık ve başlıksızdır (en fazla 7 sayfa); diğerleri daraltılabilir
 *  ve varsayılan olarak kapalıdır. Kimlikler kalıcıdır: açık bölümler localStorage'da bunlarla saklanır. */
export const NAV_GROUPS = ["main", "plan", "team", "learn", "world", "account", "advanced"] as const;
export type NavGroup = (typeof NAV_GROUPS)[number];
export const COLLAPSIBLE_GROUPS: readonly NavGroup[] = NAV_GROUPS.filter((g) => g !== "main");
/** Ana bölümde görünen en fazla sayfa sayısı (ilk kez açan kullanıcı için kısa liste). */
export const MAIN_MAX = 7;
/** Mobil alt çubuktaki doğrudan sayfa sayısı (artı "Daha fazla" düğmesi). */
export const MOBILE_MAX = 4;

/** Bir sayfanın menüde görünme koşulu. Rota her durumda açıktır (yer imleri bozulmaz); koşul yalnızca bağlantıyı gizler.
 * `world` / `board`: arayüz görünümüne bağlı — Dünya Görünümü ya da Pano Görünümü (DASH-MVP;
 * §4.3). Pano Görünümünde ana bölümün başında Dünya yerine Pano durur; oyun girişleri (Dünya yapıcı, Başarılar, Ajan
 * kariyerleri) gizlenir, dünya "Dünya ve mağaza" bölümünde Dünya Görünümü girişiyle (`/dunya`) erişilebilir kalır.*/
export type NavCondition = "cloud" | "skillStore" | "world" | "board";
export type UiMode = "world" | "board";

export interface NavEntry {
  /** kalıcı kimlik: etiket (App.tsx), açıklama (shell.ts `nav_hint_<id>`) ve ikon buna göre seçilir */
  id: string;
  to: string;
  group: NavGroup;
  /** yalnızca tam eşleşmede etkin (ana sayfa) */
  end?: boolean;
  /** mobil alt çubukta doğrudan görünür */
  mobile?: boolean;
  /** görünme koşulu: `cloud` = bulut hesabı açık, `skillStore` = yönetici modu derlemesi, `world`/`board` = görünüm */
  when?: NavCondition;
  /** aynı sayfanın sekmelerini iki menü öğesine bölmek için özel etkinlik kuralı */
  match?: (pathname: string) => boolean;
}

// /basarilar sekmeleri iki kitleye ayrılır: kupa odası, görev panosu, sezon, albüm ve mağaza kullanıcının;
// kariyer sekmesi (varsayılan sekme) ajanların XP'si ve kıdemi. Rota ve yer imleri aynı kalır.
const ACH_USER_TABS = ["kupalar", "gorevler", "sezon", "album", "magaza"];
const under = (p: string, base: string) => p === base || p.startsWith(`${base}/`);
export const isUserAchievements = (p: string) => ACH_USER_TABS.some((tab) => under(p, `/basarilar/${tab}`));

// Ücretli sürümün ek menü girişleri full/nav'dan, özgün konumlarında eklenir (ücretsiz sürümde boş).
const paid = (id: string): NavEntry[] => PAID_NAV[id] ?? [];

export const NAV_ENTRIES: readonly NavEntry[] = [
  // Ana — her gün: neler bekliyor, işi ver, izle, sonucu al
  // `/` görünüme göre Dünya ya da Pano'dur; /dunya ve /pano her iki görünümde de açıktır
  { id: "world", to: "/", group: "main", end: true, mobile: true, when: "world", match: (p) => p === "/" || under(p, "/dunya") },
  { id: "board", to: "/", group: "main", end: true, mobile: true, when: "board", match: (p) => p === "/" || under(p, "/pano") },
  ...paid("resume"),
  { id: "runs", to: "/gorevler", group: "main", mobile: true },
  { id: "inbox", to: "/gelen-kutusu", group: "main", mobile: true },
  { id: "outputs", to: "/ciktilar", group: "main" },
  ...paid("recipes"),
  { id: "agents", to: "/ajanlar", group: "main", mobile: true },
  // Planla ve otomatikleştir — büyük işleri böl, adımları tasarla, saate bağla
  { id: "goals", to: "/hedefler", group: "plan" },
  { id: "workflows", to: "/akislar", group: "plan" },
  { id: "schedule", to: "/zamanlayici", group: "plan" },
  // Ekibin — ajanları büyüt: hazır kahraman, örgüt, yetenek, ayar, bellek, kariyer
  { id: "heroes", to: "/kahramanlar", group: "team" },
  { id: "office", to: "/ofis", group: "team" },
  { id: "skills", to: "/skiller", group: "team" },
  ...paid("boosters"),
  { id: "memory", to: "/bellek", group: "team" },
  { id: "careers", to: "/basarilar/kariyer", group: "team", when: "world", match: (p) => under(p, "/basarilar") && !isUserAchievements(p) },
  // Öğren ve ilerle — kullanıcının kendi öğrenmesi ve ilerlemesi
  ...paid("academy"),
  { id: "achievements", to: "/basarilar/kupalar", group: "learn", when: "world", match: isUserAchievements },
  ...paid("timesaved"),
  // Dünya ve mağaza — dünyanın görünümü ve eklenen paketler
  { id: "worldview", to: "/dunya", group: "world", when: "board" },
  { id: "builder", to: "/dunya-yapici", group: "world", when: "world" },
  ...paid("market"),
  ...paid("skillstore"),
  // Hesap ve ayarlar — beyin bağlantıları, uygulama ayarları, paket ve bulut hesabı
  { id: "connections", to: "/baglantilar", group: "account" },
  // UXF-E: uygulama ayarları (dil, yönetici/güvenli mod…) kendi sayfasında
  { id: "settings", to: "/ayarlar", group: "account" },
  { id: "plan", to: "/paket", group: "account" },
  ...paid("account"),
  // Gelişmiş — geliştiriciler ve ileri kullanım: kod araçları, isteğe bağlı motor, ölçüm, kurucu defteri
  ...paid("projects"),
  { id: "connect", to: "/baglan", group: "advanced" },
  { id: "hermes", to: "/hermes", group: "advanced" },
  ...paid("evals"),
  ...paid("bizdev"),
  { id: "health", to: "/sistem-sagligi", group: "advanced" }, // FAZB1: veritabanı, CDC gecikmesi, hatalar, uyarılar
];

export interface NavContext { cloud: boolean; skillStore: boolean; /** varsayılan `world` */ mode?: UiMode }

export function navVisible(n: NavEntry, ctx: NavContext): boolean {
  switch (n.when) {
    case "cloud": return ctx.cloud;
    case "skillStore": return ctx.skillStore;
    case "world": case "board": return (ctx.mode ?? "world") === n.when;
    default: return true;
  }
}

/** Bu bağlamda menüde görünen öğeler (sıra korunur). */
export function visibleEntries<T extends NavEntry>(ctx: NavContext, entries: readonly T[]): T[] {
  return entries.filter((n) => navVisible(n, ctx));
}

/** Bir öğe bu adreste etkin mi (aria-current="page")? Özel kural yoksa önek eşleşmesi (react-router NavLink gibi). */
export function isNavActive(n: NavEntry, pathname: string): boolean {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (n.match) return n.match(p);
  return n.end ? p === n.to : under(p, n.to);
}

/** Bu adreste etkin olan en özgül öğe (sekme başlığı için). */
export function activeEntry<T extends NavEntry>(pathname: string, entries: readonly T[] = NAV_ENTRIES as readonly T[]): T | undefined {
  return entries.filter((n) => isNavActive(n, pathname)).sort((a, b) => b.to.length - a.to.length)[0];
}

/** Açık (genişletilmiş) bölümler — kişisel kolaylık, okunamazsa hepsi kapalı. Eski "vc-nav-collapsed" anahtarı
 *  (eski bölüm kimlikleriyle daraltılanlar) artık okunmaz. */
export const NAV_OPEN_KEY = "vc-nav-open";
export function parseOpenGroups(raw: string | null | undefined): NavGroup[] {
  try {
    const v: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter((g): g is NavGroup => typeof g === "string" && (COLLAPSIBLE_GROUPS as readonly string[]).includes(g)) : [];
  } catch { return []; }
}
