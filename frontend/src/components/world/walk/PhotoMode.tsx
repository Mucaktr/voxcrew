/**
 * W5 (WALK-W5) — fotoğraf modu (P). Tembel yüklenir (WalkHud).
 *
 * - HUD gizlenir; kamera serbesttir ama yürüme sınırında kalır (odak avatarın 10 birimi ve dünya ızgarası; WalkRig).
 * Klavye: WASD/oklar odak, Q/E döndür, R/C (PageUp/PageDown) eğim, +/− mesafe, F/Enter/Boşluk çek, Esc kapat.
 * Fare: sürükle döndür, tekerlek mesafe. Dokunma: tek parmak döndür, kıstırma mesafe.
 * - Filtreler (yok, sıcak, soğuk, retro) önizlemede SVG renk matrisi (CSS `filter: url`), kayıtta aynı matris (photo.ts).
 * - Çerçeveler (yok, polaroid, film, köşeler) önizlemede kaplama, kayıtta aynı dikdörtgenler.
 * - Ad etiketleri (ajan verisi) varsayılan kapalı: tuvaldeki etiket katmanı ve HUD katmanı gizlenir, karede yoktur.
 * - Kaydet: o karede çizilen tuval (preserveDrawingBuffer yok; WalkRig `capture`) → PNG → tarayıcı indirmesi (kullanıcının
 * tıklaması); isteğe bağlı bu tarayıcıdaki galeriye (IndexedDB). Yükleme yok.
*/
import clsx from "clsx";
import { Camera, Download, Images, Square, SquareCheck, Tags, Trash2, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useT } from "../../../lib/i18n";
import { walk as WM } from "../../../locales/walk";
import { reducedMotion } from "../../../voxel/motion";
import { SHUTTER_EVENT } from "../../../voxel/walk/input";
import { useWalkStore, walkRuntime } from "../../../voxel/walk/walkStore";
import { inQuietZone } from "../../../voxel/fun/brain";
import { announceWalk } from "./announce";
import { insetBottom } from "./media";
import {
  addPhoto, applyMatrix, downloadBlob, FILTER_MATRIX, frameRects, listPhotos, photoFileName, PHOTO_FILTERS, PHOTO_FRAMES, removePhoto,
  svgMatrixValues, type GalleryPhoto, type PhotoFilter, type PhotoFrame,
} from "./photo";

/** Avatar ya da fotoğraf odağı sessiz/kutsal bölgede mi (§3.4).*/
function quietNow(): boolean {
  try {
    const a = walkRuntime.avatar, f = walkRuntime.photoFocus;
    return inQuietZone(a.x, a.z) || (f.ok && inQuietZone(f.x, f.z));
  } catch { return false; }
}

interface Layers { gl: HTMLCanvasElement | null; labels: HTMLCanvasElement | null; overlay: HTMLElement | null }

function findLayers(host: HTMLElement | null): Layers {
  const app = host?.querySelector<HTMLElement>('[role="application"]') ?? null;
  return {
    gl: app?.querySelector<HTMLCanvasElement>("canvas:not([aria-hidden])") ?? null,
    labels: app?.querySelector<HTMLCanvasElement>(':scope > canvas[aria-hidden="true"]') ?? null,
    overlay: app?.querySelector<HTMLElement>(":scope > div.isolate") ?? null,
  };
}

export default function PhotoMode({ host, onFocusWorld }: { host: HTMLElement | null; onFocusWorld?: () => void }) {
  const t = useT(WM);
  const uid = useId().replace(/:/g, "");
  const [filter, setFilter] = useState<PhotoFilter>("none");
  const [frame, setFrame] = useState<PhotoFrame>("none");
  const [tags, setTags] = useState(false);
  const [keep, setKeep] = useState(true);
  const [busy, setBusy] = useState(false);
  const [gallery, setGallery] = useState<GalleryPhoto[] | null>(null);
  const [flash, setFlash] = useState(false);
  const [aspect, setAspect] = useState(1.6);
  const layers = useMemo(() => findLayers(host), [host]);
  const scene = useWalkStore((s) => s.world);
  // FIX-UX (A21): sessiz/kutsal bölgede filtre/çerçeve yok. W5: serbest kamera bölgeye uçabildiği için
  // yalnız açılışta değil, avatar VE fotoğraf odağı için 4 Hz'de ve deklanşörde yeniden denetlenir.
  const [quiet, setQuiet] = useState(quietNow);
  useEffect(() => {
    const id = window.setInterval(() => setQuiet(quietNow()), 250);
    return () => window.clearInterval(id);
  }, []);
  const fxView: PhotoFilter = quiet ? "none" : filter;
  const frView: PhotoFrame = quiet ? "none" : frame;

  // önizleme filtresi (tuval CSS'i) ve etiket katmanlarının görünürlüğü; kapanınca eski hâline
  useEffect(() => {
    const gl = layers.gl;
    if (!gl) return;
    const prev = gl.style.filter;
    gl.style.filter = fxView === "none" ? "" : `url(#${uid}-${fxView})`;
    return () => { gl.style.filter = prev; };
  }, [fxView, layers.gl, uid]);
  useEffect(() => {
    const els = [layers.labels, layers.overlay].filter(Boolean) as HTMLElement[];
    const prev = els.map((e) => e.style.visibility);
    els.forEach((e) => { e.style.visibility = tags ? "" : "hidden"; });
    return () => { els.forEach((e, i) => { e.style.visibility = prev[i]; }); };
  }, [tags, layers.labels, layers.overlay]);
  useEffect(() => {
    const el = layers.gl;
    if (!el) return;
    const ro = new ResizeObserver(() => setAspect(el.clientWidth / Math.max(1, el.clientHeight)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [layers.gl]);
  useEffect(() => () => { walkRuntime.capture = null; }, []);

  const close = () => { useWalkStore.getState().setPhoto(false); onFocusWorld?.(); };

  const shoot = () => {
    if (busy) return;
    setBusy(true);
    walkRuntime.capture = (gl) => {
      // W5: deklanşör anında bölge yeniden okunur (4 Hz denetimin arasında bölgeye girilmiş olabilir)
      const q = quietNow();
      if (q !== quiet) setQuiet(q);
      const fx: PhotoFilter = q ? "none" : fxView, fr: PhotoFrame = q ? "none" : frView;
      try {
        const w = gl.width, h = gl.height;
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const ctx = c.getContext("2d");
        if (!ctx) throw new Error("2d");
        ctx.drawImage(gl, 0, 0);
        if (tags && layers.labels) ctx.drawImage(layers.labels, 0, 0, w, h);
        if (fx !== "none") {
          const img = ctx.getImageData(0, 0, w, h);
          applyMatrix(img.data, FILTER_MATRIX[fx]);
          ctx.putImageData(img, 0, 0);
        }
        for (const r of frameRects(fr, w / Math.max(1, h))) { ctx.fillStyle = r.c; ctx.fillRect(Math.round(r.x * w), Math.round(r.y * h), Math.ceil(r.w * w), Math.ceil(r.h * h)); }
        c.toBlob((blob) => {
          setBusy(false);
          if (!blob) { announceWalk(t("photo_failed")); return; }
          downloadBlob(blob, photoFileName(scene));
          if (keep) void addPhoto(blob, scene ?? "").then((ok) => { if (ok && gallery) void listPhotos().then(setGallery); });
          announceWalk(t("photo_saved"));
          if (!reducedMotion()) { setFlash(true); window.setTimeout(() => setFlash(false), 160); }
        }, "image/png");
      } catch {
        setBusy(false);
        announceWalk(t("photo_failed"));
      }
    };
  };
  // F / Enter / Boşluk dünya kabında çeker (input.ts onShutter → bu olay)
  const shootRef = useRef(shoot);
  shootRef.current = shoot;
  useEffect(() => {
    const on = () => shootRef.current();
    window.addEventListener(SHUTTER_EVENT, on);
    return () => window.removeEventListener(SHUTTER_EVENT, on);
  }, []);

  // sürükle döndür / tekerlek mesafe (tek işaretçi; iki parmak WalkHud jest kancasında)
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const pointers = useRef(new Set<number>());
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.add(e.pointerId);
    if (pointers.current.size > 1) { drag.current = null; return; }
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    walkRuntime.yawDelta -= (e.clientX - d.x) * 0.006;
    walkRuntime.pitchDelta += (e.clientY - d.y) * 0.004;
    d.x = e.clientX; d.y = e.clientY;
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => { pointers.current.delete(e.pointerId); if (drag.current?.id === e.pointerId) drag.current = null; };

  const onBarKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
  };
  const openGallery = () => { if (gallery) setGallery(null); else void listPhotos().then(setGallery); };

  const rects = frameRects(frView, aspect);
  return (
    <>
      {/* filtre tanımları (önizleme) */}
      <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
        {PHOTO_FILTERS.filter((f) => f !== "none").map((f) => (
          <filter key={f} id={`${uid}-${f}`} colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values={svgMatrixValues(FILTER_MATRIX[f as Exclude<PhotoFilter, "none">])} />
          </filter>
        ))}
      </svg>
      {/* serbest kamera yüzeyi (sürükle/tekerlek) */}
      <div className="absolute inset-0 z-[15] cursor-grab touch-none" aria-hidden="true" data-walk-surface=""
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onWheel={(e) => { walkRuntime.zoomMul *= Math.exp(Math.max(-60, Math.min(60, e.deltaY)) * 0.004); }} />
      {/* çerçeve önizlemesi */}
      {rects.length > 0 && (
        <div className="absolute inset-0 z-[16] pointer-events-none" aria-hidden="true">
          {rects.map((r, i) => <span key={i} className="absolute block" style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`, background: r.c }} />)}
        </div>
      )}
      {flash && <div className="absolute inset-0 z-[17] bg-white/70 pointer-events-none" aria-hidden="true" />}

      {/* araç çubuğu */}
      <div role="toolbar" aria-label={t("photo_toolbar")} onKeyDown={onBarKey}
        className="absolute inset-x-3 z-30 flex flex-col items-center gap-2 pointer-events-none" style={{ bottom: insetBottom("0.75rem") }}>
        {gallery && (
          <div className="panel !rounded-xl shadow-lg p-2 w-full max-w-[40rem] max-h-[30dvh] overflow-y-auto overscroll-contain pointer-events-auto">
            <p className="text-xs text-ink-2 px-1 pb-1.5">{gallery.length ? t("photo_gallery_note") : t("photo_gallery_empty")}</p>
            {gallery.length > 0 && (
              <ul className="flex gap-2 overflow-x-auto pb-1" aria-label={t("photo_gallery")}>
                {gallery.map((p, i) => <GalleryItem key={p.id} photo={p} n={i + 1} onRemoved={() => setGallery((g) => g?.filter((x) => x.id !== p.id) ?? null)} />)}
              </ul>
            )}
          </div>
        )}
        <div className="panel !rounded-xl shadow-lg w-full max-w-[40rem] p-2 flex flex-wrap items-center gap-1.5 pointer-events-auto">
          {/* FIX-UX (A21): kutsal / sessiz bölgede filtre ve çerçeve yok (§3.4); seçimler kapalı ve nedeni yazılı*/}
          <ChipGroup label={t("photo_filter")} value={fxView} options={PHOTO_FILTERS} render={(f) => t(`photo_filter_${f}` as const)} onPick={setFilter} disabled={quiet} />
          <ChipGroup label={t("photo_frame")} value={frView} options={PHOTO_FRAMES} render={(f) => t(`photo_frame_${f}` as const)} onPick={setFrame} disabled={quiet} />
          {quiet && <p role="note" data-photo-quiet="" className="w-full text-xs font-semibold text-ink-2">{t("photo_quiet")}</p>}
          <div className="flex flex-wrap items-center gap-1.5 w-full">
            <button type="button" className={clsx("btn btn-sm min-h-11", tags && "btn-primary")} aria-pressed={tags} onClick={() => setTags((v) => !v)}>
              <Tags size={15} aria-hidden="true" />{t("photo_tags")}
            </button>
            {/* 13 × 13 onay kutusu yerine düğmenin tamamı (44 px) aç/kapa — "Etiketler" ile aynı kalıp*/}
            <button type="button" className={clsx("btn btn-sm min-h-11", keep && "btn-primary")} aria-pressed={keep} onClick={() => setKeep((v) => !v)}>
              {keep ? <SquareCheck size={15} aria-hidden="true" /> : <Square size={15} aria-hidden="true" />}{t("photo_keep")}
            </button>
            <button type="button" className="btn btn-sm min-h-11" aria-expanded={!!gallery} onClick={openGallery}>
              <Images size={15} aria-hidden="true" />{t("photo_gallery")}
            </button>
            <span className="flex-1" />
            <button type="button" className="btn btn-sm min-h-11" onClick={close} aria-label={t("photo_close_aria")}>
              <X size={15} aria-hidden="true" />{t("photo_close")}
            </button>
            <button type="button" className="btn btn-primary min-h-11" onClick={shoot} disabled={busy} aria-keyshortcuts="F Enter Space">
              <Camera size={16} aria-hidden="true" />{busy ? t("photo_saving") : t("photo_shoot")}
            </button>
          </div>
          {/* klavye ipucu dokunmatikte gizli (yatay telefonda sm: genişliği aşılıyordu)*/}
          <p className="w-full text-xs text-ink-2 hidden sm:block pointer-coarse:!hidden">{t("photo_hint")}</p>
        </div>
      </div>
    </>
  );
}

/** çip ince işaretçide geniş ekranda 36 px; dokunmatikte yatayda da 44 px (`pointer-fine:sm:`).*/
function ChipGroup<T extends string>({ label, value, options, render, onPick, disabled }: { label: string; value: T; options: readonly T[]; render: (v: T) => string; onPick: (v: T) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} aria-disabled={disabled || undefined} className="flex flex-nowrap sm:flex-wrap overflow-x-auto sm:overflow-visible items-center gap-1 w-full sm:w-auto"> {/* telefonda tek satır kayar (panel ekranın ~%45'ini kaplıyordu)*/}
      <span className="text-xs font-semibold text-ink-2 mr-0.5 shrink-0">{label}</span>
      {options.map((o) => (
        <button key={o} type="button" role="radio" aria-checked={o === value} disabled={disabled} onClick={() => onPick(o)}
          className={clsx("btn btn-sm min-h-11 pointer-fine:sm:min-h-9", "shrink-0", o === value && "btn-primary")}>{render(o)}</button>
      ))}
    </div>
  );
}

function GalleryItem({ photo, n, onRemoved }: { photo: GalleryPhoto; n: number; onRemoved: () => void }) {
  const t = useT(WM);
  const url = useMemo(() => URL.createObjectURL(photo.blob), [photo.blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const when = new Date(photo.ts).toLocaleString();
  return (
    <li className="shrink-0 flex flex-col gap-1 items-center">
      <img src={url} alt={t("photo_gallery_alt", { n, when })} className="h-16 w-24 object-cover rounded-md border-2 border-line" />
      <span className="flex gap-1">
        <button type="button" className="btn btn-sm min-h-11 min-w-11 !p-0 grid place-items-center" aria-label={t("photo_download_aria", { n })}
          onClick={() => downloadBlob(photo.blob, photoFileName(photo.scene || null, new Date(photo.ts)))}><Download size={14} aria-hidden="true" /></button>
        <button type="button" className="btn btn-sm min-h-11 min-w-11 !p-0 grid place-items-center" aria-label={t("photo_remove_aria", { n })}
          onClick={() => { void removePhoto(photo.id).then(onRemoved); }}><Trash2 size={14} aria-hidden="true" /></button>
      </span>
    </li>
  );
}
