"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { isGerencia } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";

// Módulo 13 · simple teams (decision I-02). Gerencia groups people under a leader. A team only scopes reports:
// it gives the leader no authority to edit or approve anything.

const go = (qs: string): never => { refreshApp(); redirect(`/informes/equipo?${qs}#equipos`); };
async function gerencia() { const u = await requireUser(); if (!isGerencia(u)) go("err=permiso"); return u; }

export async function saveTeam(fd: FormData) {
  const user = await gerencia();
  const name = String(fd.get("name") ?? "").trim().slice(0, 80);
  const leader = await db.user.findFirst({ where: { id: String(fd.get("leaderId") ?? ""), active: true }, select: { id: true } });
  if (!name || !leader) go("err=equipo");
  await db.team.create({ data: { name, leaderId: leader!.id, createdByName: user.name } });
  go("ok=equipo");
}

export async function addMember(teamId: string, fd: FormData) {
  await gerencia();
  const team = await db.team.findUnique({ where: { id: teamId }, select: { leaderId: true } });
  const u = await db.user.findFirst({ where: { id: String(fd.get("userId") ?? ""), active: true }, select: { id: true } });
  // The leader leads the team; they are not listed as one of its members.
  if (!team || !u || u.id === team.leaderId) go("err=miembro");
  await db.teamMember.upsert({ where: { teamId_userId: { teamId, userId: u!.id } }, create: { teamId, userId: u!.id }, update: {} });
  go("ok=miembro");
}

export async function removeMember(memberId: string) {
  await gerencia();
  await db.teamMember.deleteMany({ where: { id: memberId } });
  go("ok=miembro");
}

export async function setTeamActive(teamId: string, fd: FormData) {
  await gerencia();
  await db.team.update({ where: { id: teamId }, data: { active: fd.get("active") === "1" } });
  go("ok=equipo");
}
