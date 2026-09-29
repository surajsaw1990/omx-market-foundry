/**
 * Optimistic auth check for console pages: unauthenticated visitors are redirected to /login.
 * API routes perform their own (authoritative) session verification in `server/http/handler.ts`.
 */
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/server/auth/session";
import { config as appConfig } from "@/server/config";

export async function proxy(request: NextRequest) {
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value, appConfig.sessionSecret);
  const { pathname } = request.nextUrl;
  if (!session && pathname !== "/login") {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }
  if (session && pathname === "/login") return NextResponse.redirect(new URL("/", request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|svg|ico|webp)$).*)"],
};
