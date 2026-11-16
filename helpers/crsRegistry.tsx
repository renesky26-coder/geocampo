import proj4 from "proj4";
import { localDb } from "./localDb";

// Datum shifts to WGS 84 used in Brazil (IBGE parameters).
const SAD69 = "+ellps=aust_SA +towgs84=-67.35,3.88,-38.22,0,0,0,0";
const CORREGO = "+ellps=intl +towgs84=-206.05,168.28,-3.82,0,0,0,0";
const SIRGAS = "+ellps=GRS80 +towgs84=0,0,0,0,0,0,0";
const WGS = "+datum=WGS84";

const utm = (zone: number, south: boolean, datum: string) =>
  `+proj=utm +zone=${zone}${south ? " +south" : ""} ${datum} +units=m +no_defs`;

const builtin: Record<number, string> = {
  4326: "+proj=longlat +datum=WGS84 +no_defs",
  4674: `+proj=longlat ${SIRGAS} +no_defs`,
  4618: `+proj=longlat ${SAD69} +no_defs`,
  4291: `+proj=longlat ${SAD69} +no_defs`,
  4225: `+proj=longlat ${CORREGO} +no_defs`,
  4989: `+proj=longlat ${SIRGAS} +no_defs`,
  3857: "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs",
  900913: "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs",
  102100: "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs",
  // SIRGAS 2000 / Brazil Polyconic
  5880: `+proj=poly +lat_0=0 +lon_0=-54 +x_0=5000000 +y_0=10000000 ${SIRGAS} +units=m +no_defs`,
  // SAD69 / Brazil Polyconic
  29101: `+proj=poly +lat_0=0 +lon_0=-54 +x_0=5000000 +y_0=10000000 ${SAD69} +units=m +no_defs`,
  // SIRGAS 2000 / Brazil Mercator
  5641: `+proj=merc +lon_0=-43 +lat_ts=-2 +x_0=5000000 +y_0=10000000 ${SIRGAS} +units=m +no_defs`,
  // South America Albers Equal Area (ESRI 102033) and SIRGAS 2000 / Brazil Albers (IBGE)
  102033: `+proj=aea +lat_0=-32 +lon_0=-60 +lat_1=-5 +lat_2=-42 +x_0=0 +y_0=0 ${SIRGAS} +units=m +no_defs`,
  10857: `+proj=aea +lat_0=-12 +lon_0=-54 +lat_1=-2 +lat_2=-22 +x_0=5000000 +y_0=10000000 ${SIRGAS} +units=m +no_defs`,
};
for (let z = 1; z <= 60; z++) {
  builtin[32600 + z] = utm(z, false, WGS);
  builtin[32700 + z] = utm(z, true, WGS);
}
for (let z = 11; z <= 22; z++) builtin[31954 + z] = utm(z, false, SIRGAS); // 31965–31976
for (let z = 17; z <= 25; z++) builtin[31960 + z] = utm(z, true, SIRGAS); // 31977–31985
for (let z = 18; z <= 22; z++) builtin[29150 + z] = utm(z, false, SAD69); // 29168–29172
for (let z = 17; z <= 25; z++) {
  builtin[29160 + z] = utm(z, true, SAD69); // 29177–29185
  builtin[29170 + z] = utm(z, true, SAD69); // 29187–29195
}
for (let z = 21; z <= 25; z++) builtin[22500 + z] = utm(z, true, CORREGO); // 22521–22525

/** Common choices offered in the "which projection is this?" dialog. */
export const crsChoices = [
  { code: 31982, label: "SIRGAS 2000 / UTM 22S" },
  { code: 31981, label: "SIRGAS 2000 / UTM 21S" },
  { code: 31983, label: "SIRGAS 2000 / UTM 23S" },
  { code: 4674, label: "SIRGAS 2000 geográfica" },
  { code: 29192, label: "SAD69 / UTM 22S" },
  { code: 29191, label: "SAD69 / UTM 21S" },
  { code: 22522, label: "Córrego Alegre / UTM 22S" },
  { code: 32722, label: "WGS 84 / UTM 22S" },
  { code: 5880, label: "SIRGAS 2000 / Policônica" },
  { code: 4326, label: "WGS 84 geográfica" },
];

export class CrsUnknownError extends Error {
  hint: string;
  constructor(message: string, hint = "") {
    super(message);
    this.name = "CrsUnknownError";
    this.hint = hint;
  }
}

async function fetchDef(code: number): Promise<string | null> {
  const urls = [`https://epsg.io/${code}.proj4`, `https://spatialreference.org/ref/epsg/${code}/proj4.txt`];
  for (const u of urls) {
    try {
      const r = await fetch(u);
      if (!r.ok) continue;
      const t = (await r.text()).trim();
      if (t.startsWith("+proj")) return t;
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Turns "31982", "EPSG:31982", "urn:ogc:def:crs:EPSG::31982", a proj4 string or a WKT
 * into a proj4 definition. Unknown EPSG codes are looked up online (and cached for offline use).
 */
async function resolve(input: string | number): Promise<string> {
  const raw = String(input).trim();
  if (raw.startsWith("+proj") || /^(PROJCS|GEOGCS|PROJCRS|GEOGCRS|GEODCRS)\[/i.test(raw)) {
    proj4(raw, "EPSG:4326"); // throws if unparseable
    return raw;
  }
  if (/CRS84$/i.test(raw)) return builtin[4326];
  const m = raw.match(/(\d{4,6})\s*$/);
  if (!m) throw new CrsUnknownError(`Sistema de coordenadas não reconhecido: "${raw}"`);
  const code = Number(m[1]);
  if (builtin[code]) return builtin[code];
  const cached = await localDb.kv.get(`crs:${code}`);
  if (cached?.value) return cached.value as string;
  if (!navigator.onLine) throw new CrsUnknownError(`EPSG:${code} não está na lista interna e o aparelho está sem internet.`, "Conecte-se uma vez para o app buscar a definição, ou informe a string proj4.");
  const def = await fetchDef(code);
  if (!def) throw new CrsUnknownError(`Não encontrei a definição de EPSG:${code}.`, "Informe a string proj4 ou o WKT (conteúdo do arquivo .prj).");
  await localDb.kv.put({ key: `crs:${code}`, value: def });
  return def;
}

function isGeographic(def: string) {
  return /\+proj=longlat/.test(def) || /^GEOG/i.test(def.trim());
}

/** Reprojects every coordinate of a GeoJSON object in place to WGS 84 lon/lat. */
function reprojectGeoJson(obj: any, def: string) {
  const t = proj4(def, "EPSG:4326");
  const walk = (c: any): any => (typeof c[0] === "number" ? (() => { const [x, y] = t.forward([c[0], c[1]]); return c.length > 2 ? [x, y, c[2]] : [x, y]; })() : c.map(walk));
  for (const f of obj.features ?? []) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === "GeometryCollection") g.geometries.forEach((gg: any) => (gg.coordinates = walk(gg.coordinates)));
    else g.coordinates = walk(g.coordinates);
  }
  delete obj.crs;
  return obj;
}

/** True when coordinates clearly aren't lon/lat degrees (i.e. metres of a projected system). */
function looksProjected(fc: any) {
  for (const f of (fc.features ?? []).slice(0, 50)) {
    let c: any = f?.geometry?.coordinates;
    while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
    if (Array.isArray(c) && (Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90)) return true;
  }
  return false;
}

export const crsRegistry = { resolve, reprojectGeoJson, looksProjected, isGeographic };
