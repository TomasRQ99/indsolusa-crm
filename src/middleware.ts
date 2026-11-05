import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session-token";

// Cheap gate: bounce requests without a valid token to /login.
// Full checks (user still active, role) happen server-side in requireUser().
export async function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/login")) return NextResponse.next();
  const userId = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!userId) return NextResponse.redirect(new URL("/login", req.url));
  return NextResponse.next();
}

export const config = {
  // Static files (logo, icons) skip the auth gate: cheaper, and they can be cached.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/|api/health|.*\\.(?:png|jpg|jpeg|svg|ico|webp|woff2)$).*)"],
};
