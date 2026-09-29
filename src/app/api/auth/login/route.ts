import { z } from "zod";
import { accessCodeMatches, SESSION_COOKIE, SESSION_TTL_SECONDS, signSession } from "@/server/auth/session";
import { config } from "@/server/config";
import { AppError } from "@/server/http/errors";
import { api, readJson } from "@/server/http/handler";
import { audit } from "@/server/repositories/others";

const schema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(60),
  code: z.string().min(1, "Enter the access code").max(200),
});

export const POST = api(
  async ({ req, db }) => {
    const body = schema.parse(await readJson(req));
    if (!accessCodeMatches(body.code, config.reviewerAccessCode)) {
      await new Promise((r) => setTimeout(r, 400)); // slow down guessing
      throw new AppError(401, "INVALID_CODE", "That access code is not valid.");
    }
    const session = { name: body.name, role: "reviewer" as const, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS };
    const token = await signSession(session, config.sessionSecret);
    await audit(db, { entityType: "session", entityId: body.name, action: "signed_in", actor: body.name });
    const res = Response.json({ user: { name: session.name, role: session.role } });
    res.headers.append(
      "Set-Cookie",
      `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${config.isProd ? "; Secure" : ""}`,
    );
    return res;
  },
  { auth: false },
);
