/**
 * WALK-INTERIOR — iç mekân ve keşif yerleşimi denetimi (saf; `scripts/walk_check.mjs` çağırır).
 *
 * Kurallar:
 *  - kapı: açık her yerin kapısı var; kapı karosu ve dışarı karosu yürünebilir ve taban dünyada doğma karosuyla aynı
 *    bileşende (ulaşılabilir); kapı istasyon/hatıra karosu değil.
 *  - katlar: her katta bütün yürünebilir karolar tek bileşen (odalar bağlı); portal ve varış karoları yürünebilir, varış
 *    portal değil; çıkış (dış dünyaya) ilk katta var ve ulaşılabilir; her "up" için üst katta "down" (ve tersi) eşleşir.
 *  - toplanabilir: seyir noktası ve keşif parçaları yürünebilir, portal değil, kendi katında ulaşılabilir; sayılar katalogla aynı.
 *  - POI ve gizli köşe: yürünebilir, ulaşılabilir, kutsal eğlence payı dışında, hatıra/kapı karosuyla çakışmaz; sayılar katalogla aynı.
 *  - belirlenimcilik: aynı girdi → aynı plan imzası.
 *  - INTERIOR-VIEW merdiven (`checkStairs`): katlar aynı ayak izinde; her "up" bağının üst katta aynı koşulu "down" bağı var;
 *    alt katta merdiven karoları 4-bağlı, engelli ve tırmanılabilir, üstleri (k + 1) · yükseliş, yükseliş ≤ STEP_H; üst katta
 *    sahanlık ve boşluk ağzı yürünebilir, kalan boşluk engelli. **Her kata girişten merdivenle yürüyerek ulaşılır** (yüksekliğe
 *    duyarlı BFS: physics/height.ts `standY`), tıkla-git rotası merdivenin ayağından son basamağa ulaşır (`planRoute` climb).
 */
import { isInSacredBuffer } from "../city/sacred";
import { components, heightCtx, navGrid, planRoute, souvenirSpots, spawnTile, walkable } from "../walk/controller";
import { STEP_H, standY } from "../physics/height";
import { SCENES, tx, tz, type Tile } from "../scenes";
import { exploreIds, sceneExplore } from "./catalog";
import { interiorPlan, type InteriorLevel, type InteriorPlan } from "./generate";
import { baseWorld, scenePlaces } from "./placement";

const kk = (t: Tile) => `${t[0]},${t[1]}`;

function levelComponents(lv: InteriorLevel): { label: Int32Array; n: number } {
  const w = lv.built.width, d = lv.built.depth;
  const label = new Int32Array(w * d).fill(-1);
  let n = 0;
  const q: number[] = [];
  for (let s = 0; s < w * d; s++) {
    const si = s % w, sj = (s - si) / w;
    if (label[s] !== -1 || lv.built.blocked.has(`${si},${sj}`)) continue;
    label[s] = n; q.length = 0; q.push(s);
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
  return { label, n };
}

export interface InteriorReport { problems: string[]; doors: number; levels: number; spots: number; pois: number; hidden: number; signature: string }

/** Bir sahnenin bütün keşif içeriğini denetler. */
export function checkSceneExplore(scene: string): InteriorReport {
  const problems: string[] = [];
  const ex = sceneExplore(scene);
  const rep: InteriorReport = { problems, doors: 0, levels: 0, spots: 0, pois: 0, hidden: 0, signature: "" };
  if (!ex) return rep;
  const base = baseWorld(scene);
  if (!base) { problems.push(`${scene}: taban dünya yok`); return rep; }
  const nav = navGrid(base);
  const { labels } = components(base);
  const sp = spawnTile(base, { core: SCENES[scene as keyof typeof SCENES]?.core ?? null })?.tile;
  if (!sp) { problems.push(`${scene}: doğma karosu yok`); return rep; }
  const spawnLab = labels[sp[1] * nav.width + sp[0]];
  const reach = (t: Tile) => walkable(nav, t[0], t[1]) && labels[t[1] * nav.width + t[0]] === spawnLab;
  const souv = new Set(souvenirSpots(base, scene).map(kk));
  const stations = new Set(base.stations.map((s) => kk(s.tile)));
  const pl = scenePlaces(scene);
  const sig: string[] = [];
  const doorTiles = new Set<string>();

  for (const [site, spec] of Object.entries(ex.sites)) {
    const door = pl.doors.find((d) => d.site === site);
    const tag = `${scene}:${site}`;
    if (!door) { problems.push(`WALK-INTERIOR ${tag}: kapı yok`); continue; }
    rep.doors++;
    doorTiles.add(kk(door.tile));
    sig.push(`${site}@${kk(door.tile)}>${kk(door.out)}`);
    if (!reach(door.tile)) problems.push(`WALK-INTERIOR ${tag}: kapı ${kk(door.tile)} doğmadan ulaşılamıyor`);
    if (!reach(door.out)) problems.push(`WALK-INTERIOR ${tag}: dışarı karosu ${kk(door.out)} ulaşılamıyor`);
    if (kk(door.out) === kk(door.tile)) problems.push(`WALK-INTERIOR ${tag}: dışarı karosu kapıyla aynı`);
    if (souv.has(kk(door.tile)) || stations.has(kk(door.tile))) problems.push(`WALK-INTERIOR ${tag}: kapı hatıra/istasyon karosunda`);
    const plan = interiorPlan(scene, site);
    if (!plan) { problems.push(`WALK-INTERIOR ${tag}: plan yok`); continue; }
    let vps = 0, ks = 0, exits = 0;
    plan.levels.forEach((lv, li) => {
      rep.levels++;
      const w = lv.built.width;
      const { label, n } = levelComponents(lv);
      const at = (t: Tile) => (t[0] >= 0 && t[1] >= 0 && t[0] < w && t[1] < lv.built.depth ? label[t[1] * w + t[0]] : -1);
      const lt = `${tag}#${li}`;
      if (n !== 1) problems.push(`WALK-INTERIOR ${lt}: odalar bağlı değil (${n} bileşen)`);
      const portalSet = new Set(lv.portals.map((p) => kk(p.tile)));
      for (const p of lv.portals) {
        if (at(p.tile) < 0) problems.push(`WALK-INTERIOR ${lt}: portal ${p.id} ${kk(p.tile)} yürünemez`);
        if (at(p.arrive) < 0) problems.push(`WALK-INTERIOR ${lt}: varış ${kk(p.arrive)} yürünemez`);
        if (portalSet.has(kk(p.arrive))) problems.push(`WALK-INTERIOR ${lt}: varış karosu bir portal`);
        if (at(p.tile) >= 0 && at(p.arrive) >= 0 && at(p.tile) !== at(p.arrive)) problems.push(`WALK-INTERIOR ${lt}: portal ${p.id} ulaşılamıyor`);
        exits++; if (li !== 0) problems.push(`WALK-INTERIOR ${lt}: çıkış ilk katta değil`);
      }
      for (const s of lv.spots) {
        rep.spots++;
        if (s.kind === "vp") vps++; else ks++;
        sig.push(`${s.id}@${li}:${kk(s.tile)}`);
        if (at(s.tile) < 0) problems.push(`WALK-INTERIOR ${lt}: ${s.id} ${kk(s.tile)} ulaşılamıyor`);
        if (portalSet.has(kk(s.tile))) problems.push(`WALK-INTERIOR ${lt}: ${s.id} portal karosunda`);
        if (lv.portals.some((p) => kk(p.arrive) === kk(s.tile))) problems.push(`WALK-INTERIOR ${lt}: ${s.id} varış karosunda`);
      }
      if (lv.quiet && lv.spots.length) problems.push(`WALK-INTERIOR ${lt}: sessiz (kutsal) iç mekânda toplanabilir var`);
      if (lv.built.lights.length > 3) problems.push(`WALK-INTERIOR ${lt}: ${lv.built.lights.length} ışık (> 3)`);
    });
    if (exits !== 1) problems.push(`WALK-INTERIOR ${tag}: ${exits} çıkış (1 olmalı)`);
    problems.push(...checkStairs(plan, tag));
    if (vps !== (spec.vp ? 1 : 0)) problems.push(`WALK-INTERIOR ${tag}: ${vps} seyir noktası (katalog ${spec.vp})`);
    if (ks !== spec.k) problems.push(`WALK-INTERIOR ${tag}: ${ks} keşif parçası (katalog ${spec.k})`);
    if (spec.kind === "sacred" && (spec.vp || spec.k)) problems.push(`WALK-INTERIOR ${tag}: kutsal yerde ödüllü toplanabilir`);
  }

  if (pl.pois.length !== ex.poi) problems.push(`WALK-INTERIOR ${scene}: ${pl.pois.length} POI (katalog ${ex.poi})`);
  if (pl.hidden.length !== ex.gz) problems.push(`WALK-INTERIOR ${scene}: ${pl.hidden.length} gizli köşe (katalog ${ex.gz})`);
  const seen = new Set<string>(doorTiles);
  for (const p of pl.pois) {
    rep.pois++;
    sig.push(`poi${p.id}@${kk(p.tile)}`);
    if (!reach(p.tile)) problems.push(`WALK-INTERIOR ${scene}: POI ${p.id} ${kk(p.tile)} ulaşılamıyor`);
    if (isInSacredBuffer(p.tile, base)) problems.push(`WALK-INTERIOR ${scene}: POI ${p.id} kutsal eğlence payında`);
    if (souv.has(kk(p.tile)) || seen.has(kk(p.tile))) problems.push(`WALK-INTERIOR ${scene}: POI ${p.id} çakışıyor`);
    seen.add(kk(p.tile));
  }
  for (const [k, t] of pl.hidden.entries()) {
    rep.hidden++;
    sig.push(`gz${k + 1}@${kk(t)}`);
    if (!reach(t)) problems.push(`WALK-INTERIOR ${scene}: gizli köşe ${k + 1} ${kk(t)} ulaşılamıyor`);
    if (isInSacredBuffer(t, base)) problems.push(`WALK-INTERIOR ${scene}: gizli köşe ${k + 1} kutsal eğlence payında`);
    if (souv.has(kk(t)) || seen.has(kk(t))) problems.push(`WALK-INTERIOR ${scene}: gizli köşe ${k + 1} çakışıyor`);
    seen.add(kk(t));
  }
  // katalog kimlikleri ile yerleşim aynı sayıda öğe üretir
  const ids = exploreIds(scene);
  if (new Set(ids).size !== ids.length) problems.push(`WALK-INTERIOR ${scene}: yinelenen keşif kimliği`);
  rep.signature = sig.join("|");
  return rep;
}

// ------------------------------------------------------------------------------------------ INTERIOR-VIEW: merdiven
const k4 = (a: Tile, b: Tile) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1;

/** Katın başlangıçtan yüksekliğe duyarlı yürüyüşle ulaşılan karoları ve ayak yüksekliği. */
function walkReach(lv: InteriorLevel, start: Tile, y0: number): Map<string, number> {
  const nav = navGrid(lv.built);
  const hc = heightCtx(nav);
  const out = new Map<string, number>();
  if (!hc) return out;
  const s0 = standY(hc, start[0], start[1], y0);
  if (s0 === -Infinity) return out;
  out.set(kk(start), s0);
  const q: [number, number, number][] = [[start[0], start[1], s0]];
  while (q.length) {
    const [i, j, y] = q.shift()!;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= lv.built.width || nj >= lv.built.depth || out.has(`${ni},${nj}`)) continue;
      const ny = standY(hc, ni, nj, y);
      if (ny === -Infinity) continue;
      out.set(`${ni},${nj}`, ny);
      q.push([ni, nj, ny]);
    }
  }
  return out;
}

export interface StairReport { problems: string[]; reached: number; floors: number; links: number }

/** Merdiven geometrisi ve "her kata girişten merdivenle ulaşılır" kuralı. */
export function checkStairs(plan: InteriorPlan, tag: string): string[] { return stairReport(plan, tag).problems; }

export function stairReport(plan: InteriorPlan, tag = `${plan.scene}:${plan.site}`): StairReport {
  const problems: string[] = [];
  const L = plan.levels;
  let links = 0;
  for (const lv of L) {
    const lt = `WALK-INTERIOR ${tag}#${lv.index}`;
    if (lv.built.width !== L[0].built.width || lv.built.depth !== L[0].built.depth) problems.push(`${lt}: kat ayak izi ilk katla aynı değil`);
    const nav = navGrid(lv.built), hc = heightCtx(nav);
    for (const st of lv.stairs) {
      links++;
      const n = st.run.length;
      if (st.rise > STEP_H + 1e-6) problems.push(`${lt}: merdiven yükselişi ${st.rise.toFixed(2)} > ${STEP_H}`);
      for (let k = 1; k < n; k++) if (!k4(st.run[k - 1], st.run[k])) { problems.push(`${lt}: merdiven karoları 4-bağlı değil`); break; }
      const other = L[st.to];
      if (!other) { problems.push(`${lt}: merdiven hedef kat ${st.to} yok`); continue; }
      const back = other.stairs.find((o) => o.dir !== st.dir && o.to === lv.index && o.run.length === n && o.run.every((t, k) => kk(t) === kk(st.run[k])));
      if (!back) problems.push(`${lt}: kat ${st.to} karşılık merdiven bağı yok`);
      if (st.dir === "up") {
        if (kk(st.tile) !== kk(st.run[n - 1])) problems.push(`${lt}: yukarı tetik son basamak değil`);
        if (!walkable(nav, st.stand[0], st.stand[1]) || !k4(st.stand, st.run[0])) problems.push(`${lt}: merdiven ayağı ${kk(st.stand)} yürünemez ya da bitişik değil`);
        st.run.forEach((t, k) => {
          const i = t[1] * nav.width + t[0];
          const top = hc?.hf.top[i] ?? NaN;
          if (walkable(nav, t[0], t[1]) || !hc || hc.hf.climb[i] !== 1 || Math.abs(top - (k + 1) * st.rise) > 0.05)
            problems.push(`${lt}: basamak ${k + 1} ${kk(t)} tırmanılabilir değil ya da yüksekliği yanlış (${Number.isNaN(top) ? "yok" : top.toFixed(2)})`);
        });
        if (Math.abs(n * st.rise - lv.storey) > 0.01) problems.push(`${lt}: merdiven kat yüksekliğine varmıyor`);
        // tıkla-git: ayaktan son basamağa rota (merdiven üstünden)
        const route = planRoute(lv.built, { x: tx(st.stand[0]), z: tz(st.stand[1]), y: 0 }, st.tile, { climb: true });
        const last = route?.path[route.path.length - 1];
        if (!route || !last || kk(last) !== kk(st.tile)) problems.push(`${lt}: tıkla-git merdivenin tepesine rota bulamıyor`);
      } else {
        if (kk(st.tile) !== kk(st.run[n - 2]) || kk(st.stand) !== kk(st.run[n - 1])) problems.push(`${lt}: aşağı tetik/sahanlık yanlış`);
        if (!walkable(nav, st.tile[0], st.tile[1]) || !walkable(nav, st.stand[0], st.stand[1])) problems.push(`${lt}: sahanlık ya da boşluk ağzı yürünemez`);
        for (const t of st.run.slice(0, n - 2)) if (walkable(nav, t[0], t[1])) problems.push(`${lt}: merdiven boşluğu ${kk(t)} yürünebilir`);
      }
    }
  }
  // her kata girişten merdivenle yürüyerek ulaşılır
  const exit = L[0]?.portals.find((p) => p.to === "out");
  const seen = new Set<number>();
  if (exit) {
    // yer altı tarifinde (descend) giriş en üst kattır; bağlar iki yönde de izlenir (yukarı → varış sahanlığı y 0,
    // aşağı → alt katta aynı karoda basamak üstü `st.y`). Yalnız yukarı bağlı eski planlar için sonuç aynı.
    const todo: { lv: number; start: Tile; y: number }[] = [{ lv: 0, start: exit.arrive, y: 0 }];
    for (let cur = todo.shift(); cur; cur = todo.shift()) {
      if (seen.has(cur.lv)) continue;
      seen.add(cur.lv);
      const lv: InteriorLevel = L[cur.lv];
      const reach = walkReach(lv, cur.start, cur.y);
      if (!reach.size) { problems.push(`WALK-INTERIOR ${tag}#${cur.lv}: başlangıç ${kk(cur.start)} durulamaz`); break; }
      for (const st of lv.stairs) {
        const y = reach.get(kk(st.tile));
        if (y === undefined) { problems.push(`WALK-INTERIOR ${tag}#${cur.lv}: ${st.dir === "up" ? "yukarı" : "aşağı"} merdiven tetiği ${kk(st.tile)} başlangıçtan yürüyerek ulaşılamıyor`); continue; }
        if (st.dir === "up" && Math.abs(y - lv.storey) > 0.05) problems.push(`WALK-INTERIOR ${tag}#${cur.lv}: son basamakta ayak ${y.toFixed(2)} ≠ kat ${lv.storey}`);
      }
      for (const st of lv.stairs) {
        if (!reach.has(kk(st.tile)) || seen.has(st.to)) continue;
        todo.push(st.dir === "up" ? { lv: st.to, start: st.tile, y: 0 } : { lv: st.to, start: st.tile, y: st.y });
      }
      // asansör de kat bağıdır — kapının önü yürüyerek ulaşılır, hedef katta karşı kapının önüne varılır
      for (const l of lv.lifts) {
        if (!reach.has(kk(l.tile))) { problems.push(`WALK-INTERIOR ${tag}#${cur.lv}: asansör ${l.id} kapısının önü ${kk(l.tile)} başlangıçtan yürüyerek ulaşılamıyor`); continue; }
        if (!seen.has(l.to)) todo.push({ lv: l.to, start: l.toTile, y: 0 });
      }
    }
  }
  for (let k = 0; k < L.length; k++) if (!seen.has(k)) problems.push(`WALK-INTERIOR ${tag}: kat ${k + 1} girişten merdivenle ya da asansörle ulaşılamıyor`);
  return { problems, reached: seen.size, floors: L.length, links };
}
