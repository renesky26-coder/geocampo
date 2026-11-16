import superjson from "superjson";

export type OutputType = { userId: string; email: string } | { userId: null; email: null };

export const getMe = async (init?: RequestInit): Promise<OutputType> => {
  const result = await fetch(`/_api/me`, { method: "GET", ...init });
  if (!result.ok) {
    const errorObject = superjson.parse<{ error: string }>(await result.text());
    throw new Error(errorObject.error);
  }
  return superjson.parse<OutputType>(await result.text());
};