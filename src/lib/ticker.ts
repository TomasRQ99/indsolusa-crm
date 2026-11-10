import { runWorker } from "./jobs";

// Since Render moved to a paid plan (2026-11-10) the server no longer sleeps, so SOLU runs its own background
// round every 15 minutes. The GitHub schedule (/api/worker) stays as an optional backup; both can run together
// safely (jobs are claimed with SKIP LOCKED and recurring work is planned once per time slot).
// On: on Render (RENDER=true) or with WORKER_INPROCESS=1. Off: WORKER_INPROCESS=0. Never on a local
// `npm start` by default, so testing never reads the real mailbox.

const EVERY = 15 * 60e3;

export function startTicker() {
  const on = process.env.WORKER_INPROCESS === "1" || (process.env.RENDER === "true" && process.env.WORKER_INPROCESS !== "0");
  const g = globalThis as unknown as { __soluTicker?: boolean };
  if (!on || g.__soluTicker) return;
  g.__soluTicker = true;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await runWorker({ trigger: "INTERNAL" });
    } catch (e) {
      console.error("internal worker round failed", e);
    } finally {
      busy = false;
    }
  };
  const first = Number(process.env.WORKER_FIRST_DELAY_MS ?? 2 * 60e3);
  setTimeout(tick, Number.isFinite(first) ? first : 2 * 60e3).unref?.();
  setInterval(tick, EVERY).unref?.();
}
