// @ts-ignore — piexifjs ships without type declarations
import piexif from "piexifjs";

export type PhotoGeo = {
  lat: number | null;
  lon: number | null;
  altitude: number | null;
  accuracy: number | null;
  azimuth: number | null;
  takenAt: number;
  comment?: string;
};

function rational(v: number, den = 10000): [number, number] {
  return [Math.round(v * den), den];
}

function dmsRational(deg: number): [number, number][] {
  const a = Math.abs(deg);
  const d = Math.floor(a);
  const mF = (a - d) * 60;
  const m = Math.floor(mF);
  const s = (mF - m) * 60;
  return [[d, 1], [m, 1], rational(s, 1000)];
}

function exifDate(ts: number) {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}:${p(d.getMonth() + 1)}:${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });
}

// Decode a data URL locally (fetch() of data: URLs is blocked by the published app's security policy).
function dataUrlToBlob(u: string): Blob {
  const [head, b64] = u.split(",");
  const mime = head.match(/data:([^;]+)/)?.[1] ?? "image/jpeg";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function decode(file: Blob): Promise<{ src: CanvasImageSource; width: number; height: number; done: () => void }> {
  // 1) createImageBitmap honouring EXIF orientation; 2) without options (older Safari); 3) <img>.
  for (const opts of [{ imageOrientation: "from-image" }, undefined] as any[]) {
    try {
      const bmp = opts ? await createImageBitmap(file, opts) : await createImageBitmap(file);
      return { src: bmp, width: bmp.width, height: bmp.height, done: () => bmp.close?.() };
    } catch {
      /* try next */
    }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("Formato de imagem não suportado (tente JPEG)."));
    });
  }
  return { src: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
}

/** Loads any image file, applies orientation, downsizes and returns a JPEG blob. */
async function normalizeImage(file: Blob, maxSide = 2560): Promise<{ blob: Blob; width: number; height: number }> {
  const d = await decode(file);
  const scale = Math.min(1, maxSide / Math.max(d.width, d.height));
  const w = Math.round(d.width * scale);
  const h = Math.round(d.height * scale);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d")!.drawImage(d.src, 0, 0, w, h);
  d.done();
  const blob = await canvasToJpeg(c);
  return { blob, width: w, height: h };
}

/** Writes GPS position, altitude, accuracy and camera azimuth into the JPEG's EXIF. */
async function writeExif(jpeg: Blob, g: PhotoGeo): Promise<Blob> {
  const zeroth: Record<number, any> = {
    [piexif.ImageIFD.Make]: "GeoCampo",
    [piexif.ImageIFD.Software]: "GeoCampo",
    [piexif.ImageIFD.Artist]: "GeoCampo — resp. Geógrafo Renesky Jean Mary",
    [piexif.ImageIFD.DateTime]: exifDate(g.takenAt),
  };
  const exif: Record<number, any> = {
    [piexif.ExifIFD.DateTimeOriginal]: exifDate(g.takenAt),
  };
  if (g.comment) zeroth[piexif.ImageIFD.ImageDescription] = g.comment.slice(0, 500);
  const gps: Record<number, any> = {
    [piexif.GPSIFD.GPSVersionID]: [2, 3, 0, 0],
    [piexif.GPSIFD.GPSMapDatum]: "WGS-84",
  };
  if (g.lat !== null && g.lon !== null) {
    gps[piexif.GPSIFD.GPSLatitudeRef] = g.lat < 0 ? "S" : "N";
    gps[piexif.GPSIFD.GPSLatitude] = dmsRational(g.lat);
    gps[piexif.GPSIFD.GPSLongitudeRef] = g.lon < 0 ? "W" : "E";
    gps[piexif.GPSIFD.GPSLongitude] = dmsRational(g.lon);
  }
  if (g.altitude !== null) {
    gps[piexif.GPSIFD.GPSAltitudeRef] = g.altitude < 0 ? 1 : 0;
    gps[piexif.GPSIFD.GPSAltitude] = rational(Math.abs(g.altitude), 100);
  }
  if (g.azimuth !== null) {
    gps[piexif.GPSIFD.GPSImgDirectionRef] = "T"; // true north (declination already applied)
    gps[piexif.GPSIFD.GPSImgDirection] = rational(((g.azimuth % 360) + 360) % 360, 100);
  }
  if (g.accuracy !== null) {
    gps[31] = rational(g.accuracy, 100); // GPSHPositioningError
    gps[piexif.GPSIFD.GPSDOP] = rational(g.accuracy / 5, 100);
  }
  try {
    const bytes = piexif.dump({ "0th": zeroth, Exif: exif, GPS: gps });
    const out = piexif.insert(bytes, await blobToDataUrl(jpeg));
    return dataUrlToBlob(out);
  } catch {
    // EXIF writing failed: keep the photo anyway (position is still stored with the record).
    return jpeg;
  }
}

/** JPEG blob from a canvas (with a toDataURL fallback for browsers where toBlob fails). */
async function canvasToJpeg(c: HTMLCanvasElement, quality = 0.88): Promise<Blob> {
  try {
    const b: Blob | null = await new Promise((res) => c.toBlob((x) => res(x), "image/jpeg", quality));
    if (b) return b;
  } catch {
    /* fallback below */
  }
  return dataUrlToBlob(c.toDataURL("image/jpeg", quality));
}


function fromRational(r: any): number | null {
  if (!Array.isArray(r) || r.length < 2 || !r[1]) return null;
  return r[0] / r[1];
}

/** Reads position, altitude, direction and date already stored in a JPEG (e.g. a gallery photo). */
async function readExifGeo(file: Blob): Promise<{ lat: number | null; lon: number | null; altitude: number | null; azimuth: number | null; takenAt: number | null }> {
  const empty = { lat: null, lon: null, altitude: null, azimuth: null, takenAt: null };
  try {
    const head = file.slice(0, 256 * 1024); // EXIF lives at the start of the file
    const data = await blobToDataUrl(new Blob([await head.arrayBuffer()], { type: "image/jpeg" }));
    const ex = piexif.load(data);
    const g = ex.GPS ?? {};
    const dms = (v: any) => {
      if (!Array.isArray(v) || v.length < 3) return null;
      const [d, m, s] = v.map(fromRational);
      return d === null || m === null || s === null ? null : d + m / 60 + s / 3600;
    };
    let lat = dms(g[piexif.GPSIFD.GPSLatitude]);
    let lon = dms(g[piexif.GPSIFD.GPSLongitude]);
    if (lat !== null && g[piexif.GPSIFD.GPSLatitudeRef] === "S") lat = -lat;
    if (lon !== null && g[piexif.GPSIFD.GPSLongitudeRef] === "W") lon = -lon;
    let altitude = fromRational(g[piexif.GPSIFD.GPSAltitude]);
    if (altitude !== null && g[piexif.GPSIFD.GPSAltitudeRef] === 1) altitude = -altitude;
    const azimuth = fromRational(g[piexif.GPSIFD.GPSImgDirection]);
    const dt: string | undefined = ex.Exif?.[piexif.ExifIFD.DateTimeOriginal] ?? ex["0th"]?.[piexif.ImageIFD.DateTime];
    let takenAt: number | null = null;
    if (dt) {
      const m = dt.match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
      if (m) takenAt = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
    }
    return { lat, lon, altitude, azimuth, takenAt };
  } catch {
    return empty;
  }
}

export const photoExif = { normalizeImage, writeExif, blobToDataUrl, canvasToJpeg, readExifGeo };
