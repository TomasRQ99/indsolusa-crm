"use server";

// Mercado M2 commands: facts about how a company and its plants work. Anyone can add a fact; nothing is
// overwritten (a replaced observation keeps its date and the reason). Every fact keeps source and certainty.

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { refreshApp } from "@/lib/revalidate";
import { money2 } from "@/lib/money";
import { AREAS, asBlock, asBuyTopic, asConfidence, asRedundancy, asSource, asStep, asStops, asValueTopic } from "@/lib/market-rules";

const txt = (fd: FormData, k: string, max = 500) => { const v = String(fd.get(k) ?? "").replace(/\r\n/g, "\n").trim().slice(0, max); return v || null; };
const dayOf = (v: FormDataEntryValue | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? new Date(`${String(v)}T00:00:00Z`) : null);
const idOf = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? "").trim(); return /^[a-z0-9]{10,40}$/i.test(v) ? v : null; };
/** Amount typed in a number field ("40000000" or "1250.5"); invalid or negative = not given. */
const amt = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? "").trim().replace(",", "."); if (!v || !/^\d+(\.\d+)?$/.test(v)) return null; const n = Number(v); return n > 0 && n < 1e14 ? money2(n) : null; };
const company = (id: string, qs = "") => `/mercado/empresas/${id}${qs ? `?${qs}` : ""}`;
const plantUrl = (id: string, qs = "") => `/mercado/plantas/${id}${qs ? `?${qs}` : ""}`;
const go = (path: string): never => { refreshApp(); redirect(path); };
/** Where to return: only Mercado pages. */
const backOf = (fd: FormData, fallback: string) => { const b = txt(fd, "back", 200); return b && /^\/mercado\//.test(b) ? b : fallback; };
const withQ = (path: string, q: string) => `${path}${path.includes("?") ? "&" : "?"}${q}`;
const provenance = (fd: FormData) => ({ sourceType: asSource(txt(fd, "sourceType", 30)), sourceRef: txt(fd, "sourceRef", 300), confidence: asConfidence(txt(fd, "confidence", 20)) });

export async function addAlias(accountId: string, fd: FormData) {
  const user = await requireUser();
  const name = txt(fd, "name", 160);
  if (!name) go(company(accountId, "err=alias"));
  const kind = ["LEGAL", "TRADE", "ACRONYM"].includes(String(fd.get("kind"))) ? String(fd.get("kind")) : "TRADE";
  await db.accountAlias.upsert({ where: { accountId_name: { accountId, name: name! } }, update: {}, create: { accountId, name: name!, kind, createdByName: user.name } });
  go(company(accountId, "ok=alias"));
}
export async function removeAlias(accountId: string, aliasId: string) {
  await requireUser();
  await db.accountAlias.deleteMany({ where: { id: aliasId, accountId } });
  go(company(accountId));
}

/** One observation of "how this account works". VALUE needs evidence: what they said or did (§4.18). */
export async function addInsight(accountId: string, fd: FormData) {
  const user = await requireUser();
  const block: string = asBlock(txt(fd, "block", 20));
  const back = backOf(fd, company(accountId));
  const statement = txt(fd, "statement", 500);
  const evidence = txt(fd, "evidence", 500);
  if (!statement) go(withQ(back, "err=insight"));
  if (block === "VALUE" && !evidence) go(withQ(back, "err=evidencia"));
  const area = txt(fd, "area", 60);
  await db.accountInsight.create({
    data: {
      accountId, plantId: idOf(fd, "plantId"), block, statement: statement!, evidence, area: area && (AREAS.includes(area) || area.length <= 60) ? area : null,
      topic: block === "BUY" ? asBuyTopic(txt(fd, "topic", 20)) : block === "VALUE" ? asValueTopic(txt(fd, "topic", 20)) : null,
      step: block === "DECIDE" ? asStep(txt(fd, "step", 20)) : null, condition: block === "DECIDE" || block === "BUY" ? txt(fd, "condition", 120) : null,
      observedAt: dayOf(fd.get("observedAt")) ?? new Date(), capturedByName: user.name, ...provenance(fd),
    },
  });
  go(withQ(back, "ok=insight"));
}
/** "It's no longer like this": the old observation stays in history with the reason. */
export async function supersedeInsight(insightId: string, fd: FormData) {
  await requireUser();
  const note = txt(fd, "note", 300);
  const i = await db.accountInsight.findUnique({ where: { id: insightId }, select: { accountId: true } });
  if (!i) go("/mercado");
  const back = backOf(fd, company(i!.accountId));
  if (!note) go(withQ(back, "err=cambio"));
  await db.accountInsight.update({ where: { id: insightId }, data: { supersededAt: new Date(), supersededNote: note } });
  go(withQ(back, "ok=cambio"));
}

export async function addPlantFromCompany(accountId: string, fd: FormData) {
  const user = await requireUser();
  const name = txt(fd, "name", 120);
  if (!name) go(company(accountId, "err=planta"));
  const p = await db.plant.create({ data: { accountId, name: name!, city: txt(fd, "city", 80), country: txt(fd, "country", 60), operationType: txt(fd, "operationType", 200), observedAt: dayOf(fd.get("observedAt")) ?? new Date(), capturedByName: user.name, ...provenance(fd) } });
  go(plantUrl(p.id, "ok=nueva"));
}

/** Installed equipment (§4.8): what we saw or were told, with its source. */
export async function addAsset(plantId: string, fd: FormData) {
  const user = await requireUser();
  const name = txt(fd, "name", 160);
  if (!name) go(plantUrl(plantId, "err=equipo"));
  await db.installedAsset.create({
    data: {
      plantId, name: name!, process: txt(fd, "process", 120), line: txt(fd, "line", 120), manufacturer: txt(fd, "manufacturer", 80), model: txt(fd, "model", 120), serial: txt(fd, "serial", 120),
      operationalRole: txt(fd, "operationalRole", 200), redundancy: asRedundancy(txt(fd, "redundancy", 20)), critical: fd.get("critical") === "1", criticalWhy: txt(fd, "criticalWhy", 300),
      knownComponents: txt(fd, "knownComponents", 500), observedAt: dayOf(fd.get("observedAt")) ?? new Date(), capturedByName: user.name, ...provenance(fd),
    },
  });
  go(plantUrl(plantId, "ok=equipo"));
}

/** What a stop costs (§8). REPORTED = the customer's figure; GUIDED = SOLU computes from production data. Never one exact number unless that's what they said. */
export async function addImpact(plantId: string, fd: FormData) {
  const user = await requireUser();
  const scope = txt(fd, "scope", 200);
  if (!scope) go(plantUrl(plantId, "err=impacto"));
  const level = fd.get("level") === "GUIDED" ? "GUIDED" : "REPORTED";
  const currency = String(fd.get("currency") ?? "COP") === "USD" ? "USD" : "COP"; // each company keeps its own currency; no conversion
  const data = {
    costPerHourMin: level === "REPORTED" ? amt(fd, "costPerHourMin") : null, costPerHourMax: level === "REPORTED" ? amt(fd, "costPerHourMax") : null,
    unitsPerHour: level === "GUIDED" ? amt(fd, "unitsPerHour") : null, contributionUnit: level === "GUIDED" ? amt(fd, "contributionUnit") : null,
    scrapPerHour: level === "GUIDED" ? amt(fd, "scrapPerHour") : null, idleLaborPerHour: level === "GUIDED" ? amt(fd, "idleLaborPerHour") : null,
  };
  if (level === "GUIDED" && (data.unitsPerHour == null || data.contributionUnit == null)) go(plantUrl(plantId, "err=guiado"));
  await db.impactProfile.create({
    data: {
      plantId, assetId: idOf(fd, "assetId"), scope: scope!, stopsLine: asStops(txt(fd, "stopsLine", 10)), timeToImpact: txt(fd, "timeToImpact", 200), level, currency, ...data,
      restartCost: amt(fd, "restartCost"), basis: txt(fd, "basis", 300), observedAt: dayOf(fd.get("observedAt")) ?? new Date(), capturedByName: user.name,
      ...provenance(fd), confidence: level === "GUIDED" ? "INFERRED" : asConfidence(txt(fd, "confidence", 20)),
    },
  });
  go(plantUrl(plantId, "ok=impacto"));
}

/** Person ≠ job (§4.10): links an existing contact to this company, plant and area with their real role. */
export async function addEmployment(accountId: string, fd: FormData) {
  const user = await requireUser();
  const back = backOf(fd, company(accountId));
  let contactId = idOf(fd, "contactId");
  const first = txt(fd, "firstName", 60), last = txt(fd, "lastName", 60);
  if (!contactId && first) contactId = (await db.contact.create({ data: { firstName: first, lastName: last ?? "", title: txt(fd, "role", 120), accountId } })).id;
  if (!contactId) go(withQ(back, "err=persona"));
  await db.employment.create({ data: { contactId: contactId!, accountId, plantId: idOf(fd, "plantId"), area: txt(fd, "area", 60), role: txt(fd, "role", 120), startedOn: dayOf(fd.get("startedOn")), capturedByName: user.name, ...provenance(fd) } });
  go(withQ(back, "ok=persona"));
}
/** Left the role or the company: the history stays. */
export async function endEmployment(employmentId: string, fd: FormData) {
  await requireUser();
  const e = await db.employment.findUnique({ where: { id: employmentId }, select: { accountId: true } });
  if (!e) go("/mercado");
  await db.employment.update({ where: { id: employmentId }, data: { endedOn: dayOf(fd.get("endedOn")) ?? new Date() } });
  go(withQ(backOf(fd, company(e!.accountId)), "ok=persona"));
}

/** A suggested discovery question (or one typed) becomes an open question on the company or plant. */
export async function addOpenQuestion(accountId: string, fd: FormData) {
  const user = await requireUser();
  const back = backOf(fd, company(accountId));
  const q = txt(fd, "question", 300);
  if (!q) go(withQ(back, "err=pregunta"));
  await db.knowledgeGap.create({ data: { accountId, plantId: idOf(fd, "plantId"), explorationId: idOf(fd, "explorationId"), question: q!, why: txt(fd, "why", 300), createdByName: user.name } });
  go(withQ(back, "ok=pregunta"));
}
export async function answerQuestion(gapId: string, fd: FormData) {
  const user = await requireUser();
  const g = await db.knowledgeGap.findUnique({ where: { id: gapId }, select: { accountId: true, plantId: true, explorationId: true } });
  if (!g) go("/mercado");
  const back = backOf(fd, g!.accountId ? company(g!.accountId) : g!.explorationId ? `/mercado/exploraciones/${g!.explorationId}` : "/mercado");
  const answer = txt(fd, "answer", 1000);
  if (!answer) go(withQ(back, "err=respuesta"));
  await db.knowledgeGap.updateMany({ where: { id: gapId, status: "OPEN" }, data: { status: "RESOLVED", answer, answerSource: txt(fd, "answerSource", 200), resolvedAt: new Date(), resolvedByName: user.name } });
  go(withQ(back, "ok=aprendido"));
}

/** Next useful movement when no exploration includes this company yet: start one scoped to it. */
export async function exploreCompany(accountId: string) {
  const user = await requireUser();
  const a = await db.account.findUnique({ where: { id: accountId }, select: { id: true, name: true } });
  if (!a) go("/mercado");
  const clean = a!.name.replace(/\s*\(ejemplo\)$/, "");
  const e = await db.exploration.create({
    data: {
      name: `Explorar ${clean}`, purpose: `Entender cómo funciona ${clean} y dónde podríamos ser útiles.`, scope: "COMPANY", scopeText: a!.name, ownerId: user.id, movement: "CLARITY_NEEDED",
      links: { create: [{ kind: "ACCOUNT", refId: a!.id, label: a!.name, why: "Exploración de la empresa" }] },
    },
  });
  go(`/mercado/exploraciones/${e.id}?nuevo=1`);
}
