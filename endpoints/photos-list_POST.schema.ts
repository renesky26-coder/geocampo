import { z } from "zod";
import superjson from "superjson";

export const schema = z.object({
  knownIds: z.array(z.string().max(64)).max(20000),
  limit: z.number().int().min(1).max(200).default(100),
});

export type InputType = z.infer<typeof schema>;

export type RemotePhoto = {
  id: string;
  recordId: string | null;
  stationId: string | null;
  lat: number | null;
  lon: number | null;
  altitude: number | null;
  accuracy: number | null;
  azimuth: number | null;
  caption: string;
  author: string;
  takenAt: number;
  url: string;
  annotatedUrl: string | null;
  ownerId: string | null;
};

export type OutputType = { photos: RemotePhoto[]; remaining: number };

export const postPhotosList = async (body: InputType, init?: RequestInit): Promise<OutputType> => {
  const validatedInput = schema.parse(body);
  const result = await fetch(`/_api/photos-list`, {
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