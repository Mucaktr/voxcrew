/**
 * UX-AUDIT (INTERIOR-OPAQUE-001) — blok malzeme grubunun saydamlık tablosu (saf; three yok → walk_check doğrudan yükler).
 *
 * `Blocks.tsx` malzemelerini bu tablodan kurar: yalnız cam, su/dalga ve bulut saydamdır; katı (`solid`), parıltı, alev, kar,
 * sallanan nesne ve bayrak her zaman opak (`transparent: false`, `opacity: 1`, derinlik yazar). Her `Instanced` grubu kendi
 * malzemesini `useMemo` ile kurar (gruplar arasında paylaşılmaz); paylaşılan tek şey kesit birim seti (`walk/cover.ts`), o da
 * saydamlık değil yalnız `discard` yapar.
 */
import type { Group } from "./scenes";

export interface GroupAlpha {
  /** three `transparent` (sıralı saydam geçişte çizilir) */
  transparent: boolean;
  opacity: number;
  /** ışıksız (MeshBasicMaterial) */
  basic: boolean;
  /** WORLD-FIX: derinlik yazar mı (cam yazmaz: arkasındaki saydam katman — yüz atlası, gözlük — hiçbir açıda kaybolmaz) */
  depthWrite: boolean;
  /** saydam geçişte sıra (cam en son; karakterin saydam parçaları 1–3) */
  order: number;
}

export const GROUP_ALPHA: Readonly<Record<Group, Readonly<GroupAlpha>>> = Object.freeze({
  solid: { transparent: false, opacity: 1, basic: false, depthWrite: true, order: 0 },
  bob: { transparent: false, opacity: 1, basic: false, depthWrite: true, order: 0 },
  flag: { transparent: false, opacity: 1, basic: false, depthWrite: true, order: 0 },
  // dönen yapı opak, ışıklı (Lambert); `e` parçaları aynı malzemede ışıksız çizilir (Blocks.tsx), kesit bütün blok
  spin: { transparent: false, opacity: 1, basic: false, depthWrite: true, order: 0 },
  glow: { transparent: false, opacity: 1, basic: true, depthWrite: true, order: 0 },
  flame: { transparent: false, opacity: 1, basic: true, depthWrite: true, order: 0 },
  snow: { transparent: false, opacity: 1, basic: true, depthWrite: true, order: 0 },
  water: { transparent: true, opacity: 0.8, basic: false, depthWrite: true, order: 0 },
  wave: { transparent: true, opacity: 0.8, basic: false, depthWrite: true, order: 0 },
  glass: { transparent: true, opacity: 0.4, basic: false, depthWrite: false, order: 10 },
  cloud: { transparent: true, opacity: 0.92, basic: false, depthWrite: true, order: 0 },
});

/** Saydam olmasına izin verilen gruplar (cam/açıklık, su, bulut). Geri kalan her grup opak olmalı. */
export const SEE_THROUGH_GROUPS: ReadonlySet<Group> = new Set<Group>(["glass", "water", "wave", "cloud"]);

/** Tablo denetimi (walk_check INTERIOR-OPAQUE-001): sorun listesi. */
export function checkGroupAlpha(): string[] {
  const out: string[] = [];
  for (const [g, a] of Object.entries(GROUP_ALPHA) as [Group, GroupAlpha][]) {
    const see = SEE_THROUGH_GROUPS.has(g);
    if (!see && (a.transparent || a.opacity !== 1)) out.push(`INTERIOR-OPAQUE-001: "${g}" grubu saydam (opak olmalı)`);
    if (see && (!a.transparent || a.opacity >= 1)) out.push(`INTERIOR-OPAQUE-001: "${g}" grubu saydam değil`);
    if (!see && (!a.depthWrite || a.order !== 0)) out.push(`CAMERA-OPAQUE-001: "${g}" opak grup derinlik yazmalı, sıra 0`);
  }
  // WORLD-FIX: cam derinlik yazmaz ve karakterin saydam katmanlarından (1–3) sonra çizilir: arkasındaki yüz/gözlük açıya göre kaybolmaz
  if (GROUP_ALPHA.glass.depthWrite || GROUP_ALPHA.glass.order <= 3) out.push('CAMERA-OPAQUE-001: cam derinlik yazmamalı ve en son çizilmeli');
  return out;
}
