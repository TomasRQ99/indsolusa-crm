"use client";

export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="card">
      <h2>Something went wrong</h2>
      <p className="error">{error.message}</p>
      <button className="secondary" onClick={reset}>Try again</button>
    </div>
  );
}
