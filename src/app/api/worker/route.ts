import { NextResponse } from "next/server";
import { checkWorkerKey, runWorker } from "@/lib/jobs";

// Called every 15 minutes by the GitHub schedule (.github/workflows/solu-worker.yml).
// Only with the worker key: "Authorization: Bearer <key>". No login, no user data in the answer.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (!(await checkWorkerKey(key))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const r = await runWorker({ trigger: "SCHEDULE" });
    return NextResponse.json({ ok: r.ok, done: r.done, failed: r.failed, pending: r.pending, ms: r.ms });
  } catch (e) {
    console.error("worker run failed", e);
    return NextResponse.json({ ok: false, error: "run_failed" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: false, error: "use POST" }, { status: 405 });
}
