import superjson from "superjson";
import { getUrl } from "@floot/storage";
import { db } from "../helpers/db";
import { groupAuth, GroupCodeError } from "../helpers/groupAuth";
import { schema, type OutputType } from "./photos-list_POST.schema";

/** Lists the group's photos this device doesn't have yet, with short-lived download links. */
export async function handle(request: Request) {
  try {
    await groupAuth(request);
    const input = schema.parse(superjson.parse(await request.text()));
    const known = new Set(input.knownIds);
    const rows = await db.selectFrom("photos").selectAll().orderBy("takenAt", "asc").execute();
    const missing = rows.filter((r) => !known.has(r.id));
    const batch = missing.slice(0, input.limit);
    const photos: OutputType["photos"] = [];
    for (const r of batch) {
      const u = await getUrl({ visibility: "private", filename: r.storageKey, expiresInSeconds: 1800 });
      if (!u.ok) continue;
      let annotatedUrl: string | null = null;
      if (r.annotatedStorageKey) {
        const a = await getUrl({ visibility: "private", filename: r.annotatedStorageKey, expiresInSeconds: 1800 });
        if (a.ok) annotatedUrl = a.url;
      }
      photos.push({
        id: r.id,
        recordId: r.recordId,
        stationId: r.stationId,
        lat: r.lat,
        lon: r.lon,
        altitude: r.altitude,
        accuracy: r.accuracy,
        azimuth: r.azimuth,
        caption: r.caption,
        author: r.author,
        takenAt: r.takenAt.getTime(),
        url: u.url,
        annotatedUrl,
        ownerId: r.ownerId,
      });
    }
    const out: OutputType = { photos, remaining: Math.max(0, missing.length - batch.length) };
    return new Response(superjson.stringify(out));
  } catch (error) {
    if (error instanceof GroupCodeError) return new Response(superjson.stringify({ error: error.message }), { status: 401 });
    const message = error instanceof Error ? error.message : String(error);
    return new Response(superjson.stringify({ error: message }), { status: 400 });
  }
}