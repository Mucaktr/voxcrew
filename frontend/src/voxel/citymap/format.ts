/**
 * şehir haritası biçimi (`voxcrew-world` v1.3 `city_map`).
 *
 * Şehir haritası ofis tabanından AYRI, yalnız yürüme modunda yüklenen büyük bir yürüme dünyasıdır (SK-K1). Biçim:
 * - `gate`: varış meydanı (12 × 16 karo, şehir karosu [0, 12) × [0, 16)); şehrin iskelesi (`pier`) ya da meydanı (`plaza`).
 * "Ofise dön" kapısı buradadır. Semtler bu kutuyla kesişmez.
 * - `districts`: semtler — kimlik, tohum, sınır `[i0, j0, w, d]` (şehir karosu; parsel ızgarasına hizalı: i0, w 12'nin, j0, d
 * 16'nın katı; 24 ≤ w ≤ 96, 32 ≤ d ≤ 96; tipik 48 × 48), tema, landmark yerleşimleri (semt yerel karo), giriş noktaları,
 * seyir noktaları. Semtler birbiriyle kesişmez.
 * - `stops`: duraklar (semt + semt yerel karo). `lines`: ulaşım hatları (araç türü, durak sırası, isteğe bağlı rota noktaları).
 *
 * Doğrulama (`cityMapIssues`) sorunlu alan yollarını döndürür (boş → geçerli). Backend `worlds/validate.py city_map_issues` aynı
 * kuralları uygular (eşlik testi: backend/tests/test_city_map.py). Saf modül: React/three yok.
*/

export const CITY_FORMAT_VERSION = 1.3;
/** Parsel ızgarası (expanse/grid.ts PW × PD ile aynı): semt sınırı bu ızgaraya hizalı. */
export const CITY_PW = 12;
export const CITY_PD = 16;
/** Varış meydanı (gate) boyu (şehir karosu [0, GATE_W) × [0, GATE_D)). */
export const GATE_W = 12;
export const GATE_D = 16;
/** Tipik semt boyu (plan §2: semt başına ~48 × 48 karo). */
export const DISTRICT_SIZE = 48;
export const DISTRICT_MIN_W = 24;
export const DISTRICT_MIN_D = 32;
export const DISTRICT_MAX = 96;
export const MAX_DISTRICTS = 8;
export const MAX_LANDMARKS = 8;
export const MAX_ENTRIES = 6;
export const MAX_VIEWPOINTS = 4;
export const MAX_STOPS = 24;
export const MAX_LINES = 8;
export const MAX_ROUTE = 64;
/** Şehir karosu koordinat sınırı (|i|, |j|). */
export const CITY_COORD_MAX = 1024;
/** Landmark boyu sınırları (yer tutucu siluet;+ gerçek oranlı landmark kütüphanesi kendi bütçesini taşır).*/
export const LANDMARK_MAX_W = 20; // aslan gövdeli heykelin gerçek oranı (boy 17,5) için 16 → 20
export const LANDMARK_MAX_H = 24;

export const DISTRICT_THEMES = ["generic", "historic", "harbor", "modern", "garden", "bazaar", "hill"] as const;
export type DistrictTheme = (typeof DISTRICT_THEMES)[number];
export const VEHICLE_KINDS = ["vapur", "tramvay", "funikuler", "kayik", "metro", "teleferik", "otobus", "monoray", "balon"] as const;
export type VehicleKind = (typeof VEHICLE_KINDS)[number];
export const LANDMARK_SHAPES = ["tower", "hall", "dome", "arch", "obelisk"] as const;
export type LandmarkShape = (typeof LANDMARK_SHAPES)[number];
/** İç mekân sahne modeli türleri (interiors/catalog.ts SiteKind alt kümesi; ibadet yeri iç mekânı şehirde de kapalı). */
export const LANDMARK_INTERIORS = ["tower", "museum", "castle", "terrace", "lobby", "courtyard"] as const; // COURTYARD-PORTAL: avlu
export type LandmarkInterior = (typeof LANDMARK_INTERIORS)[number];
export const GATE_KINDS = ["pier", "plaza"] as const;

export type CityTile = [number, number];

export interface CityLandmark {
  id: string;
  shape: LandmarkShape;
  /** sol-arka karo (semt yerel) */
  tile: CityTile;
  w: number;
  d: number;
  /** yükseklik (yürüme ölçeği birimi; insan 1, kat 1,6) */
  h: number;
  /** girilebilir landmark: kapı karosu (semt yerel, yürünebilir, ayak izinin dışında) ve iç mekân türü */
  door?: CityTile;
  interior?: LandmarkInterior;
}

export interface CityDistrict {
  id: string;
  /** belirlenimci üretim tohumu (0 … 2³²−1) */
  seed: number;
  /** [i0, j0, w, d] — şehir karosu */
  bounds: [number, number, number, number];
  theme: DistrictTheme;
  landmarks: CityLandmark[];
  /** giriş noktaları (semt yerel; hızlı seyahat dışı varış) */
  entries: CityTile[];
  /** seyir noktaları (semt yerel; üstünde birinci şahıs) */
  viewpoints?: CityTile[];
}

export interface CityStop { id: string; district: string; tile: CityTile; /** CABLEVP1: biniş platformu (turnike, panel, varış) karosu, semt yerel; yoksa `tile`. Teleferik uç durağında kabin halat ucunda (`tile`) durur, yolcu istasyonun platformundan biner*/ board?: CityTile }
export interface CityLine {
  id: string;
  kind: VehicleKind;
  /** durak sırası (≥ 2) */
  stops: string[];
  /** isteğe bağlı rota (şehir karosu; yoksa duraklar arası dik köşeli çizgi) */
  route?: CityTile[];
}

export interface CityMapFile {
  id: string;
  gate: { kind: (typeof GATE_KINDS)[number] };
  /** deniz düzlemi (kıyı şehirleri): semtlerin altında ve ötesinde su */
  sea?: boolean;
  districts: CityDistrict[];
  stops: CityStop[];
  lines: CityLine[];
}

const ID = /^[a-z][a-z0-9_]{0,23}$/;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isTile = (v: unknown): v is CityTile => Array.isArray(v) && v.length === 2 && isInt(v[0]) && isInt(v[1]);
const keysOk = (o: Record<string, unknown>, allowed: readonly string[]) => Object.keys(o).every((k) => allowed.includes(k));

const MAP_KEYS = ["id", "gate", "sea", "districts", "stops", "lines"];
const DISTRICT_KEYS = ["id", "seed", "bounds", "theme", "landmarks", "entries", "viewpoints"];
const LANDMARK_KEYS = ["id", "shape", "tile", "w", "d", "h", "door", "interior"];
const STOP_KEYS = ["id", "district", "tile", "board"]; // CABLEVP1: board isteğe bağlı (biniş platformu)
const LINE_KEYS = ["id", "kind", "stops", "route"];

/** Karo semt yerel sınırın içinde mi. */
const inLocal = (t: CityTile, w: number, d: number) => t[0] >= 0 && t[1] >= 0 && t[0] < w && t[1] < d;
const overlap = (a: number[], b: number[]) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

/**
 * v1.3 `city_map` bloğunun sorunlu alan yolları (boş → geçerli). Kapalı şema; kimlikler `^[a-z][a-z0-9_]{0,23}$`, tekil.
 * Backend `worlds/validate.py city_map_issues` ile aynı sıra ve yollar.
 */
export function cityMapIssues(raw: unknown): string[] {
  if (!isObj(raw)) return ["city_map"];
  const out: string[] = Object.keys(raw).filter((k) => !MAP_KEYS.includes(k)).map((k) => `city_map.${k}`);
  if (typeof raw.id !== "string" || !ID.test(raw.id)) out.push("city_map.id");
  const gate = raw.gate;
  if (!isObj(gate) || !keysOk(gate, ["kind"]) || !(GATE_KINDS as readonly unknown[]).includes(gate.kind)) out.push("city_map.gate");
  if (raw.sea !== undefined && typeof raw.sea !== "boolean") out.push("city_map.sea");
  const districts = raw.districts;
  const dist = new Map<string, number[]>();
  if (!Array.isArray(districts) || districts.length < 1 || districts.length > MAX_DISTRICTS) out.push("city_map.districts");
  else districts.forEach((d, n) => {
    const p = `city_map.districts[${n}]`;
    if (!isObj(d) || !keysOk(d, DISTRICT_KEYS)) { out.push(p); return; }
    if (typeof d.id !== "string" || !ID.test(d.id) || dist.has(d.id)) out.push(`${p}.id`);
    if (!(isInt(d.seed) && d.seed >= 0 && d.seed < 2 ** 32)) out.push(`${p}.seed`);
    if (!(DISTRICT_THEMES as readonly unknown[]).includes(d.theme)) out.push(`${p}.theme`);
    const b = d.bounds;
    const okB = Array.isArray(b) && b.length === 4 && b.every(isInt)
      && b[0] % CITY_PW === 0 && b[1] % CITY_PD === 0 && b[2] % CITY_PW === 0 && b[3] % CITY_PD === 0
      && b[2] >= DISTRICT_MIN_W && b[2] <= DISTRICT_MAX && b[3] >= DISTRICT_MIN_D && b[3] <= DISTRICT_MAX
      && Math.abs(b[0]) <= CITY_COORD_MAX && Math.abs(b[1]) <= CITY_COORD_MAX
      && Math.abs(b[0] + b[2]) <= CITY_COORD_MAX && Math.abs(b[1] + b[3]) <= CITY_COORD_MAX
      && !overlap(b as number[], [0, 0, GATE_W, GATE_D])
      && ![...dist.values()].some((o) => overlap(o, b as number[]));
    if (!okB) { out.push(`${p}.bounds`); return; }
    const [, , w, dd] = b as number[];
    if (typeof d.id === "string") dist.set(d.id, b as number[]);
    const lms = d.landmarks;
    const lmIds = new Set<string>();
    if (!Array.isArray(lms) || lms.length > MAX_LANDMARKS) out.push(`${p}.landmarks`);
    else lms.forEach((lm, k) => {
      const q = `${p}.landmarks[${k}]`;
      if (!isObj(lm) || !keysOk(lm, LANDMARK_KEYS)) { out.push(q); return; }
      if (typeof lm.id !== "string" || !ID.test(lm.id) || lmIds.has(lm.id)) out.push(`${q}.id`);
      else lmIds.add(lm.id);
      if (!(LANDMARK_SHAPES as readonly unknown[]).includes(lm.shape)) out.push(`${q}.shape`);
      const size = isInt(lm.w) && isInt(lm.d) && lm.w >= 1 && lm.d >= 1 && lm.w <= LANDMARK_MAX_W && lm.d <= LANDMARK_MAX_W;
      if (!size) out.push(`${q}.size`);
      if (!(isNum(lm.h) && lm.h >= 0.5 && lm.h <= LANDMARK_MAX_H)) out.push(`${q}.h`);
      // ayak izi semt içinde, kenar halkasının (1 karo) içinde: semt kenarları yürünebilir kalır
      if (!isTile(lm.tile) || !size || !(lm.tile[0] >= 1 && lm.tile[1] >= 1 && lm.tile[0] + (lm.w as number) <= w - 1 && lm.tile[1] + (lm.d as number) <= dd - 1)) out.push(`${q}.tile`);
      const hasDoor = lm.door !== undefined, hasIn = lm.interior !== undefined;
      if (hasDoor !== hasIn) out.push(`${q}.door`);
      if (hasIn && !(LANDMARK_INTERIORS as readonly unknown[]).includes(lm.interior)) out.push(`${q}.interior`);
      if (hasDoor) {
        const t = lm.door;
        const inside = isTile(t) && isTile(lm.tile) && size && t[0] >= lm.tile[0] && t[1] >= lm.tile[1] && t[0] < lm.tile[0] + (lm.w as number) && t[1] < lm.tile[1] + (lm.d as number);
        if (!isTile(t) || !inLocal(t, w, dd) || inside) out.push(`${q}.door`);
      }
    });
    const entries = d.entries;
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > MAX_ENTRIES || !entries.every((t) => isTile(t) && inLocal(t, w, dd))) out.push(`${p}.entries`);
    if (d.viewpoints !== undefined && !(Array.isArray(d.viewpoints) && d.viewpoints.length <= MAX_VIEWPOINTS && d.viewpoints.every((t) => isTile(t) && inLocal(t, w, dd)))) out.push(`${p}.viewpoints`);
  });
  const stops = raw.stops;
  const stopIds = new Set<string>();
  if (!Array.isArray(stops) || stops.length > MAX_STOPS) out.push("city_map.stops");
  else stops.forEach((s, n) => {
    const p = `city_map.stops[${n}]`;
    if (!isObj(s) || !keysOk(s, STOP_KEYS)) { out.push(p); return; }
    if (typeof s.id !== "string" || !ID.test(s.id) || stopIds.has(s.id)) out.push(`${p}.id`);
    else stopIds.add(s.id);
    const b = typeof s.district === "string" ? dist.get(s.district) : undefined;
    if (!b) out.push(`${p}.district`);
    else if (!isTile(s.tile) || !inLocal(s.tile, b[2], b[3])) out.push(`${p}.tile`);
    if (b && s.board !== undefined && (!isTile(s.board) || !inLocal(s.board, b[2], b[3]))) out.push(`${p}.board`);
  });
  const lines = raw.lines;
  const lineIds = new Set<string>();
  if (!Array.isArray(lines) || lines.length > MAX_LINES) out.push("city_map.lines");
  else lines.forEach((l, n) => {
    const p = `city_map.lines[${n}]`;
    if (!isObj(l) || !keysOk(l, LINE_KEYS)) { out.push(p); return; }
    if (typeof l.id !== "string" || !ID.test(l.id) || lineIds.has(l.id)) out.push(`${p}.id`);
    else lineIds.add(l.id);
    if (!(VEHICLE_KINDS as readonly unknown[]).includes(l.kind)) out.push(`${p}.kind`);
    const st = l.stops;
    if (!Array.isArray(st) || st.length < 2 || st.length > MAX_STOPS || !st.every((x) => typeof x === "string" && stopIds.has(x)) || new Set(st).size !== st.length) out.push(`${p}.stops`);
    if (l.route !== undefined && !(Array.isArray(l.route) && l.route.length >= 2 && l.route.length <= MAX_ROUTE
      && l.route.every((t) => isTile(t) && Math.abs(t[0]) <= CITY_COORD_MAX && Math.abs(t[1]) <= CITY_COORD_MAX))) out.push(`${p}.route`);
  });
  return out;
}

// ------------------------------------------------------------------------------------------ yardımcılar (saf)
/** Semt yerel karo → şehir karosu. */
export const toCity = (d: Pick<CityDistrict, "bounds">, t: CityTile): CityTile => [d.bounds[0] + t[0], d.bounds[1] + t[1]];
/** Şehir karosunun semti (yoksa null). */
export function districtAt(map: Pick<CityMapFile, "districts">, I: number, J: number): CityDistrict | null {
  for (const d of map.districts) {
    const [i0, j0, w, dd] = d.bounds;
    if (I >= i0 && J >= j0 && I < i0 + w && J < j0 + dd) return d;
  }
  return null;
}
/** Durağın şehir karosu. */
export function stopTile(map: Pick<CityMapFile, "districts">, s: CityStop): CityTile | null {
  const d = map.districts.find((x) => x.id === s.district);
  return d ? toCity(d, s.tile) : null;
}
/** CABLEVP1: durağın biniş platformu (şehir karosu; turnike, panel, varış); yoksa null.*/
export function stopBoard(map: Pick<CityMapFile, "districts">, s: CityStop): CityTile | null {
  const d = s.board ? map.districts.find((x) => x.id === s.district) : null;
  return d && s.board ? toCity(d, s.board) : null;
}
/** Gate kutusunun içinde mi (şehir karosu). */
export const inGate = (I: number, J: number) => I >= 0 && J >= 0 && I < GATE_W && J < GATE_D;
