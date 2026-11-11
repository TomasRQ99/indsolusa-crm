import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Lang, Role } from "@prisma/client";
import { db } from "./db";
import { coveringNow } from "./coverage";
import { BOARD_HOME, boardMayAct, boardMayOpen, isBoard } from "./permissions";
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
const loadUser = cache(async (): Promise<SessionUser | null> => {
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

/** The signed-in person. For the read-only Junta role this answers "nobody" outside its curated pages, so every
 *  download or data route that asks who is there refuses by itself (Módulo 15 §13). */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const user = await loadUser();
  if (user && isBoard(user)) {
    try {
      const h = await headers();
      const path = h.get("x-solu-path") ?? "";
      if (!boardMayOpen(path) || (h.has("next-action") && !boardMayAct(path))) return null;
    } catch { return null; }
  }
  return user;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await loadUser();
  if (!user) redirect("/login");
  // Junta o asamblea (Módulo 15 §13): read-only and curated. Every page and every action passes through here, so
  // this one check keeps the role inside its pages and stops it from saving anything but its own profile.
  if (isBoard(user)) {
    const h = await headers();
    const path = h.get("x-solu-path") ?? "";
    if (h.has("next-action") && !boardMayAct(path)) redirect(`${BOARD_HOME}?err=solo-lectura`);
    if (!boardMayOpen(path)) redirect(BOARD_HOME);
  }
  return user;
}

export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/mi-dia");
  return user;
}
