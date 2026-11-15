/**
 * Kapatılan lambalar (gece dokunuşu). Ambient'teki dokunuş yazar; Props okur ve kapalı lambanın zemindeki ışık havuzunu
 * ile nokta ışığını söndürür (yalnız ampul kapağı yetmiyordu: direğin dibi aydınlık kalıyordu).
 * Anahtar: lamba işaretinin (`k: "lamp"`) x,z konumu. Dünya değişince Ambient temizler.
 */

type Listener = () => void;

const off = new Set<string>();
const listeners = new Set<Listener>();
let version = 0;

const emit = () => { version++; listeners.forEach((f) => f()); };

/** Lamba işaretinin anahtarı (aynı işaretten iki taraf aynı anahtarı üretir). */
export const lampKey = (x: number, z: number) => `${x.toFixed(2)},${z.toFixed(2)}`;

export const lampSwitch = {
  isOff: (key: string) => off.has(key),
  set(key: string, isOff: boolean) {
    if (isOff === off.has(key)) return;
    if (isOff) off.add(key); else off.delete(key);
    emit();
  },
  clear() {
    if (!off.size) return;
    off.clear();
    emit();
  },
  subscribe(f: Listener) { listeners.add(f); return () => { listeners.delete(f); }; },
  version: () => version,
};
