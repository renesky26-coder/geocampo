import { z } from "zod";
import superjson from "superjson";

// Public identity of the collector who created the item (sha256 of their private key). Set by the server.
const ownerId = z.string().max(64).nullable().optional();

const stationSchema = z.object({
  id: z.string().min(1).max(64),
  code: z.string().max(100),
  name: z.string().max(300),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  altitude: z.number().nullable(),
  description: z.string().max(5000),
  author: z.string().max(200),
  deleted: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
  ownerId,
});

const recordSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(["point", "line", "polygon"]),
  name: z.string().max(300),
  geometry: z.object({ type: z.enum(["Point", "LineString", "Polygon"]), coordinates: z.any() }),
  altitude: z.number().nullable(),
  accuracy: z.number().nullable(),
  attributes: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  dip: z.number().nullable(),
  dipDirection: z.number().nullable(),
  notes: z.string().max(20000),
  stationId: z.string().nullable(),
  author: z.string().max(200),
  deleted: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
  ownerId,
});

const measurementSchema = z.object({
  id: z.string().min(1).max(64),
  stationId: z.string().min(1).max(64),
  type: z.string().max(60),
  value: z.number(),
  unit: z.string().max(20),
  notes: z.string().max(2000),
  author: z.string().max(200),
  deleted: z.boolean(),
  measuredAt: z.number(),
  createdAt: z.number(),
  ownerId,
});

const formSchema = z.object({
  id: z.string().min(1).max(64),
  key: z.string().min(1).max(80),
  title: z.string().max(200),
  short: z.string().max(60),
  description: z.string().max(1000),
  fields: z.array(z.any()).max(80),
  author: z.string().max(200),
  deleted: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
  ownerId,
});

export const schema = z.object({
  forms: z.array(formSchema).max(100).optional(),
  stations: z.array(stationSchema).max(500),
  records: z.array(recordSchema).max(500),
  measurements: z.array(measurementSchema).max(2000),
  since: z.number().nullable(),
});

export type InputType = z.infer<typeof schema>;
export type SyncStation = z.infer<typeof stationSchema>;
export type SyncRecord = z.infer<typeof recordSchema>;
export type SyncMeasurement = z.infer<typeof measurementSchema>;
export type SyncForm = z.infer<typeof formSchema>;

export type OutputType = {
  serverTime: number;
  forms: SyncForm[];
  stations: SyncStation[];
  records: SyncRecord[];
  measurements: SyncMeasurement[];
  photoCount: number;
  /** Ids whose change was refused (not the sender's collection); their server version is included above. */
  rejected: string[];
};

export const postSync = async (body: InputType, init?: RequestInit): Promise<OutputType> => {
  const validatedInput = schema.parse(body);
  const result = await fetch(`/_api/sync`, {
    method: "POST",
    body: superjson.stringify(validatedInput),
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!result.ok) {
    const errorObject = superjson.parse<{ error: string }>(await result.text());
    throw new Error(errorObject.error);
  }
  return superjson.parse<OutputType>(await result.text());
};