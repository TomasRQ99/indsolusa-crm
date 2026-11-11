import { db } from "./db";
import { periodOf, shiftPeriod } from "./goal-rules";
import { sendMail } from "./mail";

// Módulo 13 §16 · Monthly Business Pulse (decision 2026-11-11). Gerencia issues the month's report from SOLU; SOLU
// only reminds them by email that it is ready. The email carries no figures: the report lives in SOLU.

export const reminderText = (period: string, lang: string, url: string | null) => {
  const where = url ? `${url}/informes/pulso?mes=${period}` : null;
  return lang === "en"
    ? { subject: `SOLU: the ${period} report is ready to issue`, text: `The month ${period} has ended and its Business Pulse is ready.\n\nReview the figures and issue the report from SOLU: REPORTS → Business pulse → "Issue the ${period} report with these figures".${where ? `\n\n${where}` : ""}\n\nUntil it is issued, the figures keep being recalculated from live data.\n\nSOLU · Industry Solutions USA` }
    : { subject: `SOLU: el informe de ${period} está listo para emitir`, text: `El mes ${period} terminó y su Pulso del negocio está listo.\n\nRevisa las cifras y emite el informe desde SOLU: INFORMES → Pulso del negocio → «Emitir el informe de ${period} con estas cifras».${where ? `\n\n${where}` : ""}\n\nMientras no se emita, las cifras se siguen recalculando con los datos de hoy.\n\nSOLU · Industry Solutions USA` };
};

export async function pulseReminder(now = new Date()) {
  const period = shiftPeriod(periodOf(now), -1);
  if (await db.pulseSnapshot.findFirst({ where: { period, reopenedAt: null }, select: { id: true } })) return `already issued ${period}`;
  const people = await db.user.findMany({ where: { role: "GERENCIA", active: true }, select: { email: true, name: true, lang: true } });
  const url = (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || "").trim().replace(/\/+$/, "") || null;
  let sent = 0;
  for (const p of people) {
    if (!p.email) continue;
    const m = reminderText(period, p.lang, url);
    await sendMail({ to: { address: p.email, name: p.name }, subject: m.subject, text: m.text, senderName: "SOLU" });
    sent++;
  }
  return `reminded ${sent} for ${period}`;
}
