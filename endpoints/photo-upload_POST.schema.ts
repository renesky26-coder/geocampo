import { z } from "zod";
import superjson from "superjson";

export const schema = z.object({
  id: z.string().min(1).max(64),
  recordId: z.string().max(64).nullable(),
  stationId: z.string().max(64).nullable(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  altitude: z.number().nullable(),
  accuracy: z.number().nullable(),
  azimuth: z.number().nullable(),
  caption: z.string().max(1000),
  author: z.string().max(200),
  takenAt: z.number(),
  originalSize: z.number().int().positive().max(100 * 1024 * 1024),
  annotatedSize: z.number().int().positive().max(100 * 1024 * 1024).nullable(),
});

export type InputType = z.infer<typeof schema>;

type Upload = { presignedUrl: string; headers: Record<string, string> };
export type OutputType = { original: Upload; annotated: Upload | null };

export const postPhotoUpload = async (body: InputType, init?: RequestInit): Promise<OutputType> => {
  const validatedInput = schema.parse(body);
  const result = await fetch(`/_api/photo-upload`, {
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