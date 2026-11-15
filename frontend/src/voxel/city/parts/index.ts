/**
 * ortak simge parçaları. Şehir ekibi buradan içe aktarır:
 *
 * import { builderSink, gableRow, latticeTower } from "../../city/parts";
 * gableRow(builderSink(b), { x0: tx(4) - 0.5, z0: tz(2) - 0.5, n: 5 }); // sahne (sonra `blockRect`)
 * near: (c) => { const out: Block[] = []; latticeTower(sink(out), { x: c.cx, z: c.cz, w: c.w, height: { top: c.h } }); return out; }
 *
 * Plan tablosu → parça: gableRow (<city>) · shophouseRow (<city>, Hanoi) · windTower (<city>, Marakeş) · riadCourt
 * (Marakeş) · archArcade (<city>, Marakeş, <city>, <city>) · ruinColumns (<city>, <city>) · tiledRoofHall + pagodaRoof (<city>,
 * Hanoi, <city>) · lanternString (<city>, <city>, Hanoi) · latticeTower (<city>, <city>) · pierBoat (hepsi) · canalBoat
 * (<city>, Meksiko, <city>) · marketStallRow (hepsi) · spireSilhouette (<city>, <city>, Marakeş, <city>; uzak, sacred) ·
 * pyramidStylized (<city>). Ek genel parçalar: tower, domeCap, domeHall, archGate, minaretSilhouette, bridgeSpan, canalEdge,
 * plazaPaving. Her parça ≤ 120 kutu (`PART_BOX_BUDGET`); denetim `scripts/city_parts.test.mjs`.
*/
export * from "./core";
export * from "./buildings";
export * from "./monuments";
export * from "./water";
export * from "./street";
