import { requireUser } from "@/lib/auth";
import { proposalData } from "@/lib/solution";
import { proposalLeak, renderProposal } from "@/lib/proposal-html";

// Comercial C5 §18 · Solution Proposal for one quote version (printable page). ?lang=EN|ES overrides the quote's language.
// Preview and human approval before sending: SOLU never sends it by itself.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const p = await proposalData(id);
  if (!p) return new Response("Not found", { status: 404 });
  const l = new URL(req.url).searchParams.get("lang");
  const lang = l === "ES" || l === "EN" ? l : p.lang;
  const html = renderProposal(p, lang);
  const leak = proposalLeak(html, p.privateNames);
  const headers = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  if (leak) {
    const msg = lang === "EN"
      ? `This proposal contains internal wording ("${leak}") in a free-text field. Edit the Solution Case or the quote and open it again. Internal costs, margins and our suppliers never go to the customer.`
      : `La propuesta contiene una palabra interna («${leak}») en un texto libre. Corrige el Caso de solución o la cotización y vuelve a abrirla. Costos, márgenes y nuestros proveedores nunca van al cliente.`;
    return new Response(`<!doctype html><meta charset="utf-8"><body style="font:15px system-ui;max-width:640px;margin:40px auto;padding:0 16px"><p>${msg.replace(/</g, "&lt;")}</p></body>`, { status: 422, headers });
  }
  return new Response(html, { headers });
}
