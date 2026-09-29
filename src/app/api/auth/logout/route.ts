import { SESSION_COOKIE } from "@/server/auth/session";
import { api } from "@/server/http/handler";

export const POST = api(
  async () => {
    const res = Response.json({ ok: true });
    res.headers.append("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    return res;
  },
  { auth: false },
);
