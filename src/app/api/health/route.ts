// Liveness check for Render and uptime pingers. Deliberately does NOT touch the database:
// pinging it keeps the web service awake without spending Neon's free compute hours.
export const dynamic = "force-dynamic";

export function GET() {
  return new Response("ok", { headers: { "content-type": "text/plain", "cache-control": "no-store" } });
}
