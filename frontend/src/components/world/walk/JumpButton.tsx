/**
 * WALK-PHYS — dokunmatik Zıpla düğmesi (Boşluk tuşunun karşılığı). `walkRuntime.jump` sayacını artırır; WalkRig bir sonraki
 * karede tüketir (zıplama tamponu 0,12 sn: erken basış inişte çalışır). Dokunuşta parmak değer değmez zıplar (tıklama
 * beklenmez); fare ve klavye (Enter/Boşluk odaktayken) tıklamayla. Dokunma hedefi ≥ 48 px, `aria-label`, odak halkası `btn`
 * sınıfından. Hareket azaltmada da çalışır (yalnız kamera sallanması yok; bkz. WalkRig).
 */
import { ArrowUpFromLine } from "lucide-react";
import { useRef } from "react";
import { walkRuntime } from "../../../voxel/walk/walkStore";

export function JumpButton({ label }: { label: string }) {
  const touchedAt = useRef(0);
  return (
    <button type="button" data-walk-jump="" className="btn min-h-12 min-w-12 !p-0 grid place-items-center touch-manipulation" aria-label={label} title={label}
      onPointerDown={(e) => { if (e.pointerType !== "mouse") { touchedAt.current = performance.now(); walkRuntime.jump++; } }}
      onClick={() => { if (performance.now() - touchedAt.current > 600) walkRuntime.jump++; }}>
      <ArrowUpFromLine size={18} aria-hidden="true" />
    </button>
  );
}
