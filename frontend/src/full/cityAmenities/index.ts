// FREE fallback of the sibling full-edition aggregator (the full edition resolves <name>.ts before <name>/index.ts).
import type { CityStyle } from "../../voxel/city/style";
import type { Amenity } from "../../voxel/districts/themes";

export function fullCityAmenity(_id: string, _s: CityStyle): Amenity[] | null { return null; }
