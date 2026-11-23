import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { buildDayBrief } from "@/lib/day-brief";

// Resumen del día: what the shell shows the first time a person enters SOLU each day. Fetched after the page is
// on screen, so it never slows a page down. ?scope=team is honoured only for Gerencia and Director Comercial.
export async function GET(req: Request) {
  const user = await requireUser();
  const headers = { "Cache-Control": "private, no-store" };
  if (user.role === "JUNTA") return Response.json({ groups: [], canTeam: false, scope: "mine" }, { headers });
  const scope = new URL(req.url).searchParams.get("scope") === "team" ? "team" : "mine";
  return Response.json(await buildDayBrief(user, makeI18n(user.lang), scope), { headers });
}
