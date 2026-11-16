import superjson from "superjson";
import { sql } from "kysely";
import { getViewer, ViewerRequiredError } from "@floot/viewer";
import { db } from "../helpers/db";
import { schema, type OutputType } from "./sync_POST.schema";
import { groupAuth, GroupCodeError } from "../helpers/groupAuth";

type Existing = Map<string, { ownerId: string | null; author: string }>;

async function existing(table: "customForms" | "stations" | "fieldRecords" | "measurements", ids: string[]): Promise<Existing> {
  if (!ids.length) return new Map();
  const rows = await db.selectFrom(table).select(["id", "ownerId", "author"]).where("id", "in", ids).execute();
  return new Map(rows.map((r) => [r.id, { ownerId: r.ownerId, author: r.author }]));
}

/**
 * Ownership rule: only the collector who created an item may change or delete it.
 * Legacy items (created before ownership existed) are claimed by the first edit from a
 * collector whose name matches the item's author.
 */
function allowed(ex: Existing, id: string, ownerId: string | null, author: string): boolean {
  const cur = ex.get(id);
  if (!cur) return true; // new item
  if (cur.ownerId) return !!ownerId && cur.ownerId === ownerId;
  return !ownerId || cur.author === author || !cur.author;
}

export async function handle(request: Request) {
  try {
    // Public app (shared by link): no Floot sign-in, so rows are marked "publico".
    const viewer = getViewer() ?? { userId: "publico", email: "" };
    const { deviceId, ownerId } = await groupAuth(request);
    const input = schema.parse(superjson.parse(await request.text()));
    // Read the clock BEFORE writing so rows written concurrently are picked up next time.
    const serverTime = Date.now();
    const forms = input.forms ?? [];

    const [exF, exS, exR, exM] = await Promise.all([
      existing("customForms", forms.map((x) => x.id)),
      existing("stations", input.stations.map((x) => x.id)),
      existing("fieldRecords", input.records.map((x) => x.id)),
      existing("measurements", input.measurements.map((x) => x.id)),
    ]);
    const rejected = { forms: [] as string[], stations: [] as string[], records: [] as string[], measurements: [] as string[] };
    const okForms = forms.filter((x) => allowed(exF, x.id, ownerId, x.author) || (rejected.forms.push(x.id), false));
    const okStations = input.stations.filter((x) => allowed(exS, x.id, ownerId, x.author) || (rejected.stations.push(x.id), false));
    const okRecords = input.records.filter((x) => allowed(exR, x.id, ownerId, x.author) || (rejected.records.push(x.id), false));
    const okMeas = input.measurements.filter((x) => allowed(exM, x.id, ownerId, x.author) || (rejected.measurements.push(x.id), false));
    const owner = (ex: Existing, id: string) => ex.get(id)?.ownerId ?? ownerId;

    await db.transaction().execute(async (trx) => {
      for (const f of okForms) {
        await trx
          .insertInto("customForms")
          .values({
            id: f.id,
            key: f.key,
            definition: { title: f.title, short: f.short, description: f.description, fields: f.fields } as any,
            author: f.author,
            ownerUserId: viewer.userId,
            ownerId: owner(exF, f.id),
            deleted: f.deleted,
            createdAt: new Date(f.createdAt),
            updatedAt: new Date(f.updatedAt),
          })
          .onConflict((oc) =>
            oc
              .column("id")
              .doUpdateSet({
                definition: (eb) => eb.ref("excluded.definition"),
                deleted: (eb) => eb.ref("excluded.deleted"),
                updatedAt: (eb) => eb.ref("excluded.updatedAt"),
                ownerId: (eb) => eb.ref("excluded.ownerId"),
                serverUpdatedAt: sql`now()`,
              })
              .where("customForms.updatedAt", "<=", (eb) => eb.ref("excluded.updatedAt")),
          )
          .execute();
      }
      for (const s of okStations) {
        await trx
          .insertInto("stations")
          .values({
            id: s.id,
            code: s.code,
            name: s.name,
            lat: s.lat,
            lon: s.lon,
            altitude: s.altitude,
            description: s.description,
            author: s.author,
            ownerUserId: viewer.userId,
            ownerId: owner(exS, s.id),
            deleted: s.deleted,
            createdAt: new Date(s.createdAt),
            updatedAt: new Date(s.updatedAt),
          })
          .onConflict((oc) =>
            oc
              .column("id")
              .doUpdateSet({
                code: (eb) => eb.ref("excluded.code"),
                name: (eb) => eb.ref("excluded.name"),
                lat: (eb) => eb.ref("excluded.lat"),
                lon: (eb) => eb.ref("excluded.lon"),
                altitude: (eb) => eb.ref("excluded.altitude"),
                description: (eb) => eb.ref("excluded.description"),
                deleted: (eb) => eb.ref("excluded.deleted"),
                updatedAt: (eb) => eb.ref("excluded.updatedAt"),
                ownerId: (eb) => eb.ref("excluded.ownerId"),
                serverUpdatedAt: sql`now()`,
              })
              .where("stations.updatedAt", "<=", (eb) => eb.ref("excluded.updatedAt")),
          )
          .execute();
      }
      for (const r of okRecords) {
        await trx
          .insertInto("fieldRecords")
          .values({
            id: r.id,
            kind: r.kind,
            name: r.name,
            geometry: r.geometry as any,
            altitude: r.altitude,
            accuracy: r.accuracy,
            attributes: r.attributes as any,
            dip: r.dip,
            dipDirection: r.dipDirection,
            notes: r.notes,
            stationId: r.stationId,
            author: r.author,
            ownerUserId: viewer.userId,
            ownerId: owner(exR, r.id),
            deleted: r.deleted,
            createdAt: new Date(r.createdAt),
            updatedAt: new Date(r.updatedAt),
          })
          .onConflict((oc) =>
            oc
              .column("id")
              .doUpdateSet({
                name: (eb) => eb.ref("excluded.name"),
                geometry: (eb) => eb.ref("excluded.geometry"),
                altitude: (eb) => eb.ref("excluded.altitude"),
                accuracy: (eb) => eb.ref("excluded.accuracy"),
                attributes: (eb) => eb.ref("excluded.attributes"),
                dip: (eb) => eb.ref("excluded.dip"),
                dipDirection: (eb) => eb.ref("excluded.dipDirection"),
                notes: (eb) => eb.ref("excluded.notes"),
                stationId: (eb) => eb.ref("excluded.stationId"),
                deleted: (eb) => eb.ref("excluded.deleted"),
                updatedAt: (eb) => eb.ref("excluded.updatedAt"),
                ownerId: (eb) => eb.ref("excluded.ownerId"),
                serverUpdatedAt: sql`now()`,
              })
              .where("fieldRecords.updatedAt", "<=", (eb) => eb.ref("excluded.updatedAt")),
          )
          .execute();
      }
      for (const m of okMeas) {
        await trx
          .insertInto("measurements")
          .values({
            id: m.id,
            stationId: m.stationId,
            type: m.type,
            value: m.value,
            unit: m.unit,
            notes: m.notes,
            author: m.author,
            ownerUserId: viewer.userId,
            ownerId: owner(exM, m.id),
            deleted: m.deleted,
            measuredAt: new Date(m.measuredAt),
            createdAt: new Date(m.createdAt),
          })
          .onConflict((oc) =>
            oc.column("id").doUpdateSet({
              value: (eb) => eb.ref("excluded.value"),
              notes: (eb) => eb.ref("excluded.notes"),
              deleted: (eb) => eb.ref("excluded.deleted"),
              ownerId: (eb) => eb.ref("excluded.ownerId"),
              serverUpdatedAt: sql`now()`,
            }),
          )
          .execute();
      }
      // Audit trail: who sent which version of what, from which device (refused attempts too).
      const tag = (entity: string, x: { id: string; deleted: boolean; author: string }, refused: boolean) => ({
        entity,
        entityId: x.id,
        action: refused ? "recusada (não é o autor)" : x.deleted ? "exclusao" : "gravacao",
        author: x.author || viewer.email || "",
        deviceId: `${deviceId}${ownerId ? ` · ${ownerId.slice(0, 10)}` : ""}`.slice(0, 64),
        snapshot: x as any,
      });
      const log = [
        ...forms.map((x) => tag("ficha", x, rejected.forms.includes(x.id))),
        ...input.stations.map((x) => tag("estacao", x, rejected.stations.includes(x.id))),
        ...input.records.map((x) => tag("registro", x, rejected.records.includes(x.id))),
        ...input.measurements.map((x) => tag("medicao", x, rejected.measurements.includes(x.id))),
      ];
      if (log.length) await trx.insertInto("changeLog").values(log).execute();
    });

    const since = input.since ? new Date(input.since - 60_000) : new Date(0);
    const changedOr = (ids: string[]) => (eb: any) => (ids.length ? eb.or([eb("serverUpdatedAt", ">", since), eb("id", "in", ids)]) : eb("serverUpdatedAt", ">", since));
    const [fRows, sRows, rRows, mRows, photoCount] = await Promise.all([
      db.selectFrom("customForms").selectAll().where(changedOr(rejected.forms)).execute(),
      db.selectFrom("stations").selectAll().where(changedOr(rejected.stations)).execute(),
      db.selectFrom("fieldRecords").selectAll().where(changedOr(rejected.records)).execute(),
      db.selectFrom("measurements").selectAll().where(changedOr(rejected.measurements)).execute(),
      db.selectFrom("photos").select((eb) => eb.fn.countAll<string>().as("n")).executeTakeFirst(),
    ]);

    const out: OutputType = {
      serverTime,
      forms: fRows.map((f) => {
        const d = (f.definition ?? {}) as any;
        return {
          id: f.id,
          key: f.key,
          title: String(d.title ?? ""),
          short: String(d.short ?? ""),
          description: String(d.description ?? ""),
          fields: Array.isArray(d.fields) ? d.fields : [],
          author: f.author,
          deleted: f.deleted,
          createdAt: f.createdAt.getTime(),
          updatedAt: f.updatedAt.getTime(),
          ownerId: f.ownerId,
        };
      }),
      stations: sRows.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        lat: s.lat,
        lon: s.lon,
        altitude: s.altitude,
        description: s.description,
        author: s.author,
        deleted: s.deleted,
        createdAt: s.createdAt.getTime(),
        updatedAt: s.updatedAt.getTime(),
        ownerId: s.ownerId,
      })),
      records: rRows.map((r) => ({
        id: r.id,
        kind: r.kind,
        name: r.name,
        geometry: r.geometry as any,
        altitude: r.altitude,
        accuracy: r.accuracy,
        attributes: (r.attributes ?? {}) as any,
        dip: r.dip,
        dipDirection: r.dipDirection,
        notes: r.notes,
        stationId: r.stationId,
        author: r.author,
        deleted: r.deleted,
        createdAt: r.createdAt.getTime(),
        updatedAt: r.updatedAt.getTime(),
        ownerId: r.ownerId,
      })),
      measurements: mRows.map((m) => ({
        id: m.id,
        stationId: m.stationId,
        type: m.type,
        value: m.value,
        unit: m.unit,
        notes: m.notes,
        author: m.author,
        deleted: m.deleted,
        measuredAt: m.measuredAt.getTime(),
        createdAt: m.createdAt.getTime(),
        ownerId: m.ownerId,
      })),
      photoCount: Number(photoCount?.n ?? 0),
      rejected: [...rejected.forms, ...rejected.stations, ...rejected.records, ...rejected.measurements],
    };
    return new Response(superjson.stringify(out));
  } catch (error) {
    if (error instanceof ViewerRequiredError) throw error;
    if (error instanceof GroupCodeError) return new Response(superjson.stringify({ error: error.message }), { status: 401 });
    const message = error instanceof Error ? error.message : String(error);
    return new Response(superjson.stringify({ error: message }), { status: 400 });
  }
}
