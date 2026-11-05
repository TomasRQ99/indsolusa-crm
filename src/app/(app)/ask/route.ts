import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { universalSearch } from "@/lib/search";
import { MODULES } from "@/lib/nav";

// "Pregúntale a SOLU" (first version): finds records and screens related to the question.
// AI answers are not connected yet; the panel says so instead of pretending.
export async function GET(req: Request) {
  const user = await requireUser();
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ hits: [], screens: [] });

  const words = q
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2);
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const es = user.lang === "ES";
  const manager = user.role === "ADMIN" || user.role === "MANAGER";

  const screens = MODULES.flatMap((m) =>
    m.tabs
      .filter((tab) => (!tab.managerOnly || manager) && (!tab.adminOnly || user.role === "ADMIN"))
      .filter((tab) => words.some((w) => norm(`${tab.es} ${tab.en} ${m.es} ${m.en}`).includes(w)))
      .map((tab) => ({ href: tab.href, label: `${es ? m.es : m.en} · ${es ? tab.es : tab.en}` })),
  ).slice(0, 5);

  // Search the whole question first, then each meaningful word, until something matches.
  let hits = await universalSearch(q);
  for (const w of words) {
    if (hits.length) break;
    hits = await universalSearch(w);
  }
  return NextResponse.json({ hits: hits.slice(0, 8), screens });
}
