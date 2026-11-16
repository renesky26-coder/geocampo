import superjson from "superjson";
import { upload } from "@floot/storage";
import { getViewer, ViewerRequiredError } from "@floot/viewer";
import { db } from "../helpers/db";
import { schema, type OutputType } from "./photo-upload_POST.schema";
import { groupAuth, GroupCodeError } from "../helpers/groupAuth";

export async function handle(request: Request) {
  try {
    // Public app (shared by link): no Floot sign-in, so rows are marked "publico".
    const viewer = getViewer() ?? { userId: "publico", email: "" };
    const { ownerId } = await groupAuth(request);
    const p = schema.parse(superjson.parse(await request.text()));
    if (!/^[A-Za-z0-9-]+$/.test(p.id)) throw new Error("Identificador de foto inválido");
    const prev = await db.selectFrom("photos").select(["ownerId", "author"]).where("id", "=", p.id).executeTakeFirst();
    if (prev && prev.ownerId && prev.ownerId !== ownerId) throw new Error("Esta foto pertence a outro coletor e não pode ser substituída.");
    const key = `photos/${p.id}.jpg`;
    const annotatedKey = p.annotatedSize ? `photos/${p.id}-croqui.jpg` : null;

    const orig = await upload({ visibility: "private", filename: key, contentType: "image/jpeg", sizeBytes: p.originalSize });
    if (!orig.ok) throw new Error(orig.error.message);
    let ann: OutputType["annotated"] = null;
    if (annotatedKey && p.annotatedSize) {
      const a = await upload({ visibility: "private", filename: annotatedKey, contentType: "image/jpeg", sizeBytes: p.annotatedSize });
      if (!a.ok) throw new Error(a.error.message);
      ann = { presignedUrl: a.presignedUrl, headers: a.headers };
    }

    await db
      .insertInto("photos")
      .values({
        id: p.id,
        recordId: p.recordId,
        stationId: p.stationId,
        storageKey: key,
        annotatedStorageKey: annotatedKey,
        lat: p.lat,
        lon: p.lon,
        altitude: p.altitude,
        accuracy: p.accuracy,
        azimuth: p.azimuth,
        caption: p.caption,
        author: p.author,
        ownerUserId: viewer.userId,
        ownerId: prev?.ownerId ?? ownerId,
        takenAt: new Date(p.takenAt),
      })
      .onConflict((oc) =>
        oc.column("id").doUpdateSet({
          caption: (eb) => eb.ref("excluded.caption"),
          annotatedStorageKey: (eb) => eb.ref("excluded.annotatedStorageKey"),
        }),
      )
      .execute();

    const out: OutputType = { original: { presignedUrl: orig.presignedUrl, headers: orig.headers }, annotated: ann };
    return new Response(superjson.stringify(out));
  } catch (error) {
    if (error instanceof ViewerRequiredError) throw error;
    if (error instanceof GroupCodeError) return new Response(superjson.stringify({ error: error.message }), { status: 401 });
    const message = error instanceof Error ? error.message : String(error);
    return new Response(superjson.stringify({ error: message }), { status: 400 });
  }
}