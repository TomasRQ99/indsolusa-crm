import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session-token";

// Cheap gate: bounce requests without a valid token to /login.
// Full checks (user still active, role) happen server-side in requireUser().
export async function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/login")) return NextResponse.next();
  const userId = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!userId) return NextResponse.redirect(new URL("/login", req.url));
  // The address being opened travels with the request, so requireUser() can keep a read-only role (Junta) inside
  // its curated pages. Set here, never trusted from the browser: an incoming header of this name is overwritten.
  const headers = new Headers(req.headers);
  headers.set("x-solu-path", req.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Static files (logo, icons) skip the auth gate: cheaper, and they can be cached.
  // api/worker has its own key check (the GitHub schedule has no login).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/|api/health|api/worker|.*\\.(?:png|jpg|jpeg|svg|ico|webp|woff2)$).*)"],
};
