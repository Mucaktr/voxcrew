/**
 * W5 (WALK-W5) — fotoğraf modu saf yardımcıları: filtre renk matrisleri (önizlemede SVG
 * `feColorMatrix`, kayıtta aynı matris piksel döngüsüyle → önizleme = çıktı), çerçeve dikdörtgenleri (önizlemede yüzde,
 * kayıtta piksel), dosya adı ve yerel galeri (IndexedDB). Gölgelendirici ya da son işlem geçişi yok (+0 çizim çağrısı).
 *
 * Gizlilik: fotoğraf yalnızca kullanıcının tıklamasıyla tarayıcı indirmesi olarak kaydedilir ve isteğe bağlı olarak bu
 * tarayıcının IndexedDB'sinde tutulur; hiçbir yere yüklenmez. Ad etiketleri (ajan verisi) kullanıcı açmadıkça karede yoktur.
*/

export const PHOTO_FILTERS = ["none", "warm", "cool", "retro"] as const;
export type PhotoFilter = (typeof PHOTO_FILTERS)[number];
export const PHOTO_FRAMES = ["none", "polaroid", "film", "corners"] as const;
export type PhotoFrame = (typeof PHOTO_FRAMES)[number];

/** 3 × 4 renk matrisi (satır: R, G, B; sütun: r, g, b, sabit — 0–1 ölçeğinde). Alfa değişmez. */
export type ColorMatrix = readonly [number, number, number, number, number, number, number, number, number, number, number, number];

export const FILTER_MATRIX: Readonly<Record<Exclude<PhotoFilter, "none">, ColorMatrix>> = {
  // sıcak: kırmızı/sarı hafif artar, mavi azalır
  warm: [1.08, 0.04, 0, 0.02, 0.02, 1.0, 0, 0.01, 0, 0, 0.86, 0],
  // soğuk: mavi ve camgöbeği artar
  cool: [0.9, 0, 0.02, 0, 0, 1.0, 0.04, 0.01, 0.02, 0.04, 1.1, 0.03],
  // retro: %60 sepya + hafif solukluk
  retro: [0.585, 0.424, 0.104, 0.05, 0.192, 0.747, 0.093, 0.05, 0.15, 0.294, 0.441, 0.06],
};

/** SVG `feColorMatrix` değerleri (4 × 5; alfa satırı birim). */
export function svgMatrixValues(m: ColorMatrix): string {
  return [m[0], m[1], m[2], 0, m[3], m[4], m[5], m[6], 0, m[7], m[8], m[9], m[10], 0, m[11], 0, 0, 0, 1, 0].join(" ");
}

/** RGBA bayt dizisine matrisi uygular (yerinde). */
export function applyMatrix(data: Uint8ClampedArray, m: ColorMatrix): void {
  const o0 = m[3] * 255, o1 = m[7] * 255, o2 = m[11] * 255;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    data[i] = m[0] * r + m[1] * g + m[2] * b + o0;
    data[i + 1] = m[4] * r + m[5] * g + m[6] * b + o1;
    data[i + 2] = m[8] * r + m[9] * g + m[10] * b + o2;
  }
}

/** Çerçeve dikdörtgeni: konum ve boyut kare genişliği/yüksekliğinin oranı (0–1); `c` renk. */
export interface FrameRect { x: number; y: number; w: number; h: number; c: string }

/** Çerçevenin dikdörtgenleri (önizleme ve kayıt aynı listeyi kullanır). `aspect` = genişlik / yükseklik. */
export function frameRects(kind: PhotoFrame, aspect: number): FrameRect[] {
  const a = Math.max(0.3, aspect);
  switch (kind) {
    case "polaroid": {
      const s = 0.035, sx = s / a, bottom = 0.13;
      const c = "#FBFAF5";
      return [{ x: 0, y: 0, w: 1, h: s, c }, { x: 0, y: 1 - bottom, w: 1, h: bottom, c }, { x: 0, y: 0, w: sx, h: 1, c }, { x: 1 - sx, y: 0, w: sx, h: 1, c }];
    }
    case "film": {
      const bar = 0.085, out: FrameRect[] = [{ x: 0, y: 0, w: 1, h: bar, c: "#111111" }, { x: 0, y: 1 - bar, w: 1, h: bar, c: "#111111" }];
      const holeH = bar * 0.38, holeW = holeH * 1.4 / a, n = Math.max(6, Math.round(14 * Math.min(a, 2) / 1.6));
      for (let k = 0; k < n; k++) {
        const x = (k + 0.5) / n - holeW / 2;
        out.push({ x, y: (bar - holeH) / 2, w: holeW, h: holeH, c: "#E7E2D3" }, { x, y: 1 - bar + (bar - holeH) / 2, w: holeW, h: holeH, c: "#E7E2D3" });
      }
      return out;
    }
    case "corners": {
      const L = 0.09, t = 0.012, m = 0.03, Lx = L / a, tx = t / a, mx = m / a, c = "#FFFFFF";
      return [
        { x: mx, y: m, w: Lx, h: t, c }, { x: mx, y: m, w: tx, h: L, c },
        { x: 1 - mx - Lx, y: m, w: Lx, h: t, c }, { x: 1 - mx - tx, y: m, w: tx, h: L, c },
        { x: mx, y: 1 - m - t, w: Lx, h: t, c }, { x: mx, y: 1 - m - L, w: tx, h: L, c },
        { x: 1 - mx - Lx, y: 1 - m - t, w: Lx, h: t, c }, { x: 1 - mx - tx, y: 1 - m - L, w: tx, h: L, c },
      ];
    }
    default: return [];
  }
}

/** İndirme dosya adı: `yuruyus-<sahne>-YYYYMMDD-HHMMSS.png` (kişisel veri yok). */
export function photoFileName(scene: string | null, d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const safe = (scene ?? "dunya").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 32) || "dunya";
  return `yuruyus-${safe}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`;
}

// ------------------------------------------------------------------ yerel galeri (IndexedDB; yalnız bu tarayıcı)
export interface GalleryPhoto { id: number; ts: number; scene: string; blob: Blob }
const DB = "vc-walk-photos";
const STORE = "photos";
export const GALLERY_MAX = 24;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("no-idb")); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb"));
  });
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error ?? new Error("idb")); });
}

/** Galeriyi (yeniden eskiye) okur; IndexedDB yoksa ya da engelliyse boş liste. */
export async function listPhotos(): Promise<GalleryPhoto[]> {
  try {
    const db = await openDb();
    const all = await done(db.transaction(STORE, "readonly").objectStore(STORE).getAll() as IDBRequest<GalleryPhoto[]>);
    db.close();
    return all.sort((x, y) => y.ts - x.ts);
  } catch { return []; }
}

/** Fotoğrafı galeriye ekler; en çok `GALLERY_MAX` tutulur (en eskiler düşer). Başarısızsa false. */
export async function addPhoto(blob: Blob, scene: string): Promise<boolean> {
  try {
    const db = await openDb();
    const st = db.transaction(STORE, "readwrite").objectStore(STORE);
    await done(st.add({ ts: Date.now(), scene, blob }));
    const all = await done(db.transaction(STORE, "readonly").objectStore(STORE).getAll() as IDBRequest<GalleryPhoto[]>);
    const extra = all.sort((x, y) => y.ts - x.ts).slice(GALLERY_MAX);
    if (extra.length) {
      const del = db.transaction(STORE, "readwrite").objectStore(STORE);
      for (const p of extra) del.delete(p.id);
    }
    db.close();
    return true;
  } catch { return false; }
}

/** Galeriden bir fotoğrafı kaldırır (yalnız bu tarayıcının yerel galerisi). */
export async function removePhoto(id: number): Promise<void> {
  try {
    const db = await openDb();
    await done(db.transaction(STORE, "readwrite").objectStore(STORE).delete(id));
    db.close();
  } catch { /* yoksay */ }
}

/** Tarayıcı indirmesi (kullanıcının tıklamasıyla); yükleme yok. */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}
