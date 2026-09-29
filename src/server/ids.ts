import { createHash, randomUUID } from "node:crypto";

/** Prefixed, URL-safe random id, e.g. `cand_3f9a…`. */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
