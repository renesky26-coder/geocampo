import { localDb } from "./localDb";

// EGM96 geoid undulation grid for Brazil (6°N–34°S, 75°W–33°W, 0.25°), in cm.
const URL_GRID = "/_cdn/static/geoide_egm96_brasil_025.json";

type Grid = { lat0: number; lon0: number; step: number; rows: number; cols: number; data: Int16Array };
let grid: Grid | null = null;
let loading: Promise<void> | null = null;

function decode(j: any): Grid {
  const bin = atob(j.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { lat0: j.lat0, lon0: j.lon0, step: j.step, rows: j.rows, cols: j.cols, data: new Int16Array(bytes.buffer) };
}

/** Loads the grid once (cached on the device for offline use). */
function load(): Promise<void> {
  if (grid) return Promise.resolve();
  if (loading) return loading;
  loading = (async () => {
    try {
      const cached = await localDb.kv.get("geoid-egm96");
      if (cached?.value) {
        grid = decode(cached.value);
        return;
      }
      const r = await fetch(URL_GRID);
      if (!r.ok) return;
      const j = await r.json();
      grid = decode(j);
      await localDb.kv.put({ key: "geoid-egm96", value: j });
    } catch {
      /* offline and not cached yet */
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** Geoid undulation N (m) by bilinear interpolation, or null outside Brazil / not loaded. */
function undulation(lat: number, lon: number): number | null {
  if (!grid) return null;
  const y = (grid.lat0 - lat) / grid.step;
  const x = (lon - grid.lon0) / grid.step;
  if (x < 0 || y < 0 || x > grid.cols - 1 || y > grid.rows - 1) return null;
  const i = Math.min(Math.floor(y), grid.rows - 2);
  const j = Math.min(Math.floor(x), grid.cols - 2);
  const fy = y - i;
  const fx = x - j;
  const v = (r: number, c: number) => grid!.data[r * grid!.cols + c] / 100;
  return v(i, j) * (1 - fx) * (1 - fy) + v(i, j + 1) * fx * (1 - fy) + v(i + 1, j) * (1 - fx) * fy + v(i + 1, j + 1) * fx * fy;
}

const isIOS = () => typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);

/**
 * Attributes with the orthometric altitude H = h − N.
 * iPhone/iPad already report altitude above mean sea level, so only Android/desktop are converted.
 */
function orthoAttributes(lat: number, lon: number, h: number | null): Record<string, string> {
  if (h === null) return {};
  const N = undulation(lat, lon);
  if (N === null) return {};
  if (isIOS()) return { "gnss.ondulacao_geoidal_m": N.toFixed(2), "gnss.altitude_ortometrica_m": h.toFixed(2) };
  return { "gnss.ondulacao_geoidal_m": N.toFixed(2), "gnss.altitude_ortometrica_m": (h - N).toFixed(2) };
}

export const geoid = { load, undulation, orthoAttributes };
