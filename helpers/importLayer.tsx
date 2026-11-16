import JSZip from "jszip";
import { kml as kmlToGeoJson, gpx as gpxToGeoJson } from "@tmcw/togeojson";
// @ts-ignore — shpjs ships without type declarations
import shp from "shpjs";
import proj4 from "proj4";
import { loadGeoTiff } from "./loadGeoTiff";
import { localDb, type ImportedLayer } from "./localDb";
import { newId } from "./newId";
import { geo } from "./geo";
import { loadSqlJs } from "./loadSqlJs";
import { crsRegistry, CrsUnknownError } from "./crsRegistry";

const palette = ["#2e5e73", "#6b5a8e", "#b07a12", "#3f6b47", "#8a3b5c", "#1f7a7a"];

function bboxOf(fc: any): [[number, number], [number, number]] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const walk = (c: any) => {
    if (typeof c[0] === "number") {
      minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0]);
      minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1]);
    } else c.forEach(walk);
  };
  for (const f of fc.features ?? []) if (f?.geometry?.coordinates) walk(f.geometry.coordinates);
  if (!isFinite(minX)) return null;
  return [[minY, minX], [maxY, maxX]];
}

function normalizeFc(input: any): any {
  if (Array.isArray(input)) {
    return { type: "FeatureCollection", features: input.flatMap((x) => normalizeFc(x).features) };
  }
  if (input?.type === "FeatureCollection") return { ...input, features: input.features.filter((f: any) => f?.geometry) };
  if (input?.type === "Feature") return { type: "FeatureCollection", features: [input] };
  if (input?.type && input?.coordinates) return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: input }] };
  throw new Error("Arquivo sem feições válidas.");
}

function parseXml(text: string) {
  return new DOMParser().parseFromString(text, "text/xml");
}

async function vectorFromFile(file: File, crsOverride?: string): Promise<any> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".kml")) return normalizeFc(kmlToGeoJson(parseXml(await file.text())));
  if (name.endsWith(".gpx")) return normalizeFc(gpxToGeoJson(parseXml(await file.text())));
  if (name.endsWith(".kmz")) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const kmlEntry = Object.values(zip.files).find((f) => f.name.toLowerCase().endsWith(".kml"));
    if (!kmlEntry) throw new Error("KMZ sem arquivo .kml interno.");
    return normalizeFc(kmlToGeoJson(parseXml(await kmlEntry.async("text"))));
  }
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    const text = (await file.text()).replace(/^\uFEFF/, "");
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) throw new Error("CSV vazio.");
    const sep = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ";" : lines[0].includes("\t") ? "\t" : ",";
    const split = (l: string) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
    const head = split(lines[0]);
    const low = head.map((h) => h.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
    const find = (...names: string[]) => low.findIndex((h) => names.includes(h));
    const xi = find("lon", "long", "longitude", "lng", "x", "e", "easting", "utm_e", "este", "leste");
    const yi = find("lat", "latitude", "y", "n", "northing", "utm_n", "norte");
    if (xi < 0 || yi < 0) throw new Error("Não achei as colunas de coordenadas. Use cabeçalhos como lat/lon, latitude/longitude ou x/y (E/N para UTM).");
    const num = (s: string) => Number(sep === ";" ? s.replace(",", ".") : s);
    const features = lines.slice(1).flatMap((l) => {
      const c = split(l);
      const x = num(c[xi]);
      const y = num(c[yi]);
      if (!isFinite(x) || !isFinite(y)) return [];
      const props: Record<string, string> = {};
      head.forEach((h, i) => i !== xi && i !== yi && (props[h] = c[i] ?? ""));
      return [{ type: "Feature", properties: props, geometry: { type: "Point", coordinates: [x, y] } }];
    });
    const fc = { type: "FeatureCollection", features };
    if (crsOverride) return crsRegistry.reprojectGeoJson(fc, await crsRegistry.resolve(crsOverride));
    if (crsRegistry.looksProjected(fc)) throw new CrsUnknownError("O CSV parece estar em coordenadas projetadas (metros).", "Escolha a projeção dos pontos, ex.: SIRGAS 2000 / UTM 22S.");
    return fc;
  }
  if (name.endsWith(".geojson") || name.endsWith(".json")) {
    const raw = JSON.parse(await file.text());
    const declared: string | undefined = raw?.crs?.properties?.name ?? (raw?.crs?.properties?.code ? `EPSG:${raw.crs.properties.code}` : undefined);
    const fc = normalizeFc(raw);
    const src = crsOverride ?? (declared && !/4326|CRS84/i.test(declared) ? declared : undefined);
    if (src) return crsRegistry.reprojectGeoJson(fc, await crsRegistry.resolve(src));
    if (crsRegistry.looksProjected(fc)) {
      throw new CrsUnknownError("O GeoJSON está em coordenadas projetadas e não informa o sistema.", "Escolha a projeção em que o arquivo foi gerado.");
    }
    return fc;
  }
  if (name.endsWith(".zip")) {
    const buf = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buf);
    const prjEntry = Object.values(zip.files).find((f) => f.name.toLowerCase().endsWith(".prj"));
    const prjText = prjEntry ? (await prjEntry.async("text")).trim() : "";
    let out: any;
    try {
      out = normalizeFc(await shp(buf));
    } catch (e: any) {
      throw new Error("Shapefile inválido: " + (e?.message ?? e));
    }
    if (!crsRegistry.looksProjected(out) && !crsOverride) return out; // shpjs already reprojected from the .prj
    // Coordinates still projected: .prj missing or not understood by the reader.
    let def: string | null = null;
    if (crsOverride) def = await crsRegistry.resolve(crsOverride);
    else if (prjText) {
      try {
        def = await crsRegistry.resolve(prjText);
      } catch {
        const m = prjText.match(/AUTHORITY\["EPSG","(\d+)"\]\s*\]\s*$/i);
        if (m) def = await crsRegistry.resolve(m[1]);
      }
    }
    if (!def) {
      throw new CrsUnknownError(
        prjText ? "Não consegui interpretar o .prj deste shapefile." : "O shapefile não tem arquivo .prj (projeção).",
        "Escolha a projeção dos dados.",
      );
    }
    return crsRegistry.reprojectGeoJson(out, def);
  }
  throw new Error("Formato não suportado.");
}

const ramp = [
  [0, [43, 105, 70]],
  [0.25, [139, 170, 90]],
  [0.5, [230, 214, 140]],
  [0.75, [184, 110, 60]],
  [1, [245, 240, 235]],
] as const;

function rampColor(t: number): [number, number, number] {
  for (let i = 1; i < ramp.length; i++) {
    if (t <= ramp[i][0]) {
      const [t0, c0] = ramp[i - 1];
      const [t1, c1] = ramp[i];
      const k = (t - t0) / (t1 - t0);
      return [0, 1, 2].map((j) => Math.round(c0[j] + k * (c1[j] - c0[j]))) as [number, number, number];
    }
  }
  return [245, 240, 235];
}

async function geotiffToOverlay(file: File, crsOverride?: string) {
  const GeoTIFF = await loadGeoTiff();
  const tiff = await GeoTIFF.fromArrayBuffer(await file.arrayBuffer());
  const image = await tiff.getImage();
  const geoKeys: any = image.getGeoKeys() ?? {};
  const keyCode: number | undefined =
    geoKeys.ProjectedCSTypeGeoKey && geoKeys.ProjectedCSTypeGeoKey !== 32767
      ? geoKeys.ProjectedCSTypeGeoKey
      : geoKeys.GTModelTypeGeoKey === 2 && geoKeys.GeographicTypeGeoKey && geoKeys.GeographicTypeGeoKey !== 32767
        ? geoKeys.GeographicTypeGeoKey
        : undefined;
  let def: string;
  let epsg: number | string;
  if (crsOverride) {
    def = await crsRegistry.resolve(crsOverride);
    epsg = /^\d+$/.test(crsOverride.trim()) ? Number(crsOverride) : crsOverride.slice(0, 40);
  } else if (keyCode) {
    def = await crsRegistry.resolve(keyCode);
    epsg = keyCode;
  } else {
    throw new CrsUnknownError(
      "Este GeoTIFF não informa um código EPSG (projeção definida pelo usuário).",
      "Escolha a projeção em que o raster foi gerado.",
    );
  }
  const [x0, y0, x1, y1] = image.getBoundingBox();
  const srcW = image.getWidth();
  const srcH = image.getHeight();
  const scale = Math.min(1, 1600 / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const rasters: any = await image.readRasters({ width: w, height: h, resampleMethod: "bilinear" });
  const bands = rasters.length as number;
  const nodata = image.getGDALNoData();
  const srcRgba = new Uint8ClampedArray(w * h * 4);
  let min = Infinity, max = -Infinity;
  if (bands < 3) {
    const b = rasters[0];
    for (let i = 0; i < b.length; i++) {
      const v = b[i];
      if (v === nodata || !isFinite(v) || v < -1e30) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    for (let i = 0; i < b.length; i++) {
      const v = b[i];
      if (v === nodata || !isFinite(v) || v < -1e30) continue;
      const [r, g, bb] = rampColor(max > min ? (v - min) / (max - min) : 0.5);
      srcRgba.set([r, g, bb, 255], i * 4);
    }
  } else {
    for (let i = 0; i < w * h; i++) {
      const r = rasters[0][i], g = rasters[1][i], b = rasters[2][i];
      const a = bands >= 4 ? rasters[3][i] : r === nodata && g === nodata && b === nodata ? 0 : 255;
      srcRgba.set([r, g, b, a], i * 4);
    }
  }
  // Reproject into a lat/lon grid by inverse sampling.
  const toLL = proj4(def, "EPSG:4326");
  const corners = [[x0, y0], [x0, y1], [x1, y0], [x1, y1]].map((c) => (toLL ? toLL.forward(c) : c));
  const lons = corners.map((c) => c[0]);
  const lats = corners.map((c) => c[1]);
  const W = w;
  const H = h;
  const minLon = Math.min(...lons), maxLon = Math.max(...lons), minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const out = new Uint8ClampedArray(W * H * 4);
  // Single-band rasters (MDT/DEM): keep the elevation values on the same lat/lon grid for queries.
  const isDem = bands < 3;
  const dem = isDem ? new Float32Array(W * H).fill(NaN) : null;
  const inv = proj4("EPSG:4326", def);
  for (let j = 0; j < H; j++) {
    const lat = maxLat - ((j + 0.5) / H) * (maxLat - minLat);
    for (let i = 0; i < W; i++) {
      const lon = minLon + ((i + 0.5) / W) * (maxLon - minLon);
      const [sx, sy] = inv ? inv.forward([lon, lat]) : [lon, lat];
      const px = Math.floor(((sx - x0) / (x1 - x0)) * w);
      const py = Math.floor(((y1 - sy) / (y1 - y0)) * h);
      if (px < 0 || py < 0 || px >= w || py >= h) continue;
      const si = (py * w + px) * 4;
      const di = (j * W + i) * 4;
      out[di] = srcRgba[si]; out[di + 1] = srcRgba[si + 1]; out[di + 2] = srcRgba[si + 2]; out[di + 3] = srcRgba[si + 3];
      if (dem) {
        const v = rasters[0][py * w + px];
        if (v !== nodata && isFinite(v) && v > -1e30) dem[j * W + i] = v;
      }
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  canvas.getContext("2d")!.putImageData(new ImageData(out, W, H), 0, 0);
  const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Falha ao renderizar"))), "image/png"));
  return {
    blob,
    dem: dem ? new Blob([dem.buffer as ArrayBuffer], { type: "application/octet-stream" }) : null,
    bounds: [[minLat, minLon], [maxLat, maxLon]] as [[number, number], [number, number]],
    meta: { epsg, bands, min: isFinite(min) ? min : null, max: isFinite(max) ? max : null, srcW, srcH, demW: W, demH: H },
  };
}

async function mbtilesInfo(file: File) {
  if (file.size > 400 * 1024 * 1024) throw new Error("MBTiles acima de 400 MB — recorte a área para usar no celular.");
  const SQL = await loadSqlJs();
  const db = new SQL.Database(new Uint8Array(await file.arrayBuffer()));
  const meta: Record<string, string> = {};
  try {
    const r = db.exec("SELECT name, value FROM metadata");
    r[0]?.values.forEach(([k, v]: any) => (meta[k] = String(v)));
  } catch {
    /* metadata table optional */
  }
  const zr = db.exec("SELECT MIN(zoom_level), MAX(zoom_level) FROM tiles");
  db.close();
  if (meta.format === "pbf") throw new Error("MBTiles vetorial (pbf) não suportado — use MBTiles raster (png/jpg).");
  let bounds: [[number, number], [number, number]] | null = null;
  if (meta.bounds) {
    const [w, s, e, n] = meta.bounds.split(",").map(Number);
    bounds = [[s, w], [n, e]];
  }
  return { bounds, meta: { ...meta, minzoom: zr[0]?.values[0][0], maxzoom: zr[0]?.values[0][1] } };
}

/** Imports a layer file. Throws CrsUnknownError when the projection must be chosen; call again with crsOverride. */
export async function importLayer(file: File, crsOverride?: string): Promise<ImportedLayer> {
  const name = file.name.replace(/\.[^.]+$/, "");
  const lower = file.name.toLowerCase();
  const count = await localDb.layers.count();
  const base = { id: newId(), name, visible: 1 as const, opacity: 0.8, color: palette[count % palette.length], createdAt: Date.now() };
  let layer: ImportedLayer;
  if (lower.endsWith(".tif") || lower.endsWith(".tiff")) {
    const r = await geotiffToOverlay(file, crsOverride);
    layer = { ...base, kind: "geotiff", data: r.blob, dem: r.dem ?? undefined, bounds: r.bounds, meta: r.meta };
  } else if (lower.endsWith(".mbtiles")) {
    const r = await mbtilesInfo(file);
    layer = { ...base, kind: "mbtiles", data: file, bounds: r.bounds, meta: r.meta };
  } else {
    const fc = await vectorFromFile(file, crsOverride);
    layer = { ...base, kind: "vector", geojson: fc, bounds: bboxOf(fc), meta: { features: fc.features.length } };
  }
  await localDb.layers.put(layer);
  return layer;
}