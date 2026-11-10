// Runs once when the server starts. The background ticker lives in lib/ticker.ts and is loaded only
// on the Node.js server (this exact `if` lets Next leave it out of the edge build).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startTicker } = await import("./lib/ticker");
    startTicker();
  }
}
