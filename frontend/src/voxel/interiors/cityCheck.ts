/**
 * şehir haritası landmark iç mekânlarının denetimi (saf; `scripts/city_check.mjs` CITY-MAP-LM-001 çağırır).
 *
 * Sahne iç mekânlarıyla (check.ts `checkSceneExplore`, viewCheck.ts) aynı kat kuralları: her katta yürünebilir karolar tek
 * bileşen, portal ve varış karoları yürünebilir ve aynı bileşende, tek çıkış ilk katta, katta ≤ 3 ışık, merdiven geometrisi ve
 * "her kata girişten merdivenle ulaşılır" (`checkStairs`), görüntüleme kuralları (kamera ataması, kesit kapsamı %100, çizim
 * çağrısı tahmini ≤ bütçe; `levelViewReport`). Şehir iç mekânında ofis tabanının pişmiş panoraması yoktur; sessiz kat yoktur
 * (ibadet yeri iç mekânları şehirde de kapalı).
 *
 * WORLD-PANO (`cityPanoReport`): tarifi `none` olmayan (yer altı dışı) her katta silüet halkası var (`exterior: backdrop`),
 * halka **+0 çizim çağrısı** ekler (halkalı/halkasız grup tahmini aynı), blok tavanı `INTERIOR_PANO_BLOCKS`, ve zeminin üstüne
 * çıkan hiçbir halka bloğu ayak izi + kamera erişimi (kuralın takip mesafesi + 1) kutusuna girmez → kesit kamerası, örtü ve
 * gezinme ızgaraları değişmez.
*/
import { sceneDef, type Tile } from "../scenes";
import { checkStairs } from "./check";
import type { InteriorPlan } from "./generate";
import { estimateFloorCalls, levelViewReport } from "./viewCheck";
import { cityPanoBlocks, INTERIOR_PANO_BLOCKS, levelHasGlow, panoKeepOut, panoRecipe, parseCitySite } from "./cityPano";
import { cameraRuleOf } from "./sceneModel";

const kk = (t: Tile) => `${t[0]},${t[1]}`;

export function checkCityInteriorPlan(plan: InteriorPlan): string[] {
  const problems: string[] = [];
  const base = sceneDef(plan.scene);
  let exits = 0;
  plan.levels.forEach((lv, li) => {
    const w = lv.built.width, d = lv.built.depth;
    const label = new Int32Array(w * d).fill(-1);
    let n = 0;
    for (let s0 = 0; s0 < w * d; s0++) {
      const si = s0 % w, sj = (s0 - si) / w;
      if (label[s0] !== -1 || lv.built.blocked.has(`${si},${sj}`)) continue;
      label[s0] = n;
      const q = [s0];
      while (q.length) {
        const c = q.pop()!, ci = c % w, cj = (c - ci) / w;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = ci + di, nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= w || nj >= d) continue;
          const k = nj * w + ni;
          if (label[k] !== -1 || lv.built.blocked.has(`${ni},${nj}`)) continue;
          label[k] = n; q.push(k);
        }
      }
      n++;
    }
    const at = (t: Tile) => (t[0] >= 0 && t[1] >= 0 && t[0] < w && t[1] < d ? label[t[1] * w + t[0]] : -1);
    const tag = `kat ${li}`;
    if (n !== 1) problems.push(`${tag}: odalar bağlı değil (${n} bileşen)`);
    const portals = new Set(lv.portals.map((p) => kk(p.tile)));
    for (const p of lv.portals) {
      if (at(p.tile) < 0 || at(p.arrive) < 0) problems.push(`${tag}: portal ${p.id} ya da varışı yürünemez`);
      else if (at(p.tile) !== at(p.arrive)) problems.push(`${tag}: portal ${p.id} ulaşılamıyor`);
      if (portals.has(kk(p.arrive))) problems.push(`${tag}: varış karosu bir portal`);
      exits++;
      if (li !== 0) problems.push(`${tag}: çıkış ilk katta değil`);
    }
    if (lv.pano) problems.push(`${tag}: şehir iç mekânında panorama`);
    for (const pr of cityPanoReport(plan, li).problems) problems.push(`${tag}: ${pr}`);
    // COURTYARD-PORTAL: ibadet yerinin AVLUSU (açık hava, `courtyard`) sessiz bölge olarak açılır; ibadet iç mekânı kapalı kalır
    if (lv.quiet && lv.kind !== "courtyard") problems.push(`${tag}: şehirde sessiz (ibadet) iç mekân açık`);
    if (lv.built.lights.length > 3) problems.push(`${tag}: ${lv.built.lights.length} ışık (> 3)`);
    problems.push(...levelViewReport(lv, base).problems.map((x) => `${tag}: ${x}`));
  });
  if (exits !== 1) problems.push(`${exits} çıkış (1 olmalı)`);
  problems.push(...checkStairs(plan, `${plan.scene}:${plan.site}`));
  return problems;
}

export interface CityPanoRow { key: string; blocks: number; callsBefore: number; callsAfter: number; elev: number }

/** WORLD-PANO: katın silüet halkası denetimi ve ölçümü (bkz. dosya başı). */
export function cityPanoReport(plan: InteriorPlan, li: number): { problems: string[]; row: CityPanoRow } {
  const problems: string[] = [];
  const lv = plan.levels[li];
  const id = parseCitySite(plan.site);
  const want = !!id && !("none" in panoRecipe(id.city, id.landmark));
  const p = lv.cityPano ?? null;
  if (want && !p) problems.push("silüet halkası yok (pencere/güverte boş)");
  if (!want && p) problems.push("tarifi 'none' olan katta silüet halkası");
  const before = estimateFloorCalls(lv, { cityPano: false }).calls, after = estimateFloorCalls(lv).calls;
  let blocks = 0;
  if (p) {
    if (after !== before) problems.push(`silüet halkası çizim çağrısı ekliyor (${before} → ${after})`);
    const reach = cameraRuleOf(lv).dist + 1;
    const box = panoKeepOut(p, reach);
    // COURTYARD-PORTAL: avlu katında halka duvarın üstünden görünsün diye yükseltilir (generate.ts COURT_PANO_ELEV); duvar boyunun
    // (kat yüksekliği) altında kalan halka zemini duvarın arkasındadır — kamera duvarı aşamaz
    const hide = lv.kind === "courtyard" ? lv.storey : 0.001;
    for (const night of [false, true]) {
      const list = cityPanoBlocks(p, night, levelHasGlow(lv));
      blocks = Math.max(blocks, list.length);
      if (list.length > INTERIOR_PANO_BLOCKS) problems.push(`silüet halkası ${list.length} blok > ${INTERIOR_PANO_BLOCKS}`);
      const bad = list.find((b) => b.p[1] + b.s[1] / 2 > hide && b.p[0] + b.s[0] / 2 > box.x0 && b.p[0] - b.s[0] / 2 < box.x1
        && b.p[2] + b.s[2] / 2 > box.z0 && b.p[2] - b.s[2] / 2 < box.z1);
      if (bad) { problems.push(`silüet bloğu kamera erişim kutusunda (${bad.p.map((v) => v.toFixed(1)).join(",")})`); break; }
    }
  }
  return { problems, row: { key: lv.key, blocks, callsBefore: before, callsAfter: after, elev: p?.elev ?? 0 } };
}
