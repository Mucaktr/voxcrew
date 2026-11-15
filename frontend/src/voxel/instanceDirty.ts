/**
 * örnek tamponlarında yalnız DEĞİŞEN yuvaları GPU'ya yükle.
 *
 * `instanceMatrix.needsUpdate = true` aralıksız çağrılınca three kapasitenin TAMAMINI `bufferSubData` ile yükler (kare başı yüzlerce KB).
 * Yazıcılar `put16` ile yalnız değer değiştiyse true döner → yuva `marks`'a işaretlenir; kare sonunda `flushMarks` işaretli yuvaları
 * (aralarındaki küçük boşluklar birleştirilerek) `addUpdateRange` ile bildirir. İşaret yoksa hiç yükleme yok. Görüntü aynıdır:
 * CPU dizisi zaten doğru değerleri tutar; yalnızca aktarılan bayt azalır.
 * KURAL: bu yoldaki her yazıcı yuvayı işaretlemeli (işaretsiz yazım GPU'ya gitmez) — tam yükleme gerekiyorsa `all` verin.
*/
import type * as THREE from "three";

/** İşaret bitleri: matris / renk. */
export const DM = 1, DC = 2;

/** 16 sayılık matrisi `o` konumuna yazar (Float32 yuvarlamasıyla karşılaştırır); değiştiyse true. */
export function put16(arr: Float32Array, o: number, e: ArrayLike<number>): boolean {
  let ch = false;
  for (let i = 0; i < 16; i++) { const v = Math.fround(e[i]); if (arr[o + i] !== v) { arr[o + i] = v; ch = true; } }
  return ch;
}

const marksByMesh = new WeakMap<THREE.Object3D, Uint8Array>();
/** Mesh'e bağlı yuva işaretleri (n yuva; tampon büyüyünce yeniden). */
export function marksOf(mesh: THREE.Object3D, n: number): Uint8Array {
  let m = marksByMesh.get(mesh);
  if (!m || m.length < n) marksByMesh.set(mesh, m = new Uint8Array(n));
  return m;
}

/** `bit` işaretli yuvaları birleştirilmiş aralıklar olarak `attr`'a bildirir (boşluk ≤ `gap` yuva birleşir). `all` ya da aralık
 *  birikmesi (mesh görünmezken yüklenmez) → tam yükleme. Döner: bildirilen yuva sayısı. İşaretleri temizlemez. */
export function flushMarks(attr: THREE.BufferAttribute, stride: number, marks: Uint8Array, bit: number, all: boolean, gap = 32): number {
  const n = flushRuns(attr, stride, marks, bit, all, gap);
  if (verifyOn()) verify(attr, stride, marks, bit, all || n === marks.length);
  return n;
}

// ---- DENETİM (yalnız geliştirme; `globalThis.__voxcrewVerifyUpload = true`): GPU'da olması gereken içerik = yalnız bildirilen aralıklar.
// Gölge kopya yalnız bildirilen yuvalarla güncellenir; sonra CPU dizisiyle birebir karşılaştırılır → işaretsiz yazım (kaçan yuva) yakalanır.
type G = { __voxcrewVerifyUpload?: boolean; __voxcrewUploadErrors?: { stride: number; slot: number }[] };
// `DEV !== false`: üretim paketinde (DEV=false) bayrak yok sayılır; Node testlerinde (import.meta.env yok) açık kalır.
const verifyOn = () => import.meta.env?.DEV !== false && (globalThis as G).__voxcrewVerifyUpload === true;
const shadows = new WeakMap<object, Float32Array>();
function verify(attr: THREE.BufferAttribute, stride: number, marks: Uint8Array, bit: number, full: boolean) {
  const a = attr.array as Float32Array;
  let sh = shadows.get(attr);
  if (full || !sh || sh.length !== a.length) { shadows.set(attr, sh = a.slice()); return; }
  for (let k = 0; k < marks.length; k++) if (marks[k] & bit) sh.set(a.subarray(k * stride, (k + 1) * stride), k * stride);
  // (boşluk dolgusu da GPU'ya gider; gölge yalnız işaretli yuvaları taşır → eşitsizlik yalnız GERÇEK kaçaklarda çıkar ya da dolgu eşit değerdedir)
  for (let i = 0; i < a.length; i++) if (sh[i] !== a[i]) { ((globalThis as G).__voxcrewUploadErrors ??= []).push({ stride, slot: Math.floor(i / stride) }); sh[i] = a[i]; }
}

/** Tam yüklemeden sonra (flushMarks / flushDiff dışında) gölgeyi ve son yüklenen kopyayı sıfırla. */
export function resetShadow(attr: THREE.BufferAttribute) { shadows.delete(attr); sent.delete(attr); }

// ---- diziye doğrudan yazan katmanlar (Ambient, SceneFx, World bölge nabzı) için fark tabanlı işaret.
// Yazıcıya dokunmadan: kare sonunda dizi, GPU'ya son gönderilen kopyayla yuva yuva karşılaştırılır; yalnız değişen yuvalar işaretlenip
// flushMarks ile yüklenir. Kopya yoksa (ilk kare / resetShadow sonrası / boyut değişti) tam yükleme. Kaçan yuva olamaz: işaret = fark.
const sent = new WeakMap<object, Float32Array>();
const diffMarks = new WeakMap<object, Uint8Array>();
/** `attr`'ın yalnız değişen yuvalarını yükler (yuva = `stride` sayı). Döner: yüklenen yuva sayısı (0 = yükleme yok). */
export function flushDiff(attr: THREE.BufferAttribute, stride: number, gap = 32): number {
  const a = attr.array as Float32Array, n = a.length / stride;
  let p = sent.get(attr), m = diffMarks.get(attr);
  if (!m || m.length !== n) diffMarks.set(attr, m = new Uint8Array(n));
  if (!p || p.length !== a.length) { sent.set(attr, a.slice()); m.fill(1); const k = flushMarks(attr, stride, m, 1, true, gap); m.fill(0); return k; }
  for (let k = 0, o = 0; k < n; k++, o += stride) {
    for (let i = 0; i < stride; i++) {
      if (p[o + i] !== a[o + i]) { m[k] = 1; for (let j = i; j < stride; j++) p[o + j] = a[o + j]; break; }
    }
  }
  const k = flushMarks(attr, stride, m, 1, false, gap);
  m.fill(0);
  return k;
}

// bekleyen TAM yükleme. Tam yükleme istenip henüz GPU'ya gitmeden (çizim atlanan kare: program kapısı, görünmez ağ) sonraki
// karede aralık eklenirse three YALNIZ aralıkları yükler → tam yüklemenin geri kalanı kaybolur (ölçüldü: portal sonrası avatar
// bacakları çizilmedi). Tam yükleme bekliyorsa aralık eklenmez, tam kalır; three yükleyince (onUploadCallback) bayrak düşer.
const fullPending = new WeakSet<object>();
function markFull(attr: THREE.BufferAttribute) {
  attr.clearUpdateRanges(); attr.needsUpdate = true;
  if (fullPending.has(attr)) return;
  fullPending.add(attr);
  const own = Object.prototype.hasOwnProperty.call(attr, "onUploadCallback"), prev = attr.onUploadCallback;
  attr.onUploadCallback = function (this: THREE.BufferAttribute) {
    fullPending.delete(attr);
    if (own) attr.onUploadCallback = prev; else delete (attr as { onUploadCallback?: unknown }).onUploadCallback;
    return prev.call(this);
  };
}
/** Tam yükleme GPU'ya gitmeyi bekliyor mu (test/denetim). */
export const fullUploadPending = (attr: THREE.BufferAttribute) => fullPending.has(attr);

function flushRuns(attr: THREE.BufferAttribute, stride: number, marks: Uint8Array, bit: number, all: boolean, gap: number): number {
  if (all || fullPending.has(attr) || attr.updateRanges.length > 256) { markFull(attr); return marks.length; }
  let n = 0, s = -1, last = -1;
  for (let k = 0; k < marks.length; k++) {
    if (!(marks[k] & bit)) continue;
    if (s >= 0 && k - last <= gap) { last = k; continue; }
    if (s >= 0) { attr.addUpdateRange(s * stride, (last - s + 1) * stride); n += last - s + 1; }
    s = last = k;
  }
  if (s >= 0) { attr.addUpdateRange(s * stride, (last - s + 1) * stride); n += last - s + 1; }
  if (n) attr.needsUpdate = true;
  return n;
}
