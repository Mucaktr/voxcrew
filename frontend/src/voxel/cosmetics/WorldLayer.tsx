/**
 * COS-B — sahip olunan kozmetiklerin canlı dünyada çizimi ("her yerde çizili" kapısının canlı yüzü).
 *
 * - Masa süsü: ajan masalarındaki her monitörün yanına (masa yüksekliğinde, monitörle aynı yöne bakar; en çok 48 masa).
 * - Dünya teması: gökyüzü ve sis paleti + dünyanın arkasında fon şeridi (kutup ışığı, ampul dizisi…). Yeni sahne değildir.
 * - Kutlama: oyun kutlaması (`useGame.burst`) her tetiklendiğinde dünya ortasında oynar; hareket azaltmada statik hâl.
 * Hiçbiri seçili değilse bileşen hiçbir şey bağlamaz (+0 çizim çağrısı). Seçim yalnız sahip olunan, giyilebilir ve bayrak
 * açıkken etkindir (lib/cosmetics `useLiveEquip`). Kıyafetler bu katmanda değil, Crowd'un parça listesinde çizilir.
*/
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useGame } from "../../lib/game";
import type { LiveEquip } from "../../lib/cosmetics";
import type { Built } from "../scenes";
import { tx as tileX, tz } from "../scenes";
import { CelebrationBoxes, CosmeticBoxes, type Layer } from "./Boxes";
import type { CelebrationItem, DeskItem, WorldItem } from "./registry";

const MAX_DESKS = 48;
const DESK_SCALE = 1 / 22;

/** Masa monitörleri (bir istasyona ≤ 1,6 birim yakın ekran işaretleri; Props.tsx ile aynı eşleme). */
export function deskAnchors(built: Pick<Built, "props" | "stations">): { pos: [number, number, number]; rotY: number }[] {
  const out: { pos: [number, number, number]; rotY: number }[] = [];
  for (const m of built.props ?? []) {
    if (m.k !== "screen" || out.length >= MAX_DESKS) continue;
    if (!built.stations.some((s) => Math.hypot(tileX(s.tile[0]) - m.p[0], tz(s.tile[1]) - m.p[2]) < 1.6)) continue;
    const r = m.r, side = 0.55;
    // ekranın yerel +x ekseni (cos r, 0, −sin r) boyunca yana, masa yüzeyine (ekran merkezi masa + 0,52)
    out.push({ pos: [m.p[0] + Math.cos(r) * side, m.p[1] - 0.52, m.p[2] - Math.sin(r) * side], rotY: r });
  }
  return out;
}

function DeskAndTheme({ built, desk, world, cx, cz, half }:
  { built: Built; desk?: DeskItem; world?: WorldItem; cx: number; cz: number; half: number }) {
  const layers = useMemo<Layer[]>(() => {
    const out: Layer[] = [];
    if (desk) {
      const boxes = desk.boxes();
      for (const a of deskAnchors(built)) out.push({ boxes, at: { pos: a.pos, rotY: a.rotY, scale: DESK_SCALE } });
    }
    if (world) {
      // fon: tasarım ±52 px → dünya yarı genişliği; derinlik sıkıştırılır ve dünyanın arka kenarına konur
      const s = Math.max(half, 8) / 52;
      out.push({ boxes: world.theme.boxes(), at: { pos: [cx, 0, cz - half - 1], scale: [s, s, s * 0.15] } });
    }
    return out;
  }, [built, desk, world, cx, cz, half]);
  return <CosmeticBoxes layers={layers} />;
}

/** Dünya temasının gökyüzü/sis rengi: World'ün kendi rengini her karede ezer, kapanınca geri yükler. */
function ThemeSky({ sky }: { sky: string }) {
  const scene = useThree((s) => s.scene);
  const saved = useRef<{ bg: THREE.Color | null; fog: THREE.Color | null }>({ bg: null, fog: null });
  const want = useMemo(() => new THREE.Color(sky), [sky]);
  useFrame(() => {
    const bg = scene.background instanceof THREE.Color ? scene.background : null;
    const fog = scene.fog ? scene.fog.color : null;
    if (bg && !bg.equals(want)) { saved.current.bg ??= bg.clone(); bg.copy(want); }
    if (fog && !fog.equals(want)) { saved.current.fog ??= fog.clone(); fog.copy(want); }
  });
  useEffect(() => () => {
    const s = saved.current;
    if (s.bg && scene.background instanceof THREE.Color) scene.background.copy(s.bg);
    if (s.fog && scene.fog) scene.fog.color.copy(s.fog);
  }, [scene, want]);
  return null;
}

function LiveCelebration({ item, cx, cz, half }: { item: CelebrationItem; cx: number; cz: number; half: number }) {
  const n = useGame((s) => s.burst.n);
  const celebrations = useGame((s) => s.profile?.celebrations !== false);
  const [start, setStart] = useState(0);
  const first = useRef(n);
  useEffect(() => {
    if (n === first.current || !celebrations) return;
    setStart(performance.now());
  }, [n, celebrations]);
  const scale = Math.min(4, Math.max(1, half / 12)) / 16;
  return <CelebrationBoxes item={item} start={start} at={{ pos: [cx, 0.02, cz], scale }} />;
}

export function CosmeticWorldLayer({ built, live, cx, cz, half }: { built: Built; live: LiveEquip; cx: number; cz: number; half: number }) {
  const desk = live.desk?.slot === "desk" ? live.desk : undefined;
  const world = live.world?.slot === "world" ? live.world : undefined;
  const cel = live.celebration?.slot === "celebration" ? live.celebration : undefined;
  if (!desk && !world && !cel) return null;
  return (
    <>
      {(desk || world) && <DeskAndTheme built={built} desk={desk} world={world} cx={cx} cz={cz} half={half} />}
      {world && <ThemeSky sky={world.theme.sky} />}
      {cel && <LiveCelebration item={cel} cx={cx} cz={cz} half={half} />}
    </>
  );
}
