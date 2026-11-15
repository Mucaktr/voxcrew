/**
 * CITYLIFE — paylaşılan çalışma zamanı: şehir haritası parsel akışı (CityRig `start` bağlar, `teardown` çözer; figüranlar yüklü
 * parsellerin yakın bloklarını buradan okur — ayrıca parsel üretilmez) ve figüranların özet sayaçları (geliştirme kancası / perf).
 */
import type { CityStream } from "../citymap/source";

export const cityLifeRuntime: {
  stream: CityStream | null;
  /** son karenin özeti: dolaşan, yakın ayrıntıda çizilen, oturan, satıcı, çizilen örnek sayısı, hedef */
  stats: { figs: number; near: number; seated: number; vendors: number; instances: number; target: number; ms: number };
  /** figüranların ayak konumları (kare başı; WalkRig takip kamerasını kişilerden uzak tutar)*/
  people: { x: number; y: number; z: number }[];
  /** figüran kolu yakın plana düşürecekti — kamera statik kolda, koridordaki figüranlar çizilmez (WalkRig yazar)*/
  veil: boolean;
} = { stream: null, stats: { figs: 0, near: 0, seated: 0, vendors: 0, instances: 0, target: 0, ms: 0 }, people: [], veil: false };
