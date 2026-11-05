// Shown instantly inside the shell while a screen loads (and prefetched for links),
// so a click always gets immediate feedback even when the server is slow.
export default function Loading() {
  return (
    <div className="skel" aria-busy="true" aria-live="polite">
      <span className="sr-only">Cargando… / Loading…</span>
      <div className="skel-line w30" />
      <div className="skel-line h28 w55" />
      <div className="skel-line w70" />
      <div className="skel-grid">
        <div className="skel-card" />
        <div className="skel-card" />
        <div className="skel-card" />
      </div>
      <div className="skel-card tall" />
    </div>
  );
}
