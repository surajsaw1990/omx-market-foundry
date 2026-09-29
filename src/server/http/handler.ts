/**
 * Wrapper for API route handlers: request id, timing log, auth, same-origin check for mutations,
 * and uniform JSON errors ({ error: { code, message, details } }).
 */
import type { NextRequest } from "next/server";
import { ZodError } from "zod";
import { config } from "../config";
import { getDb, type Db } from "../db/client";
import { logger } from "../logger";
import { SESSION_COOKIE, verifySession, type Session } from "../auth/session";
import { AppError } from "./errors";

export interface ApiContext {
  req: NextRequest;
  db: Db;
  session: Session | null;
  actor: string;
  requestId: string;
}

interface Options {
  /** Require a signed-in reviewer (default true). */
  auth?: boolean;
}

export function jsonError(status: number, code: string, message: string, details?: unknown, requestId?: string) {
  return Response.json({ error: { code, message, ...(details !== undefined ? { details } : {}) } }, { status, headers: requestId ? { "x-request-id": requestId } : undefined });
}

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients (curl, server-to-server) don't send Origin
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function api<P = unknown>(handler: (ctx: ApiContext, params: P) => Promise<Response>, opts: Options = {}) {
  return async (req: NextRequest, routeCtx: { params: Promise<P> }): Promise<Response> => {
    const requestId = crypto.randomUUID().slice(0, 8);
    const started = Date.now();
    const mutating = !["GET", "HEAD", "OPTIONS"].includes(req.method);
    try {
      if (mutating && !sameOrigin(req)) throw new AppError(403, "CROSS_ORIGIN", "Cross-origin requests are not allowed.");
      const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value, config.sessionSecret);
      if (opts.auth !== false && !session) throw new AppError(401, "UNAUTHENTICATED", "Sign in as a reviewer to continue.");
      const db = await getDb();
      const params = (await routeCtx?.params) as P;
      const res = await handler({ req, db, session, actor: session?.name ?? "anonymous", requestId }, params);
      res.headers.set("x-request-id", requestId);
      if (mutating || res.status >= 400) {
        logger.info("api.request", { requestId, method: req.method, path: req.nextUrl.pathname, status: res.status, ms: Date.now() - started, actor: session?.name });
      }
      return res;
    } catch (err) {
      if (err instanceof AppError) {
        logger.info("api.error", { requestId, method: req.method, path: req.nextUrl.pathname, status: err.status, code: err.code });
        return jsonError(err.status, err.code, err.message, err.details, requestId);
      }
      if (err instanceof ZodError) {
        return jsonError(422, "VALIDATION_FAILED", "Request body is invalid.", err.issues.map((i) => ({ field: i.path.join("."), message: i.message })), requestId);
      }
      if (err instanceof SyntaxError) return jsonError(400, "BAD_JSON", "Request body must be valid JSON.", undefined, requestId);
      logger.error("api.unhandled", { requestId, method: req.method, path: req.nextUrl.pathname, err });
      return jsonError(500, "INTERNAL", "Something went wrong. The error has been logged.", { requestId }, requestId);
    }
  };
}

export async function readJson(req: NextRequest): Promise<unknown> {
  const text = await req.text();
  if (text.length > 100_000) throw new AppError(413, "PAYLOAD_TOO_LARGE", "Request body too large.");
  return text ? JSON.parse(text) : {};
}
