import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getGuide, searchGuides, starterGuides } from "@/lib/guide";
import { guideCase, guideExamples } from "@/lib/guide-case";

// On-screen guide. ?q= answers "what did the person ask for" with the functions of the Guía de campo
// that match; ?id= (and ?route=1 for the whole way from the first need) returns the steps to show on screen.
// ?case=<page> says where the Journey of that page is, so the guide follows what the person sees;
// ?examples=1 lists the sample Journeys to practise with.
export async function GET(req: Request) {
  const user = await requireUser();
  // The person turned the training guide off in Mi perfil: nothing is offered.
  if (!user.guideOn) return NextResponse.json({ guides: [], guide: null, off: true });
  const url = new URL(req.url);
  const es = user.lang === "ES";
  const casePath = url.searchParams.get("case");
  if (casePath !== null) return NextResponse.json({ case: await guideCase(casePath, url.searchParams.get("deal"), user, es) });
  if (url.searchParams.get("examples") === "1") return NextResponse.json({ examples: await guideExamples(user, es) });
  const id = url.searchParams.get("id");
  if (id) {
    const guide = getGuide(id, url.searchParams.get("route") === "1", user);
    return guide ? NextResponse.json({ guide }) : NextResponse.json({ guide: null }, { status: 404 });
  }
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
  // Nothing typed yet: offer the everyday work, so a new person has somewhere to start.
  if (!q) return NextResponse.json({ guides: starterGuides(user), starters: true });
  return NextResponse.json({ guides: q.length >= 3 ? searchGuides(q, user) : [] });
}
