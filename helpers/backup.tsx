import JSZip from "jszip";
import { localDb } from "./localDb";

/** Asks the browser to never evict this app's local database (best effort). */
async function requestPersistence(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

async function storageInfo() {
  try {
    const [persisted, est] = await Promise.all([navigator.storage?.persisted?.() ?? Promise.resolve(null), navigator.storage?.estimate?.() ?? Promise.resolve(null)]);
    return { persisted, usage: est?.usage ?? null, quota: est?.quota ?? null };
  } catch {
    return { persisted: null, usage: null, quota: null };
  }
}

function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

/** Full device backup: every record, station, measurement, ficha, photo and imported layer. */
async function createBackup(onProgress?: (msg: string) => void): Promise<void> {
  const zip = new JSZip();
  const [records, stations, measurements, forms, photos, layers] = await Promise.all([
    localDb.records.toArray(),
    localDb.stations.toArray(),
    localDb.measurements.toArray(),
    localDb.forms.toArray(),
    localDb.photos.toArray(),
    localDb.layers.toArray(),
  ]);
  zip.file(
    "dados.json",
    JSON.stringify(
      {
        app: "GeoCampo",
        version: 1,
        createdAt: new Date().toISOString(),
        records,
        stations,
        measurements,
        forms,
        photos: photos.map(({ blob: _b, annotated, ...p }) => ({ ...p, hasAnnotated: !!annotated })),
        // Elevation grids are rebuilt by re-importing the GeoTIFF; only the rendered image travels.
        layers: layers.map(({ data, dem: _dem, ...l }) => ({ ...l, hasData: !!data })),
      },
      null,
      1,
    ),
  );
  let i = 0;
  for (const p of photos) {
    i++;
    onProgress?.(`Fotos ${i}/${photos.length}`);
    zip.file(`fotos/${p.id}.jpg`, p.blob);
    if (p.annotated) zip.file(`fotos/${p.id}-croqui.jpg`, p.annotated);
  }
  for (const l of layers) if (l.data) zip.file(`camadas/${l.id}.bin`, l.data);
  onProgress?.("Compactando…");
  const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `geocampo_backup_${stamp()}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 20000);
  await localDb.kv.put({ key: "lastBackupAt", value: Date.now() });
}

/** Restores a backup into this device, keeping whichever copy of each item is newer. */
async function restoreBackup(file: File, onProgress?: (msg: string) => void): Promise<{ added: number; updated: number }> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const main = zip.file("dados.json");
  if (!main) throw new Error("Arquivo não é um backup do GeoCampo.");
  const data = JSON.parse(await main.async("text"));
  if (data.app !== "GeoCampo") throw new Error("Arquivo não é um backup do GeoCampo.");
  let added = 0;
  let updated = 0;
  const merge = async (table: any, rows: any[], stampKey: string) => {
    for (const r of rows ?? []) {
      const cur = await table.get(r.id);
      if (!cur) {
        await table.put(r);
        added++;
      } else if ((r[stampKey] ?? 0) > (cur[stampKey] ?? 0)) {
        await table.put(r);
        updated++;
      }
    }
  };
  onProgress?.("Registros…");
  await merge(localDb.records, data.records, "updatedAt");
  await merge(localDb.stations, data.stations, "updatedAt");
  await merge(localDb.measurements, data.measurements, "createdAt");
  await merge(localDb.forms, data.forms, "updatedAt");
  let i = 0;
  for (const p of data.photos ?? []) {
    i++;
    onProgress?.(`Fotos ${i}/${data.photos.length}`);
    if (await localDb.photos.get(p.id)) continue;
    const f = zip.file(`fotos/${p.id}.jpg`);
    if (!f) continue;
    const blob = new Blob([await f.async("arraybuffer")], { type: "image/jpeg" });
    const af = p.hasAnnotated ? zip.file(`fotos/${p.id}-croqui.jpg`) : null;
    const annotated = af ? new Blob([await af.async("arraybuffer")], { type: "image/jpeg" }) : null;
    const { hasAnnotated: _h, ...rest } = p;
    await localDb.photos.put({ ...rest, blob, annotated });
    added++;
  }
  for (const l of data.layers ?? []) {
    if (await localDb.layers.get(l.id)) continue;
    const f = l.hasData ? zip.file(`camadas/${l.id}.bin`) : null;
    const { hasData: _h, ...rest } = l;
    const type = l.kind === "geotiff" ? "image/png" : "application/octet-stream";
    await localDb.layers.put({ ...rest, ...(f ? { data: new Blob([await f.async("arraybuffer")], { type }) } : {}) });
    added++;
  }
  return { added, updated };
}

export const backup = { requestPersistence, storageInfo, createBackup, restoreBackup };
