import proj4 from "proj4";
import JSZip from "jszip";
// @ts-ignore — shp-write ships without type declarations
import shpwrite from "@mapbox/shp-write";
import { localDb, type FieldRecord, type Measurement, type Photo, type Station } from "./localDb";
import { geo } from "./geo";
import { loadSqlJs } from "./loadSqlJs";
import { fichas as builtinFichas, fichasOf, customToFicha, attrLabel, type Ficha } from "./dictionaries";

type Snapshot = { records: FieldRecord[]; stations: Station[]; measurements: Measurement[]; photos: Photo[] };

export type ExportLayers = { pontos: boolean; linhas: boolean; poligonos: boolean; estacoes: boolean; medicoes: boolean; fotos: boolean };
export type ExportCrs = "4326" | "4674" | "utm";
export type ExportOptions = {
  fichas: string[] | null; // null = every record; "__sem" = records without ficha
  layers: ExportLayers;
  crs: ExportCrs;
  fromDate: number | null;
  photoBlobs: boolean;
  campanha?: string | null; // null/undefined = all; "__sem" = without campaign
};

export const defaultExportOptions: ExportOptions = {
  fichas: null,
  layers: { pontos: true, linhas: true, poligonos: true, estacoes: true, medicoes: true, fotos: true },
  crs: "4326",
  fromDate: null,
  photoBlobs: true,
};

async function snapshot(): Promise<Snapshot> {
  const [records, stations, measurements, photos] = await Promise.all([
    localDb.records.toArray(),
    localDb.stations.toArray(),
    localDb.measurements.toArray(),
    localDb.photos.toArray(),
  ]);
  return {
    records: records.filter((r) => !r.deleted).sort((a, b) => a.createdAt - b.createdAt),
    stations: stations.filter((s) => !s.deleted),
    measurements: measurements.filter((m) => !m.deleted).sort((a, b) => a.measuredAt - b.measuredAt),
    photos,
  };
}

async function allFichas(): Promise<{ all: Ficha[]; custom: Ficha[] }> {
  const custom = (await localDb.forms.toArray()).filter((f) => !f.deleted).map(customToFicha);
  return { all: [...builtinFichas, ...custom], custom };
}

/** Attribute keys ("group.field") whose field is numeric, across built-in and custom fichas. */
function numericKeys(all: Ficha[]): Set<string> {
  const s = new Set<string>(["gnss.leituras", "gnss.tempo_s", "gnss.dispersao_m", "gnss.ondulacao_geoidal_m", "gnss.altitude_ortometrica_m", "gnss.altitude_mdt_m"]);
  for (const f of all) for (const g of f.groups) for (const fl of g.fields) if (fl.type === "number") s.add(`${g.key}.${fl.key}`);
  return s;
}

const col = (k: string) => (k === "_fichas" ? "fichas" : k === "_campanha" ? "campanha" : k.replace(/\./g, "_"));

function flatAttrs(a: Record<string, string | string[]>, numeric?: Set<string>, keep?: (k: string) => boolean) {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(a)) {
    if (keep && !keep(k)) continue;
    if (numeric?.has(k) && !Array.isArray(v)) {
      const n = Number(String(v).replace(",", "."));
      out[col(k)] = isFinite(n) ? n : v;
    } else out[col(k)] = Array.isArray(v) ? v.join("; ") : v;
  }
  return out;
}

function anchor(r: FieldRecord): [number, number] {
  const g = r.geometry;
  if (g.type === "Point") return [g.coordinates[0], g.coordinates[1]];
  if (g.type === "LineString") return g.coordinates[0];
  return g.coordinates[0][0];
}

function recordProps(r: FieldRecord, stations: Station[], numeric?: Set<string>, keep?: (k: string) => boolean) {
  const [lon, lat] = anchor(r);
  const u = geo.toUtm(lat, lon);
  const g = r.geometry;
  const area = g.type === "Polygon" ? geo.polygonAreaM2(g.coordinates[0].slice(0, -1)) : null;
  const length = g.type === "LineString" ? geo.lineLengthM(g.coordinates) : g.type === "Polygon" ? geo.lineLengthM(g.coordinates[0]) : null;
  return {
    id: r.id,
    tipo: r.kind === "point" ? "ponto" : r.kind === "line" ? "linha" : "poligono",
    nome: r.name,
    data: new Date(r.createdAt).toISOString(),
    autor: r.author,
    lat: Number(lat.toFixed(7)),
    lon: Number(lon.toFixed(7)),
    utm_zona: u.label,
    utm_e: Number(u.easting.toFixed(2)),
    utm_n: Number(u.northing.toFixed(2)),
    datum_utm: `${u.datum} EPSG:${u.epsg}`,
    altitude_m: r.altitude,
    precisao_m: r.accuracy,
    area_m2: area !== null ? Number(area.toFixed(2)) : null,
    comprimento_m: length !== null ? Number(length.toFixed(2)) : null,
    mergulho: r.dip,
    direcao_mergulho: r.dipDirection,
    estacao: stations.find((s) => s.id === r.stationId)?.code ?? null,
    observacoes: r.notes,
    ...flatAttrs(r.attributes, numeric, keep),
  };
}

function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

// ---------- Selection & coordinate system ----------

type Prepared = {
  snap: Snapshot;
  records: FieldRecord[];
  stations: Station[];
  measurements: Measurement[];
  photos: Photo[];
  numeric: Set<string>;
  keep: (k: string) => boolean;
  all: Ficha[];
  srs: { id: number; name: string; wkt: string; label: string };
  project: (c: number[]) => [number, number];
  zoneWarning: string | null;
};

const WKT_WGS84 =
  'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]]';
const WKT_SIRGAS =
  'GEOGCS["SIRGAS 2000",DATUM["Sistema_de_Referencia_Geocentrico_para_las_AmericaS_2000",SPHEROID["GRS 1980",6378137,298.257222101,AUTHORITY["EPSG","7019"]],AUTHORITY["EPSG","6674"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4674"]]';

function utmWkt(zone: number, south: boolean, epsg: number) {
  return `PROJCS["SIRGAS 2000 / UTM zone ${zone}${south ? "S" : "N"}",${WKT_SIRGAS},PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",${-183 + 6 * zone}],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",${south ? 10000000 : 0}],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AXIS["Easting",EAST],AXIS["Northing",NORTH],AUTHORITY["EPSG","${epsg}"]]`;
}

async function prepare(opts: ExportOptions): Promise<Prepared> {
  const snap = await snapshot();
  const { all, custom } = await allFichas();
  const numeric = numericKeys(all);
  const sel = opts.fichas;
  const groupsOf = (keys: string[]) => new Set(all.filter((f) => keys.includes(f.key)).flatMap((f) => f.groups.map((g) => g.key)));
  const keepGroups = sel ? groupsOf(sel) : null;
  const keep = (k: string) => !keepGroups || k === "_fichas" || k === "_campanha" || k.startsWith("gnss.") || keepGroups.has(k.split(".")[0]);
  const kinds = { point: opts.layers.pontos, line: opts.layers.linhas, polygon: opts.layers.poligonos };
  const records = snap.records.filter((r) => {
    if (!kinds[r.kind]) return false;
    if (opts.fromDate && r.createdAt < opts.fromDate) return false;
    if (opts.campanha) {
      const c = r.attributes._campanha;
      if (opts.campanha === "__sem" ? !!c : c !== opts.campanha) return false;
    }
    if (!sel) return true;
    const own = fichasOf(r.attributes, custom);
    return own.length ? own.some((k) => sel.includes(k)) : sel.includes("__sem");
  });
  const stations = opts.layers.estacoes || opts.layers.medicoes ? snap.stations : [];
  const measurements = opts.layers.medicoes ? snap.measurements.filter((m) => !opts.fromDate || m.measuredAt >= opts.fromDate) : [];
  const recIds = new Set(records.map((r) => r.id));
  const stIds = new Set(opts.layers.estacoes ? stations.map((s) => s.id) : []);
  const photos = opts.layers.fotos ? snap.photos.filter((p) => (p.recordId ? recIds.has(p.recordId) : p.stationId ? stIds.has(p.stationId) : !opts.fromDate || p.takenAt >= opts.fromDate)) : [];

  let srs = { id: 4326, name: "WGS 84", wkt: WKT_WGS84, label: "WGS 84 geográfico (EPSG:4326)" };
  let project = (c: number[]): [number, number] => [c[0], c[1]];
  let zoneWarning: string | null = null;
  if (opts.crs === "4674") {
    srs = { id: 4674, name: "SIRGAS 2000", wkt: WKT_SIRGAS, label: "SIRGAS 2000 geográfico (EPSG:4674)" };
  } else if (opts.crs === "utm") {
    const pts = [...records.map(anchor), ...stations.map((s) => [s.lon, s.lat] as [number, number])];
    const lon = pts.length ? pts.reduce((s, p) => s + p[0], 0) / pts.length : -51;
    const lat = pts.length ? pts.reduce((s, p) => s + p[1], 0) / pts.length : -25;
    const zone = geo.utmZoneFromLon(lon);
    const south = lat < 0;
    const def = geo.utmDefinition(zone, south);
    const t = proj4("EPSG:4326", def.def);
    project = (c) => t.forward([c[0], c[1]]) as [number, number];
    srs = { id: def.epsg, name: `${def.datum} / UTM ${zone}${south ? "S" : "N"}`, wkt: utmWkt(zone, south, def.epsg), label: `${def.datum} UTM ${zone}${south ? "S" : "N"} (EPSG:${def.epsg})` };
    const zones = new Set(pts.map((p) => geo.utmZoneFromLon(p[0])));
    if (zones.size > 1) zoneWarning = `Os dados cruzam ${zones.size} fusos UTM; tudo foi projetado no fuso ${zone}${south ? "S" : "N"}.`;
  }
  return { snap, records, stations: opts.layers.estacoes ? stations : [], measurements, photos, numeric, keep, all, srs, project, zoneWarning };
}

function projectGeom(g: { type: string; coordinates: any }, project: (c: number[]) => [number, number]) {
  if (g.type === "Point") return { type: "Point", coordinates: project(g.coordinates) };
  if (g.type === "LineString") return { type: "LineString", coordinates: g.coordinates.map(project) };
  return { type: "Polygon", coordinates: g.coordinates.map((ring: number[][]) => ring.map(project)) };
}

// ---------- Data dictionary ----------

const BASE_DICT: [string, string, string, string][] = [
  ["id / uuid", "Identificador único do registro", "texto", ""],
  ["tipo", "Geometria do registro (ponto, linha, poligono)", "texto", ""],
  ["nome", "Identificação dada em campo", "texto", ""],
  ["data", "Data e hora da coleta (ISO 8601, UTC)", "texto", ""],
  ["autor", "Coletor(a)", "texto", ""],
  ["lat / lon", "Coordenadas WGS 84 do ponto (ou 1º vértice)", "número", "graus"],
  ["utm_zona / utm_e / utm_n", "UTM SIRGAS 2000 no fuso do próprio registro", "número", "m"],
  ["altitude_m", "Altitude informada pelo GPS do aparelho (elipsoidal no Android)", "número", "m"],
  ["precisao_m", "Precisão horizontal estimada (com média GNSS quando usada)", "número", "m"],
  ["area_m2 / comprimento_m", "Área do polígono / comprimento ou perímetro", "número", "m² / m"],
  ["mergulho / direcao_mergulho", "Atitude medida no clinômetro; direção em norte verdadeiro (declinação WMM-2025)", "número", "graus"],
  ["estacao", "Código da estação de monitoramento associada", "texto", ""],
  ["fichas", "Fichas temáticas usadas no registro", "texto", ""],
];

function dictionaryRows(p: Prepared, usedCols: string[]) {
  const rows = BASE_DICT.map(([c, d, t, u]) => ({ coluna: c, descricao: d, tipo: t, unidade: u, opcoes: "" }));
  for (const c of usedCols) {
    if (["fichas"].includes(c)) continue;
    // find the attribute key behind this column
    let found = false;
    for (const f of p.all) {
      for (const g of f.groups) {
        for (const fl of g.fields) {
          const base = `${g.key}_${fl.key}`;
          if (c !== base && c !== `${base}_outro`) continue;
          found = true;
          const isOther = c.endsWith("_outro");
          rows.push({
            coluna: c,
            descricao: `${f.title} — ${attrLabel(`${g.key}.${fl.key}${isOther ? ".outro" : ""}`, p.all.filter((x) => !builtinFichas.includes(x)))}`,
            tipo: isOther ? "texto" : fl.type === "number" ? "número" : fl.type === "text" ? "texto" : (fl as any).multi ? "lista (várias, separadas por ;)" : "lista",
            unidade: fl.type === "number" ? fl.unit : "",
            opcoes: !isOther && fl.type !== "number" && fl.type !== "text" ? fl.options.map((o) => o.label).join(" | ") : fl.type === "number" && (fl.min !== undefined || fl.max !== undefined) ? `faixa ${fl.min ?? "—"} a ${fl.max ?? "—"}` : "",
          });
          break;
        }
        if (found) break;
      }
      if (found) break;
    }
    if (!found && c.startsWith("gnss_")) rows.push({ coluna: c, descricao: attrLabel(c.replace("gnss_", "gnss.")), tipo: "número", unidade: "", opcoes: "" });
  }
  return rows;
}

function toCsv(rows: Record<string, unknown>[]) {
  const cols = Array.from(rows.reduce((set, r) => (Object.keys(r).forEach((k) => set.add(k)), set), new Set<string>()));
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "number" ? String(v).replace(".", ",") : String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // Semicolon + BOM + decimal comma opens correctly in Excel pt-BR.
  return "\uFEFF" + [cols.join(";"), ...rows.map((r) => cols.map((c) => esc(r[c])).join(";"))].join("\r\n");
}

function usedAttrCols(p: Prepared) {
  return Array.from(new Set(p.records.flatMap((r) => Object.keys(flatAttrs(r.attributes, p.numeric, p.keep))))).sort();
}

// ---------- GeoJSON / CSV ----------

async function exportGeoJson(opts: ExportOptions = defaultExportOptions) {
  const p = await prepare(opts);
  const fc: any = {
    type: "FeatureCollection",
    name: "geocampo",
    features: [
      ...p.records.map((r) => ({ type: "Feature", geometry: projectGeom(r.geometry, p.project), properties: recordProps(r, p.snap.stations, p.numeric, p.keep) })),
      ...p.stations.map((st) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: p.project([st.lon, st.lat]) },
        properties: { id: st.id, tipo: "estacao", codigo: st.code, nome: st.name, descricao: st.description, altitude_m: st.altitude, autor: st.author },
      })),
    ],
  };
  if (p.srs.id !== 4326) fc.crs = { type: "name", properties: { name: `urn:ogc:def:crs:EPSG::${p.srs.id}` } };
  download(new Blob([JSON.stringify(fc, null, 1)], { type: "application/geo+json" }), `geocampo_${stamp()}.geojson`);
  download(new Blob([toCsv(dictionaryRows(p, usedAttrCols(p)))], { type: "text/csv" }), `geocampo_dicionario_${stamp()}.csv`);
  return { count: p.records.length + p.stations.length, warning: p.zoneWarning };
}

async function exportCsv(opts: ExportOptions = defaultExportOptions) {
  const p = await prepare(opts);
  const rows = p.records.map((r) => {
    const props: any = recordProps(r, p.snap.stations, p.numeric, p.keep);
    if (p.srs.id !== 4326 && p.srs.id !== 4674) {
      const [x, y] = p.project(anchor(r));
      props[`x_epsg${p.srs.id}`] = Number(x.toFixed(2));
      props[`y_epsg${p.srs.id}`] = Number(y.toFixed(2));
    }
    return props;
  });
  download(new Blob([toCsv(rows)], { type: "text/csv" }), `registros_${stamp()}.csv`);
  if (p.measurements.length) {
    const mrows = p.measurements.map((m) => {
      const st = p.snap.stations.find((x) => x.id === m.stationId);
      return { estacao: st?.code ?? m.stationId, estacao_nome: st?.name ?? "", data: new Date(m.measuredAt).toISOString(), tipo: m.type, valor: m.value, unidade: m.unit, observacao: m.notes, autor: m.author };
    });
    setTimeout(() => download(new Blob([toCsv(mrows)], { type: "text/csv" }), `medicoes_estacoes_${stamp()}.csv`), 500);
  }
  setTimeout(() => download(new Blob([toCsv(dictionaryRows(p, usedAttrCols(p)))], { type: "text/csv" }), `geocampo_dicionario_${stamp()}.csv`), 1000);
  return { count: rows.length, warning: p.zoneWarning };
}

// ---------- GeoPackage (OGC 1.3) ----------

function wkb(geom: { type: string; coordinates: any }): Uint8Array {
  let type = 1;
  let size = 1 + 4;
  if (geom.type === "Point") size += 16;
  else if (geom.type === "LineString") {
    type = 2;
    size += 4 + 16 * geom.coordinates.length;
  } else {
    type = 3;
    size += 4;
    for (const ring of geom.coordinates) size += 4 + 16 * ring.length;
  }
  const buf = new ArrayBuffer(size);
  const v = new DataView(buf);
  let o = 0;
  v.setUint8(o, 1);
  o += 1;
  v.setUint32(o, type, true);
  o += 4;
  const pt = (c: number[]) => {
    v.setFloat64(o, c[0], true);
    v.setFloat64(o + 8, c[1], true);
    o += 16;
  };
  if (type === 1) pt(geom.coordinates);
  else if (type === 2) {
    v.setUint32(o, geom.coordinates.length, true);
    o += 4;
    geom.coordinates.forEach(pt);
  } else {
    v.setUint32(o, geom.coordinates.length, true);
    o += 4;
    for (const ring of geom.coordinates) {
      v.setUint32(o, ring.length, true);
      o += 4;
      ring.forEach(pt);
    }
  }
  return new Uint8Array(buf);
}

function envelope(geom: { type: string; coordinates: any }) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const walk = (c: any) => {
    if (typeof c[0] === "number") {
      minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0]);
      minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1]);
    } else c.forEach(walk);
  };
  walk(geom.coordinates);
  return [minX, maxX, minY, maxY];
}

function gpkgGeom(geom: { type: string; coordinates: any }, srs: number): Uint8Array {
  const body = wkb(geom);
  const withEnv = geom.type !== "Point";
  const headerLen = 8 + (withEnv ? 32 : 0);
  const out = new Uint8Array(headerLen + body.length);
  const v = new DataView(out.buffer);
  out[0] = 0x47; // G
  out[1] = 0x50; // P
  out[2] = 0;
  out[3] = (withEnv ? 1 << 1 : 0) | 1;
  v.setInt32(4, srs, true);
  if (withEnv) envelope(geom).forEach((n, i) => v.setFloat64(8 + i * 8, n, true));
  out.set(body, headerLen);
  return out;
}

async function blobBytes(b: Blob) {
  return new Uint8Array(await b.arrayBuffer());
}

async function exportGpkg(opts: ExportOptions = defaultExportOptions) {
  const SQL = await loadSqlJs();
  const p = await prepare(opts);
  const SRS = p.srs.id;
  const db = new SQL.Database();
  const now = new Date().toISOString();
  db.run(`PRAGMA application_id = 1196444487; PRAGMA user_version = 10301;`);
  db.run(`
    CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT NOT NULL, srs_id INTEGER PRIMARY KEY, organization TEXT NOT NULL, organization_coordsys_id INTEGER NOT NULL, definition TEXT NOT NULL, description TEXT);
    CREATE TABLE gpkg_contents (table_name TEXT NOT NULL PRIMARY KEY, data_type TEXT NOT NULL, identifier TEXT UNIQUE, description TEXT DEFAULT '', last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE, srs_id INTEGER, CONSTRAINT fk_gc_r_srs_id FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id));
    CREATE TABLE gpkg_geometry_columns (table_name TEXT NOT NULL, column_name TEXT NOT NULL, geometry_type_name TEXT NOT NULL, srs_id INTEGER NOT NULL, z TINYINT NOT NULL, m TINYINT NOT NULL, CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name));
  `);
  db.run(
    `INSERT INTO gpkg_spatial_ref_sys VALUES ('Undefined cartesian SRS', -1, 'NONE', -1, 'undefined', 'undefined cartesian coordinate reference system'), ('Undefined geographic SRS', 0, 'NONE', 0, 'undefined', 'undefined geographic coordinate reference system'), ('WGS 84 geodetic', 4326, 'EPSG', 4326, ?, 'WGS 84')`,
    [WKT_WGS84],
  );
  if (SRS !== 4326) db.run(`INSERT INTO gpkg_spatial_ref_sys VALUES (?, ?, 'EPSG', ?, ?, ?)`, [p.srs.name, SRS, SRS, p.srs.wkt, p.srs.label]);

  const attrCols = usedAttrCols(p);
  const numericCols = new Set(Array.from(p.numeric).map(col));
  const baseCols = [
    "uuid TEXT", "nome TEXT", "data TEXT", "autor TEXT", "lat REAL", "lon REAL", "utm_zona TEXT", "utm_e REAL", "utm_n REAL", "altitude_m REAL", "precisao_m REAL",
    "area_m2 REAL", "comprimento_m REAL", "mergulho REAL", "direcao_mergulho REAL", "estacao TEXT", "observacoes TEXT",
    ...attrCols.map((k) => `"${k}" ${numericCols.has(k) ? "REAL" : "TEXT"}`),
  ];
  const contents = (table: string, desc: string, ext: number[] | null, type = "features") =>
    db.run(`INSERT INTO gpkg_contents (table_name, data_type, identifier, description, last_change, min_x, min_y, max_x, max_y, srs_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      table, type, table, desc, now, ext?.[0] ?? null, ext?.[1] ?? null, ext?.[2] ?? null, ext?.[3] ?? null, type === "features" ? SRS : null,
    ]);
  const layerDefs: { table: string; kind: FieldRecord["kind"]; gtype: string; label: string; on: boolean }[] = [
    { table: "pontos", kind: "point", gtype: "POINT", label: "Pontos de campo", on: opts.layers.pontos },
    { table: "linhas", kind: "line", gtype: "LINESTRING", label: "Linhas / rastros", on: opts.layers.linhas },
    { table: "poligonos", kind: "polygon", gtype: "POLYGON", label: "Polígonos", on: opts.layers.poligonos },
  ];
  for (const L of layerDefs) {
    if (!L.on) continue;
    const rows = p.records.filter((r) => r.kind === L.kind);
    db.run(`CREATE TABLE ${L.table} (fid INTEGER PRIMARY KEY AUTOINCREMENT, geom ${L.gtype}, ${baseCols.join(", ")})`);
    let ext = [Infinity, Infinity, -Infinity, -Infinity];
    const cols = ["geom", "uuid", "nome", "data", "autor", "lat", "lon", "utm_zona", "utm_e", "utm_n", "altitude_m", "precisao_m", "area_m2", "comprimento_m", "mergulho", "direcao_mergulho", "estacao", "observacoes", ...attrCols.map((k) => `"${k}"`)];
    const stmt = db.prepare(`INSERT INTO ${L.table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`);
    for (const r of rows) {
      const pr: any = recordProps(r, p.snap.stations, p.numeric, p.keep);
      const g = projectGeom(r.geometry, p.project);
      const e = envelope(g);
      ext = [Math.min(ext[0], e[0]), Math.min(ext[1], e[2]), Math.max(ext[2], e[1]), Math.max(ext[3], e[3])];
      stmt.run([
        gpkgGeom(g, SRS), r.id, pr.nome, pr.data, pr.autor, pr.lat, pr.lon, pr.utm_zona, pr.utm_e, pr.utm_n, pr.altitude_m, pr.precisao_m, pr.area_m2, pr.comprimento_m,
        pr.mergulho, pr.direcao_mergulho, pr.estacao, pr.observacoes, ...attrCols.map((k) => pr[k] ?? null),
      ]);
    }
    stmt.free();
    contents(L.table, L.label, isFinite(ext[0]) ? ext : null);
    db.run(`INSERT INTO gpkg_geometry_columns VALUES (?, 'geom', ?, ?, 0, 0)`, [L.table, L.gtype, SRS]);
  }

  if (opts.layers.estacoes) {
    db.run(`CREATE TABLE estacoes (fid INTEGER PRIMARY KEY AUTOINCREMENT, geom POINT, uuid TEXT, codigo TEXT, nome TEXT, descricao TEXT, altitude_m REAL, utm_zona TEXT, utm_e REAL, utm_n REAL, autor TEXT, criado_em TEXT)`);
    const stS = db.prepare(`INSERT INTO estacoes (geom, uuid, codigo, nome, descricao, altitude_m, utm_zona, utm_e, utm_n, autor, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    for (const st of p.stations) {
      const u = geo.toUtm(st.lat, st.lon);
      stS.run([gpkgGeom({ type: "Point", coordinates: p.project([st.lon, st.lat]) }, SRS), st.id, st.code, st.name, st.description, st.altitude, u.label, u.easting, u.northing, st.author, new Date(st.createdAt).toISOString()]);
    }
    stS.free();
    contents("estacoes", "Estações de monitoramento (pinos)", null);
    db.run(`INSERT INTO gpkg_geometry_columns VALUES ('estacoes', 'geom', 'POINT', ?, 0, 0)`, [SRS]);
  }

  if (opts.layers.medicoes) {
    db.run(`CREATE TABLE medicoes (id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT, estacao_uuid TEXT, estacao_codigo TEXT, data TEXT, tipo TEXT, valor REAL, unidade TEXT, observacao TEXT, autor TEXT)`);
    const mS = db.prepare(`INSERT INTO medicoes (uuid, estacao_uuid, estacao_codigo, data, tipo, valor, unidade, observacao, autor) VALUES (?,?,?,?,?,?,?,?,?)`);
    for (const m of p.measurements) mS.run([m.id, m.stationId, p.snap.stations.find((x) => x.id === m.stationId)?.code ?? null, new Date(m.measuredAt).toISOString(), m.type, m.value, m.unit, m.notes, m.author]);
    mS.free();
    contents("medicoes", "Histórico de medidas das estações", null, "attributes");
  }

  if (opts.layers.fotos) {
    db.run(`CREATE TABLE fotos (fid INTEGER PRIMARY KEY AUTOINCREMENT, geom POINT, uuid TEXT, registro_uuid TEXT, estacao_uuid TEXT, legenda TEXT, azimute_verdadeiro REAL, altitude_m REAL, precisao_m REAL, data TEXT, autor TEXT, foto BLOB, croqui BLOB)`);
    const pS = db.prepare(`INSERT INTO fotos (geom, uuid, registro_uuid, estacao_uuid, legenda, azimute_verdadeiro, altitude_m, precisao_m, data, autor, foto, croqui) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const ph of p.photos) {
      pS.run([
        ph.lat !== null && ph.lon !== null ? gpkgGeom({ type: "Point", coordinates: p.project([ph.lon, ph.lat]) }, SRS) : null,
        ph.id, ph.recordId, ph.stationId, ph.caption, ph.azimuth, ph.altitude, ph.accuracy, new Date(ph.takenAt).toISOString(), ph.author,
        opts.photoBlobs ? await blobBytes(ph.blob) : null,
        opts.photoBlobs && ph.annotated ? await blobBytes(ph.annotated) : null,
      ]);
    }
    pS.free();
    contents("fotos", "Fotos georreferenciadas e croquis (JPEG em BLOB)", null);
    db.run(`INSERT INTO gpkg_geometry_columns VALUES ('fotos', 'geom', 'POINT', ?, 0, 0)`, [SRS]);
  }

  // Data dictionary travels inside the GeoPackage.
  db.run(`CREATE TABLE dicionario_dados (id INTEGER PRIMARY KEY AUTOINCREMENT, coluna TEXT, descricao TEXT, tipo TEXT, unidade TEXT, opcoes TEXT)`);
  const dS = db.prepare(`INSERT INTO dicionario_dados (coluna, descricao, tipo, unidade, opcoes) VALUES (?,?,?,?,?)`);
  for (const r of dictionaryRows(p, attrCols)) dS.run([r.coluna, r.descricao, r.tipo, r.unidade, r.opcoes]);
  dS.run(["(sistema)", `Sistema de coordenadas das geometrias: ${p.srs.label}. Exportado em ${now} pelo GeoCampo (resp. Geógrafo Renesky Jean Mary).`, "", "", ""]);
  dS.free();
  contents("dicionario_dados", "Dicionário de dados: significado, tipo, unidade e opções de cada coluna", null, "attributes");

  const bytes: Uint8Array = db.export();
  db.close();
  download(new Blob([bytes as unknown as BlobPart], { type: "application/geopackage+sqlite3" }), `geocampo_${stamp()}.gpkg`);
  return { count: p.records.length + p.stations.length, warning: p.zoneWarning };
}

// ---------- KML (Google Earth) ----------

function xml(s: unknown) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

async function exportKml(opts: ExportOptions = defaultExportOptions) {
  const p = await prepare({ ...opts, crs: "4326" }); // KML is always WGS 84 lon/lat
  const c = (pt: readonly (number | undefined)[]) => `${pt[0]},${pt[1]},0`;
  const geom = (g: FieldRecord["geometry"]) =>
    g.type === "Point"
      ? `<Point><coordinates>${c(g.coordinates)}</coordinates></Point>`
      : g.type === "LineString"
        ? `<LineString><tessellate>1</tessellate><coordinates>${g.coordinates.map(c).join(" ")}</coordinates></LineString>`
        : `<Polygon><outerBoundaryIs><LinearRing><coordinates>${g.coordinates[0].map(c).join(" ")}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
  const data = (props: Record<string, unknown>) =>
    `<ExtendedData>${Object.entries(props)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => `<Data name="${xml(k)}"><value>${xml(v)}</value></Data>`)
      .join("")}</ExtendedData>`;
  const placemarks = [
    ...p.records.map((r) => {
      const props: any = recordProps(r, p.snap.stations, p.numeric, p.keep);
      return `<Placemark><name>${xml(r.name)}</name><styleUrl>#${r.kind}</styleUrl>${data(props)}${geom(r.geometry)}</Placemark>`;
    }),
    ...p.stations.map(
      (s) => `<Placemark><name>${xml(s.code)} ${xml(s.name)}</name><styleUrl>#estacao</styleUrl><description>${xml(s.description)}</description><Point><coordinates>${s.lon},${s.lat},0</coordinates></Point></Placemark>`,
    ),
  ];
  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>GeoCampo ${stamp()}</name>
<Style id="point"><IconStyle><color>ff1d4fb8</color><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>
<Style id="line"><LineStyle><color>ff1f56e0</color><width>3</width></LineStyle></Style>
<Style id="polygon"><LineStyle><color>ff1f56e0</color><width>2</width></LineStyle><PolyStyle><color>401f56e0</color></PolyStyle></Style>
<Style id="estacao"><IconStyle><color>ff4ac3f3</color><Icon><href>http://maps.google.com/mapfiles/kml/shapes/square.png</href></Icon></IconStyle></Style>
${placemarks.join("\n")}
</Document></kml>`;
  download(new Blob([kml], { type: "application/vnd.google-earth.kml+xml" }), `geocampo_${stamp()}.kml`);
  return { count: placemarks.length, warning: null };
}

// ---------- Shapefile (.zip) ----------

async function exportShapefile(opts: ExportOptions = defaultExportOptions) {
  const p = await prepare(opts);
  const features: any[] = p.records.map((r) => {
    const props: any = recordProps(r, p.snap.stations, p.numeric, p.keep);
    // DBF: 10-char field names; keep the most useful columns readable.
    const short: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) {
      let key = k.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 10);
      let n = 2;
      while (key in short) key = `${k.slice(0, 8)}${n++}`;
      short[key] = v;
    }
    return { type: "Feature", properties: short, geometry: projectGeom(r.geometry, p.project) };
  });
  if (p.stations.length) {
    for (const s of p.stations) features.push({ type: "Feature", properties: { tipo: "estacao", codigo: s.code, nome: s.name } as any, geometry: { type: "Point", coordinates: p.project([s.lon, s.lat]) } as any });
  }
  const out = await shpwrite.zip({ type: "FeatureCollection", features }, { folder: "geocampo", outputType: "arraybuffer", compression: "DEFLATE", types: { point: "pontos", line: "linhas", polyline: "linhas", polygon: "poligonos" } } as any);
  // Write the right .prj for the chosen coordinate system.
  const zip = await JSZip.loadAsync(out as ArrayBuffer);
  Object.keys(zip.files)
    .filter((n) => n.toLowerCase().endsWith(".prj"))
    .forEach((n) => zip.file(n, p.srs.wkt));
  zip.file("geocampo/LEIA-ME.txt", `Exportado pelo GeoCampo em ${new Date().toISOString()}\nSistema de coordenadas: ${p.srs.label}\nNomes de colunas do Shapefile são cortados em 10 caracteres; o GeoPackage mantém os nomes completos.\n`);
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  download(blob, `geocampo_shp_${stamp()}.zip`);
  return { count: features.length, warning: p.zoneWarning };
}

export const exportData = { snapshot, exportGeoJson, exportCsv, exportGpkg, exportKml, exportShapefile, recordProps, download, stamp };
