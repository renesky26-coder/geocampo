// Backend only: checks the group access code and identifies the collector (owner) of the request.
import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "./db";

// Fallback in case the settings row is missing. The real group code is NOT kept in the
// public repository: set GEOCAMPO_GROUP_CODE as a secret (or the appSettings row
// "group_code_sha256") in your own deployment.
const DEFAULT_HASH = createHash("sha256").update(process.env.GEOCAMPO_GROUP_CODE ?? "troque-este-codigo").digest("hex");

export class GroupCodeError extends Error {}

/**
 * Throws GroupCodeError unless the request carries the right group code.
 * ownerId = sha256(collector key): the collector's public identity. The secret key itself
 * is never stored or returned, so nobody can impersonate another collector.
 */
export async function groupAuth(request: Request): Promise<{ deviceId: string; ownerId: string | null }> {
  const code = (request.headers.get("x-geocampo-grupo") ?? "").trim().toLowerCase();
  if (!code) throw new GroupCodeError("Informe o código do grupo em Dados → Código do grupo.");
  const row = await db.selectFrom("appSettings").select("value").where("key", "=", "group_code_sha256").executeTakeFirst();
  const expected = Buffer.from(row?.value ?? DEFAULT_HASH, "hex");
  const got = createHash("sha256").update(code).digest();
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) {
    throw new GroupCodeError("Código do grupo incorreto.");
  }
  const key = (request.headers.get("x-owner-key") ?? "").trim();
  const ownerId = key.length >= 16 ? createHash("sha256").update(key).digest("hex") : null;
  return { deviceId: (request.headers.get("x-device-id") ?? "").slice(0, 64), ownerId };
}
