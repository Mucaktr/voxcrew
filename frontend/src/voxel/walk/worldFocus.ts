/**
 * UXF-A — yürüme katmanı kapanınca klavye odağını dünya kabına geri veren TEK yardımcı (FISH-FIX `04ff703`
 * kalıbının genel hâli; `voxel/fun/minigames.ts` de bunu kullanır).
 *
 * Kök neden: yürüme klavyesi (`input.ts attachWalkKeyboard`, `requireSelf`) yalnız dünya kabı odaktayken çalışır. Bir katman
 * (Anı defteri, Hoş geldin kartı, Yakındakiler listesi, mini oyun…) kapanınca odak `body`'ye düşer ya da katmanı açan düğmede
 * kalır (Modal odağı açan düğmeye geri verir) → WASD/F ölü.
 * Kural: kapanışta odak kaybolduysa (`body`/yok) ya da kapanan katmanın veya onun düğmesinin (`hosts`) içindeyse dünyaya döner;
 * kullanıcı başka bir alana geçtiyse (arama kutusu vb.) çalınmaz. `WalkHud` dünya kabına odak veren işlevi `bindWorldFocus` ile
 * bağlar (yürüme modu kapalıyken bağ yoktur → hiçbir şey yapılmaz).
*/
export type FocusHost = { contains(n: unknown): boolean } | null | undefined;

/** Dünya kabına odak veren işlev (WalkHud bağlar: WorldPage `focusWorld`). */
export const worldFocus: { world: (() => void) | null } = { world: null };

/** Bağlar; dönen işlev yalnız kendi bağını çözer. */
export function bindWorldFocus(fn: (() => void) | null | undefined): () => void {
  worldFocus.world = fn ?? null;
  return () => { if (worldFocus.world === (fn ?? null)) worldFocus.world = null; };
}

/** Odak kayıp mı: yok, `body`'de ya da kapanan katmanın (`hosts`) içinde. */
export const focusLost = (active: unknown, body: unknown, ...hosts: FocusHost[]): boolean =>
  !active || active === body || hosts.some((h) => !!h?.contains(active));

/** Odak kayıpsa dünyaya döndürür (döndürdüyse true). `world` verilmezse bağlı işlev. */
export function returnWorldFocus(hosts: FocusHost | FocusHost[] = null, world: (() => void) | null = worldFocus.world): boolean {
  const doc = typeof document === "undefined" ? null : document;
  const list = Array.isArray(hosts) ? hosts : [hosts];
  if (!world || !focusLost(doc?.activeElement ?? null, doc?.body ?? null, ...list)) return false;
  world();
  return true;
}

/**
 * Katman söküldükten SONRA dener (React çizimi ve Modal'ın "odağı açan düğmeye geri ver" adımı bittikten sonra; bir görev
 * turu). `hosts`: kapanan katman ve/veya onu açan düğme.
 */
export function returnWorldFocusSoon(hosts: FocusHost | FocusHost[] = null): void {
  setTimeout(() => { returnWorldFocus(hosts); }, 0);
}
