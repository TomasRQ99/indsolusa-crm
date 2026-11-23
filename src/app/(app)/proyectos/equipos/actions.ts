"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { isGerencia } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { fText } from "@/lib/fd";

// Proyectos y notas → Equipos guardados. A saved team is a named folder of people. Only Gerencia creates and
// changes them; everyone sees them. It gives no authority and changes nobody's role.

const back = (qs: string): never => { refreshApp(); redirect(`/proyectos/equipos?${qs}`); };

async function gerencia() {
  const user = await requireUser();
  if (!isGerencia(user)) back("err=permiso");
  return user;
}
async function peopleOf(fd: FormData) {
  const ids = [...new Set(fd.getAll("people").map(String).filter(Boolean))];
  return ids.length ? db.user.findMany({ where: { id: { in: ids }, active: true, role: { not: "JUNTA" } }, select: { id: true } }) : [];
}

export async function createTeam(fd: FormData) {
  const user = await gerencia();
  const name = fText(fd, "name", 60);
  const people = await peopleOf(fd);
  if (!name || people.length === 0) back("err=datos#nuevo");
  if (await db.projectTeam.findFirst({ where: { name: { equals: name!, mode: "insensitive" } }, select: { id: true } })) back("err=nombre#nuevo");
  const team = await db.projectTeam.create({ data: { name: name!, description: fText(fd, "description", 200), createdByName: user.name, members: { create: people.map((p) => ({ userId: p.id })) } } });
  back(`ok=creado#e-${team.id}`);
}

/** Name, description and who is in it. People already seated in projects through this team stay there. */
export async function updateTeam(id: string, fd: FormData) {
  await gerencia();
  const name = fText(fd, "name", 60);
  const people = await peopleOf(fd);
  if (!name || people.length === 0) back(`err=datos#e-${id}`);
  if (await db.projectTeam.findFirst({ where: { id: { not: id }, name: { equals: name!, mode: "insensitive" } }, select: { id: true } })) back(`err=nombre#e-${id}`);
  const keep = people.map((p) => p.id);
  await db.$transaction([
    db.projectTeam.update({ where: { id }, data: { name: name!, description: fText(fd, "description", 200) } }),
    db.projectTeamMember.deleteMany({ where: { teamId: id, userId: { notIn: keep } } }),
    db.projectTeamMember.createMany({ data: keep.map((userId) => ({ teamId: id, userId })), skipDuplicates: true }),
  ]);
  back(`ok=guardado#e-${id}`);
}

/** Archive = it is no longer offered for new projects; the projects that already have it keep it. */
export async function setTeamActive(id: string, active: boolean) {
  await gerencia();
  await db.projectTeam.update({ where: { id }, data: { active } });
  back(`ok=${active ? "activado" : "archivado"}#e-${id}`);
}
