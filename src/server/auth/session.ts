/**
 * Stateless reviewer sessions: `base64url(payload).base64url(HMAC-SHA256(payload))` in an
 * httpOnly, SameSite=Lax cookie. Uses Web Crypto so it runs in both the proxy and route handlers.
 */
export const SESSION_COOKIE = "omx_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 12;

export interface Session {
  name: string;
  role: "reviewer";
  exp: number; // unix seconds
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function signSession(session: Session, secret: string): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify(session)));
  return `${payload}.${b64url(await hmac(secret, payload))}`;
}

export async function verifySession(token: string | undefined | null, secret: string, nowSec = Math.floor(Date.now() / 1000)): Promise<Session | null> {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  try {
    const expected = await hmac(secret, payload);
    if (!timingSafeEqual(expected, fromB64url(sig))) return null;
    const session = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as Session;
    if (typeof session.exp !== "number" || session.exp < nowSec || !session.name) return null;
    return session;
  } catch {
    return null;
  }
}

/** Constant-time comparison for the shared access code. */
export function accessCodeMatches(given: string, expected: string): boolean {
  return timingSafeEqual(enc.encode(given), enc.encode(expected));
}
