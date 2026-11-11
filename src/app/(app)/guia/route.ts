import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getGuide, searchGuides, starterGuides } from "@/lib/guide";

// On-screen guide. ?q= answers "what did the person ask for" with the functions of the Guía de campo
// that match; ?id= (and ?route=1 for the whole way from the first need) returns the steps to show on screen.
export async function GET(req: Request) {
  const user = await requireUser();
  // The person turned the training guide off in Mi perfil: nothing is offered.
  if (!user.guideOn) return NextResponse.json({ guides: [], guide: null, off: true });
  const url = new URL(req.url);
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
