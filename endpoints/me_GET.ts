import superjson from "superjson";
import { getViewer } from "@floot/viewer";
import type { OutputType } from "./me_GET.schema";

export async function handle(_request: Request) {
  const viewer = getViewer();
  const out: OutputType = viewer ? { userId: viewer.userId, email: viewer.email } : { userId: null, email: null };
  return new Response(superjson.stringify(out));
}