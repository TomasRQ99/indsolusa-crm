"use client";

export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  const es = typeof document === "undefined" || document.documentElement.lang !== "en";
  return (
    <div className="card">
      <h2>{es ? "Algo salió mal" : "Something went wrong"}</h2>
      <p className="error">{error.message}</p>
      <button className="secondary" onClick={reset}>{es ? "Intentar de nuevo" : "Try again"}</button>
    </div>
  );
}
