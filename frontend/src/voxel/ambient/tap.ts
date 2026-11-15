/**
 * WATER-ALL — suya dokunma tepkisinin tek giriş noktası (ambient/Ambient.tsx `Interactables` ile aynı kurallar): sakin bölgede tepkisiz,
 * hareket azaltmada parçacık yok (ses + etiket var), aksi halde şapırtı parçacığı + ses + kısa etiket. Ortam hayvanları (ördek/balık)
 * kaçışını Ambient çağırır (`poke`); çevre arazisinde (Outskirts) ortam hayvanı yoktur, yalnız bu tepki çalışır.
 */
import { tx as msg } from "../../lib/i18n";
import { world as M } from "../../locales/world";
import { say } from "../fun/announce";
import { inQuietZone } from "../fun/brain";
import { burst } from "../fun/fx";
import type { WorldLive } from "../live";
import { reducedMotion } from "../motion";
import { playSfx } from "../sfx/sfx";
import { hotCue, noteTouch, touchPlan } from "./touch";

/** (x, z) noktasında yüzeyi `top` olan suya dokunuldu. Tepki verildiyse true. */
export function tapWater(live: WorldLive, x: number, top: number, z: number): boolean {
  const plan = touchPlan("hot", { quiet: inQuietZone(x, z), reduced: reducedMotion() });
  if (!plan.react) { noteTouch({ target: "hot", kind: "water", msg: null, sfx: null, motion: false, quiet: true }); return false; }
  const [key, cue, fx] = hotCue("water");
  burst(live.fx, "splash", x, top + 0.02, z);
  playSfx(cue);
  say(msg(M, key), x, top + 0.35, z);
  noteTouch({ target: "hot", kind: "water", msg: key, sfx: cue, motion: plan.motion, quiet: false });
  return fx !== null;
}
