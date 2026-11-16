import { localDb } from "./localDb";
import { postPhotosList } from "../endpoints/photos-list_POST.schema";
import { owner } from "./owner";

function headers(): Record<string, string> {
  const code = (localStorage.getItem("gc-group-code") ?? "").trim().toLowerCase();
  if (!code) throw new Error("Informe o código do grupo em Dados → Código do grupo.");
  return { "x-geocampo-grupo": code, "x-device-id": localStorage.getItem("gc-device-id") ?? "", "x-owner-key": owner.key() };
}

async function get(url: string): Promise<Blob> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status}`);
  return r.blob();
}

/** Downloads the group's photos (and sketches) that this device doesn't have yet. */
export async function pullGroupPhotos(onProgress?: (msg: string) => void): Promise<{ downloaded: number; failed: number }> {
  const h = headers();
  let downloaded = 0;
  let failed = 0;
  const tried = new Set<string>();
  for (let round = 0; round < 50; round++) {
    const knownIds = [...(await localDb.photos.toCollection().primaryKeys()), ...tried];
    const res = await postPhotosList({ knownIds, limit: 40 }, { headers: h });
    if (!res.photos.length) break;
    for (const p of res.photos) {
      tried.add(p.id);
      onProgress?.(`${downloaded + failed + 1} (${res.remaining + res.photos.length - (downloaded + failed) % 40} restantes)`);
      try {
        const blob = await get(p.url);
        const annotated = p.annotatedUrl ? await get(p.annotatedUrl).catch(() => null) : null;
        await localDb.photos.put({
          id: p.id,
          recordId: p.recordId,
          stationId: p.stationId,
          blob,
          annotated,
          lat: p.lat,
          lon: p.lon,
          altitude: p.altitude,
          accuracy: p.accuracy,
          azimuth: p.azimuth,
          caption: p.caption,
          takenAt: p.takenAt,
          author: p.author,
          synced: 1,
          ownerId: p.ownerId,
        });
        downloaded++;
      } catch {
        failed++;
      }
    }
    if (!res.remaining) break;
  }
  return { downloaded, failed };
}
