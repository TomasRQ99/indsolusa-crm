import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Lang, Role } from "@prisma/client";
import { db } from "./db";
import { coveringNow } from "./coverage";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSessionToken, verifySessionToken } from "./session-token";

export type SessionUser = { id: string; name: string; email: string; role: Role; lang: Lang; workdayMinutes: number; outlookConnectedAt: Date | null; covering: string[] };

export async function createSession(userId: string) {
  const token = await signSessionToken(userId);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function destroySession() {
  (await cookies()).delete(SESSION_COOKIE);
}

// The token only carries the user id; role and active status are read from the DB
// on every request, so role changes and deactivations take effect immediately.
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const userId = await verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!userId) return null;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, active: true, lang: true, workdayMinutes: true, outlookConnectedAt: true },
  });
  if (!user || !user.active) return null;
  // Comercial C8b: whose Journeys this person covers right now. Read on every request, so delegated authority
  // ends by itself when the window closes or the coverage is revoked.
  return {
    covering: await coveringNow(user.id),
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    lang: user.lang,
    workdayMinutes: user.workdayMinutes,
    outlookConnectedAt: user.outlookConnectedAt,
  };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/mi-dia");
  return user;
}
