import { config } from "@/server/config";
import { api } from "@/server/http/handler";

export const dynamic = "force-dynamic";

export const GET = api(
  async ({ session }) =>
    Response.json({
      user: session ? { name: session.name, role: session.role } : null,
      demoAccessCode: config.showDemoCode ? config.reviewerAccessCode : null,
    }),
  { auth: false },
);
