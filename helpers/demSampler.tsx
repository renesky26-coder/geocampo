import { localDb, type ImportedLayer } from "./localDb";
import { geo } from "./geo";

type Grid = { id: string; name: string; W: number; H: number; minLat: number; maxLat: number; minLon: number; maxLon: number; data: Float32Array };

const cache = new Map<string, Grid>();
let loaded: Grid[] = [];

/** Loads the elevation grids of visible single-band GeoTIFF layers (MDT/DEM). */
async function refresh(layers?: ImportedLayer[]): Promise<number> {
  const all = layers ?? (await localDb.layers.toArray());
  const dems = all.filter((l) => l.kind === "geotiff" && l.visible && l.dem && l.bounds && l.meta?.demW);
  const next: Grid[] = [];
  for (const l of dems) {
    let g = cache.get(l.id);
    if (!g) {
      const buf = await l.dem!.arrayBuffer();
      const [[minLat, minLon], [maxLat, maxLon]] = l.bounds!;
      g = { id: l.id, name: l.name, W: l.meta!.demW, H: l.meta!.demH, minLat, maxLat, minLon, maxLon, data: new Float32Array(buf) };
      cache.set(l.id, g);
    }
    next.push(g);
  }
  loaded = next;
  return loaded.length;
}

function sampleGrid(g: Grid, lat: number, lon: number): number | null {
  if (lat < g.minLat || lat > g.maxLat || lon < g.minLon || lon > g.maxLon) return null;
  const x = ((lon - g.minLon) / (g.maxLon - g.minLon)) * g.W - 0.5;
  const y = ((g.maxLat - lat) / (g.maxLat - g.minLat)) * g.H - 0.5;
  const i = Math.max(0, Math.min(g.W - 2, Math.floor(x)));
  const j = Math.max(0, Math.min(g.H - 2, Math.floor(y)));
  const fx = Math.min(1, Math.max(0, x - i));
  const fy = Math.min(1, Math.max(0, y - j));
  const v = (c: number, r: number) => g.data[r * g.W + c];
  const q = [v(i, j), v(i + 1, j), v(i, j + 1), v(i + 1, j + 1)];
  if (q.some((n) => !isFinite(n))) {
    const near = v(Math.round(x), Math.round(y));
    return isFinite(near) ? near : null;
  }
  return q[0] * (1 - fx) * (1 - fy) + q[1] * fx * (1 - fy) + q[2] * (1 - fx) * fy + q[3] * fx * fy;
}

/** Elevation from the first loaded MDT covering the point (synchronous; call refresh first). */
function sample(lat: number, lon: number): { value: number; layer: string } | null {
  for (const g of loaded) {
    const v = sampleGrid(g, lat, lon);
    if (v !== null) return { value: v, layer: g.name };
  }
  return null;
}

/** Elevation profile along a line ([lon, lat] vertices). */
function profile(coords: [number, number][], samples = 160): { layer: string | null; points: { d: number; z: number | null }[] } {
  if (coords.length < 2) return { layer: null, points: [] };
  const seg: number[] = [0];
  for (let k = 1; k < coords.length; k++) seg.push(seg[k - 1] + geo.distanceM(coords[k - 1], coords[k]));
  const total = seg[seg.length - 1];
  const pts: { d: number; z: number | null }[] = [];
  let layer: string | null = null;
  for (let s = 0; s <= samples; s++) {
    const d = (total * s) / samples;
    let k = 1;
    while (k < seg.length - 1 && seg[k] < d) k++;
    const t = seg[k] > seg[k - 1] ? (d - seg[k - 1]) / (seg[k] - seg[k - 1]) : 0;
    const lon = coords[k - 1][0] + (coords[k][0] - coords[k - 1][0]) * t;
    const lat = coords[k - 1][1] + (coords[k][1] - coords[k - 1][1]) * t;
    const r = sample(lat, lon);
    if (r && !layer) layer = r.layer;
    pts.push({ d: Math.round(d * 10) / 10, z: r ? Math.round(r.value * 100) / 100 : null });
  }
  return { layer, points: pts };
}

export const demSampler = { refresh, sample, profile };
