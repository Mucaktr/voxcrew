/**
 * portal / iç mekân geçişinde gölgelendirici derleme takılması.
 *
 * Şehre girişte ilk şehir karesinde three ~11 yeni programın hepsini aynı karede derler ve ilk kullanımda bağlama sonucunu EŞZAMANLI
 * bekler (`getProgramInfoLog`); bu, şehir kurulumu görevine eklenip tek uzun kare yapıyordu. Çözüm: sahne değişince (`token`) çizim
 * kısa süre tutulur (öncelikli boş useFrame → r3f `gl.render` çağırmaz; tuval son kareyi gösterir: geçişte zaten siyah örtü, hareket
 * azaltmada eski kare — eskiden de takılma boyunca donmuş eski kare görünüyordu), programlar `gl.compile` ile oluşturulup ilk kullanımı
 * küçük görevlere bölünür (görev başına ≤ SLICE_MS; tek program tek başına daha uzun sürebilir). Bitince ilk çizilen kare TAM sahnedir
 * (parça parça belirme yok); geçiş mağazaları örtüyü kapı açılana dek tutar (gateState.afterGate).
 * NOT: KHR_parallel_shader_compile ile `isReady` yoklaması denendi ve BIRAKILDI — vsync'li Chrome/ANGLE-D3D11'de program çizim
 * olmadan hiç "hazır" olmadı (2 sn sınırına takıldı, siyah örtü +1,8 sn). Ölçümler raporda.
*/
import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useRef, useState } from "react";
import { drainPrograms, gateStats, HOLD_MAX_MS, type GateProgram } from "./gateState";

/** Bir görevde en çok bu kadar ms derleme (yeni program tek başına daha uzun sürebilir; o zaman görev başına bir program). */
export const SLICE_MS = 12;

/** Bekleme kararı (saf; node testi): ilk bağlanmada (sahne yükleme ekranı zaten var) beklenmez, yalnız sahne değişince. */
export function shouldHold(prev: string | null, token: string): boolean {
  return prev !== null && prev !== token;
}

if (import.meta.env.DEV) (window as unknown as { __voxcrewGate?: typeof gateStats }).__voxcrewGate = gateStats;

export function ProgramGate({ token }: { token: string }) {
  const gl = useThree((s) => s.gl), scene = useThree((s) => s.scene), camera = useThree((s) => s.camera);
  const [hold, setHold] = useState(false);
  const prev = useRef<string | null>(null);
  // layout etkisi: sahne nesneleri bu kayıtta zaten sahnede (r3f bağlama aşaması), ilk rAF çiziminden ÖNCE
  useLayoutEffect(() => {
    const p = prev.current;
    prev.current = token;
    if (!shouldHold(p, token)) return;
    let live = true, tm = 0;
    const t0 = performance.now();
    const done = (capped: boolean) => {
      if (!live) return;
      live = false; setHold(false); gateStats.busy = false;
      gateStats.n++; gateStats.lastMs = Math.round(performance.now() - t0); if (capped) gateStats.capped++;
    };
    setHold(true); gateStats.busy = true;
    // 1) tüm malzemelerin programları oluşturulur (yeniler derlemeye gönderilir; mevcutlar önbellekten)
    let pending: (GateProgram | undefined)[] = [];
    try {
      pending = [...gl.compile(scene, camera)].map((m) => (gl.properties.get(m) as { currentProgram?: GateProgram }).currentProgram);
      gl.getContext().flush();
    } catch { pending = []; } // derleme hatası çizimi asla kilitlemesin: hata eskisi gibi ilk çizimde görünür
    // 2) ilk kullanım (bağlama sonucu + uniform konumları: eşzamanlı gidiş-dönüş) küçük görevlere bölünür, görev başına ≤ SLICE_MS
    const step = () => {
      if (!live) return;
      if (performance.now() - t0 > HOLD_MAX_MS) { done(true); return; } // kalanlar eskisi gibi ilk çizimde
      try { drainPrograms(pending, () => performance.now(), SLICE_MS); } catch { pending.length = 0; }
      if (pending.length) tm = window.setTimeout(step, 0); else done(false);
    };
    tm = window.setTimeout(step, 0); // React kaydı bitsin; ilk dilim ayrı görevde
    return () => { live = false; window.clearTimeout(tm); setHold(false); gateStats.busy = false; };
  }, [token, gl, scene, camera]);
  return hold ? <Hold /> : null;
}

/** Bağlı olduğu sürece r3f sahneyi çizmez (öncelik > 0 aboneliği r3f'in otomatik `gl.render`'ını kapatır); kare mantığı sürer. */
function Hold() {
  useFrame(() => {}, 1);
  return null;
}
