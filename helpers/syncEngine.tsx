import { localDb, type FieldRecord, type Measurement, type Station } from "./localDb";
import { postSync, type SyncMeasurement, type SyncRecord, type SyncStation } from "../endpoints/sync_POST.schema";
import { postPhotoUpload } from "../endpoints/photo-upload_POST.schema";
import { owner } from "./owner";

export type SyncResult = { sent: number; received: number; photos: number; photoErrors: number; rejected: number };

let running: Promise<SyncResult> | null = null;

function groupHeaders(): Record<string, string> {
  let code = "";
  let device = "";
  try {
    code = (localStorage.getItem("gc-group-code") ?? "").trim().toLowerCase();
    device = localStorage.getItem("gc-device-id") ?? "";
    if (!device) {
      device = `dev-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem("gc-device-id", device);
    }
  } catch {
    /* ignore */
  }
  if (!code) throw new Error("Informe o código do grupo em Dados → Código do grupo para sincronizar.");
  return { "x-geocampo-grupo": code, "x-device-id": device, "x-owner-key": owner.key() };
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

const toSyncStation = (s: Station): SyncStation => ({
  id: s.id,
  code: s.code,
  name: s.name,
  lat: s.lat,
  lon: s.lon,
  altitude: s.altitude,
  description: s.description,
  author: s.author,
  deleted: !!s.deleted,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

const toSyncRecord = (r: FieldRecord): SyncRecord => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  geometry: r.geometry as any,
  altitude: r.altitude,
  accuracy: r.accuracy,
  attributes: r.attributes,
  dip: r.dip,
  dipDirection: r.dipDirection,
  notes: r.notes,
  stationId: r.stationId,
  author: r.author,
  deleted: !!r.deleted,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

const toSyncMeasurement = (m: Measurement): SyncMeasurement => ({
  id: m.id,
  stationId: m.stationId,
  type: m.type,
  value: m.value,
  unit: m.unit,
  notes: m.notes,
  author: m.author,
  deleted: !!m.deleted,
  measuredAt: m.measuredAt,
  createdAt: m.createdAt,
});

async function putFile(u: { presignedUrl: string; headers: Record<string, string> }, blob: Blob) {
  const r = await fetch(u.presignedUrl, { method: "PUT", headers: u.headers, body: blob });
  if (!r.ok) throw new Error(`Upload falhou (${r.status})`);
}

async function run(): Promise<SyncResult> {
  const headers = groupHeaders();
  const since = ((await localDb.kv.get("lastSync"))?.value as number | undefined) ?? null;
  const [st, rec, mea] = await Promise.all([
    localDb.stations.where("synced").equals(0).toArray(),
    localDb.records.where("synced").equals(0).toArray(),
    localDb.measurements.where("synced").equals(0).toArray(),
  ]);
  const fo = await localDb.forms.where("synced").equals(0).toArray();
  let sent = 0;
  let rejectedTotal = 0;
  let received = 0;
  let serverTime: number | null = null;

  const batches = Math.max(1, Math.ceil(Math.max(st.length, rec.length, mea.length) / 200));
  const stB = chunk(st, 200);
  const recB = chunk(rec, 200);
  const meaB = chunk(mea, 500);
  for (let i = 0; i < Math.max(batches, meaB.length); i++) {
    const res = await postSync({
      forms:
        i === 0
          ? fo.map((f) => ({
              id: f.id,
              key: f.key,
              title: f.title,
              short: f.short,
              description: f.description,
              fields: f.fields,
              author: f.author,
              deleted: !!f.deleted,
              createdAt: f.createdAt,
              updatedAt: f.updatedAt,
            }))
          : [],
      stations: (stB[i] ?? []).map(toSyncStation),
      records: (recB[i] ?? []).map(toSyncRecord),
      measurements: (meaB[i] ?? []).map(toSyncMeasurement),
      since,
    }, { headers });
    serverTime = res.serverTime;
    sent += (stB[i]?.length ?? 0) + (recB[i]?.length ?? 0) + (meaB[i]?.length ?? 0) + (i === 0 ? fo.length : 0);

    // Changes the server refused (someone else's collection) are replaced by the server version.
    const refused = new Set(res.rejected ?? []);
    rejectedTotal += refused.size;
    await localDb.transaction("rw", [localDb.stations, localDb.records, localDb.measurements, localDb.forms], async () => {
      if (i === 0) {
        for (const f of fo) {
          const cur = await localDb.forms.get(f.id);
          if (cur && cur.updatedAt === f.updatedAt) await localDb.forms.update(f.id, { synced: 1 });
        }
      }
      for (const f of res.forms ?? []) {
        const cur = await localDb.forms.get(f.id);
        if (refused.has(f.id) || !cur || (cur.synced === 1 && f.updatedAt >= cur.updatedAt) || f.updatedAt > cur.updatedAt) {
          await localDb.forms.put({ ...f, deleted: f.deleted ? 1 : 0, synced: 1 });
          received++;
        }
      }
      // Mark what was sent as synced, unless it was edited again meanwhile.
      for (const s of stB[i] ?? []) {
        const cur = await localDb.stations.get(s.id);
        if (cur && cur.updatedAt === s.updatedAt) await localDb.stations.update(s.id, { synced: 1 });
      }
      for (const r of recB[i] ?? []) {
        const cur = await localDb.records.get(r.id);
        if (cur && cur.updatedAt === r.updatedAt) await localDb.records.update(r.id, { synced: 1 });
      }
      for (const m of meaB[i] ?? []) await localDb.measurements.update(m.id, { synced: 1 });

      // Merge what the group sent back (last write wins).
      for (const s of res.stations) {
        const cur = await localDb.stations.get(s.id);
        if (refused.has(s.id) || !cur || (cur.synced === 1 && s.updatedAt >= cur.updatedAt) || s.updatedAt > cur.updatedAt) {
          await localDb.stations.put({ ...s, deleted: s.deleted ? 1 : 0, synced: 1 });
          received++;
        }
      }
      for (const r of res.records) {
        const cur = await localDb.records.get(r.id);
        if (refused.has(r.id) || !cur || (cur.synced === 1 && r.updatedAt >= cur.updatedAt) || r.updatedAt > cur.updatedAt) {
          await localDb.records.put({ ...(r as any), deleted: r.deleted ? 1 : 0, synced: 1 });
          received++;
        }
      }
      for (const m of res.measurements) {
        const cur = await localDb.measurements.get(m.id);
        if (refused.has(m.id) || !cur || cur.synced === 1) {
          await localDb.measurements.put({ ...m, deleted: m.deleted ? 1 : 0, synced: 1 });
          if (!cur) received++;
        }
      }
    });
  }

  // Photos: one by one (large files).
  let photos = 0;
  let photoErrors = 0;
  const pendingPhotos = await localDb.photos.where("synced").equals(0).toArray();
  for (const p of pendingPhotos) {
    try {
      const u = await postPhotoUpload({
        id: p.id,
        recordId: p.recordId,
        stationId: p.stationId,
        lat: p.lat,
        lon: p.lon,
        altitude: p.altitude,
        accuracy: p.accuracy,
        azimuth: p.azimuth,
        caption: p.caption,
        author: p.author,
        takenAt: p.takenAt,
        originalSize: p.blob.size,
        annotatedSize: p.annotated ? p.annotated.size : null,
      }, { headers });
      await putFile(u.original, p.blob);
      if (u.annotated && p.annotated) await putFile(u.annotated, p.annotated);
      await localDb.photos.update(p.id, { synced: 1 });
      photos++;
    } catch {
      photoErrors++;
    }
  }

  if (serverTime) await localDb.kv.put({ key: "lastSync", value: serverTime });
  await localDb.kv.put({ key: "lastSyncAt", value: Date.now() });
  return { sent, received, photos, photoErrors, rejected: rejectedTotal };
}

/** Pushes everything pending on this device and pulls the group's changes. Safe to call repeatedly. */
export function syncEngine(): Promise<SyncResult> {
  if (!running) running = run().finally(() => (running = null));
  return running;
}
