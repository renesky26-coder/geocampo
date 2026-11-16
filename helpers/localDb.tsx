import Dexie, { type Table } from "dexie";

export type GeometryKind = "point" | "line" | "polygon";

export type FieldGeometry =
  | { type: "Point"; coordinates: [number, number, number?] }
  | { type: "LineString"; coordinates: [number, number][] }
  | { type: "Polygon"; coordinates: [number, number][][] };

export type SyncState = 0 | 1; // 0 = pending, 1 = synced

export interface FieldRecord {
  id: string;
  kind: GeometryKind;
  name: string;
  geometry: FieldGeometry;
  altitude: number | null;
  accuracy: number | null;
  attributes: Record<string, string | string[]>;
  dip: number | null;
  dipDirection: number | null;
  notes: string;
  stationId: string | null;
  createdAt: number;
  updatedAt: number;
  author: string;
  synced: SyncState;
  deleted?: 0 | 1;
  ownerId?: string | null;
}

export interface Station {
  id: string;
  code: string;
  name: string;
  lat: number;
  lon: number;
  altitude: number | null;
  description: string;
  createdAt: number;
  updatedAt: number;
  author: string;
  synced: SyncState;
  deleted?: 0 | 1;
  ownerId?: string | null;
}

export interface Measurement {
  id: string;
  stationId: string;
  type: string;
  value: number;
  unit: string;
  notes: string;
  measuredAt: number;
  createdAt: number;
  author: string;
  synced: SyncState;
  deleted?: 0 | 1;
  ownerId?: string | null;
}

export interface Photo {
  id: string;
  recordId: string | null;
  stationId: string | null;
  blob: Blob;
  annotated: Blob | null;
  lat: number | null;
  lon: number | null;
  altitude: number | null;
  accuracy: number | null;
  azimuth: number | null;
  caption: string;
  takenAt: number;
  author: string;
  synced: SyncState;
  remoteKey?: string | null;
  ownerId?: string | null;
}

export interface ImportedLayer {
  id: string;
  name: string;
  kind: "vector" | "geotiff" | "mbtiles" | "xyz" | "wms";
  geojson?: any;
  data?: Blob;
  dem?: Blob; // Float32 elevation grid (meta.demW × meta.demH) over `bounds`, for single-band GeoTIFFs
  bounds?: [[number, number], [number, number]] | null;
  meta?: Record<string, any>;
  visible: 0 | 1;
  opacity: number;
  color: string;
  createdAt: number;
}

export interface CachedTile {
  key: string;
  blob: Blob;
  savedAt: number;
}

export interface KeyValue {
  key: string;
  value: any;
}

/** A user-defined ficha (form). Its single group uses `key` as the attribute prefix. */
export interface CustomForm {
  id: string;
  key: string; // e.g. "c_monitoramento_nascentes"
  title: string;
  short: string;
  description: string;
  fields: any[]; // DictField[]
  createdAt: number;
  updatedAt: number;
  author: string;
  synced: SyncState;
  deleted?: 0 | 1;
  ownerId?: string | null;
}

class GeoCadernetaDb extends Dexie {
  records!: Table<FieldRecord, string>;
  stations!: Table<Station, string>;
  measurements!: Table<Measurement, string>;
  photos!: Table<Photo, string>;
  layers!: Table<ImportedLayer, string>;
  tiles!: Table<CachedTile, string>;
  kv!: Table<KeyValue, string>;
  forms!: Table<CustomForm, string>;

  constructor() {
    super("geocaderneta");
    this.version(1).stores({
      records: "id, kind, stationId, createdAt, synced",
      stations: "id, code, createdAt, synced",
      measurements: "id, stationId, measuredAt, synced",
      photos: "id, recordId, stationId, takenAt, synced",
      layers: "id, kind, createdAt",
      tiles: "key, savedAt",
      kv: "key",
    });
    this.version(2).stores({
      forms: "id, key, createdAt, synced",
    });
  }
}

export const localDb = new GeoCadernetaDb();