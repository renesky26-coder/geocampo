import proj4 from "proj4";
import turfArea from "@turf/area";
import turfLength from "@turf/length";

export type CoordFormat = "DD" | "GMS" | "UTM";

export type UtmResult = {
  zone: number;
  hemisphere: "N" | "S";
  easting: number;
  northing: number;
  datum: string;
  epsg: number;
  label: string;
};

export type LonLat = [number, number];

function utmZoneFromLon(lon: number): number {
  let z = Math.floor((lon + 180) / 6) + 1;
  if (z < 1) z = 1;
  if (z > 60) z = 60;
  return z;
}

/** SIRGAS 2000 is used for zones 17–25 (South America); WGS 84 elsewhere. */
function utmDefinition(zone: number, south: boolean) {
  const isSirgas = zone >= 17 && zone <= 25;
  const epsg = isSirgas
    ? south
      ? 31960 + zone
      : 31954 + zone
    : south
      ? 32700 + zone
      : 32600 + zone;
  const ellps = isSirgas ? "+ellps=GRS80 +towgs84=0,0,0,0,0,0,0" : "+datum=WGS84";
  const def = `+proj=utm +zone=${zone}${south ? " +south" : ""} ${ellps} +units=m +no_defs`;
  return { def, epsg, datum: isSirgas ? "SIRGAS 2000" : "WGS 84" };
}

function toUtm(lat: number, lon: number, forceZone?: number): UtmResult {
  const zone = forceZone ?? utmZoneFromLon(lon);
  const south = lat < 0;
  const { def, epsg, datum } = utmDefinition(zone, south);
  const [e, n] = proj4("EPSG:4326", def, [lon, lat]);
  return {
    zone,
    hemisphere: south ? "S" : "N",
    easting: e,
    northing: n,
    datum,
    epsg,
    label: `${zone}${south ? "S" : "N"}`,
  };
}

function toGmsPart(value: number, pos: string, neg: string): string {
  const hemi = value >= 0 ? pos : neg;
  const abs = Math.abs(value);
  let d = Math.floor(abs);
  let mFloat = (abs - d) * 60;
  let m = Math.floor(mFloat);
  let s = (mFloat - m) * 60;
  if (s >= 59.995) {
    s = 0;
    m += 1;
  }
  if (m >= 60) {
    m = 0;
    d += 1;
  }
  return `${d}°${String(m).padStart(2, "0")}'${s.toFixed(2).padStart(5, "0")}"${hemi}`;
}

function formatCoord(lat: number, lon: number, format: CoordFormat): { primary: string; secondary: string; meta: string } {
  if (format === "DD") {
    return { primary: `${lat.toFixed(6)}°`, secondary: `${lon.toFixed(6)}°`, meta: "WGS 84 · Graus decimais" };
  }
  if (format === "GMS") {
    return { primary: toGmsPart(lat, "N", "S"), secondary: toGmsPart(lon, "E", "W"), meta: "WGS 84 · GMS" };
  }
  const u = toUtm(lat, lon);
  return {
    primary: `E ${u.easting.toFixed(2)}`,
    secondary: `N ${u.northing.toFixed(2)}`,
    meta: `${u.datum} · UTM ${u.label} · EPSG:${u.epsg}`,
  };
}

function polygonAreaM2(ring: LonLat[]): number {
  if (ring.length < 3) return 0;
  const closed = [...ring, ring[0]];
  return turfArea({ type: "Polygon", coordinates: [closed] });
}

function lineLengthM(coords: LonLat[]): number {
  if (coords.length < 2) return 0;
  return turfLength({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }, { units: "meters" });
}

function formatArea(m2: number): string {
  if (m2 >= 10000) return `${(m2 / 10000).toFixed(4)} ha · ${m2.toFixed(0)} m²`;
  return `${m2.toFixed(1)} m²`;
}

function formatLength(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(3)} km`;
  return `${m.toFixed(1)} m`;
}

function distanceM(a: LonLat, b: LonLat): number {
  return lineLengthM([a, b]);
}

export const geo = {
  utmZoneFromLon,
  utmDefinition,
  toUtm,
  formatCoord,
  toGmsPart,
  polygonAreaM2,
  lineLengthM,
  formatArea,
  formatLength,
  distanceM,
};