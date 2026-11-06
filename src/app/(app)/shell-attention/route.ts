import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { shellAttention } from "@/lib/attention";

// Sidebar counters and bell alerts, fetched by the shell after the page is on screen.
// Kept out of the page payload so neither page loads nor saves ever wait for them.
export async function GET() {
  const user = await requireUser();
  const data = await shellAttention(user, makeI18n(user.lang));
  return Response.json(data, { headers: { "Cache-Control": "private, no-store" } });
}
