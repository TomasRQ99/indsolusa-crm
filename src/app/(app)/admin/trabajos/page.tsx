import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { JOB_LABEL, workerKeyInfo, type JobKind } from "@/lib/jobs";
import { KeyButton } from "./KeyButton";
import { retry, runNow } from "./actions";

// Equipo · background work: is the GitHub schedule calling? what ran, what failed, retry.

export default async function WorkerPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireRole("GERENCIA");
  const sp = await searchParams;
  const i = makeI18n(user.lang);
  const { t } = i;
  const [runs, failed, due, key, lastSchedule] = await Promise.all([
    db.workerRun.findMany({ orderBy: { startedAt: "desc" }, take: 15 }),
    db.job.findMany({ where: { status: "FAILED" }, orderBy: { doneAt: "desc" }, take: 30 }),
    db.job.count({ where: { status: "PENDING" } }),
    workerKeyInfo(),
    db.workerRun.findFirst({ where: { trigger: { in: ["SCHEDULE", "INTERNAL"] } }, orderBy: { startedAt: "desc" } }),
  ]);
  const label = (k: string) => (k in JOB_LABEL ? t(...JOB_LABEL[k as JobKind]) : k);
  // The stored summary is technical ("MAIL_REPLIES×1, … · 3 still due"); show it in the person's language.
  const summaryText = (s: string | null) =>
    !s ? "" : s.startsWith("error:") ? t(`Error: ${s.slice(6).trim()}`, s)
      : s.replace(/\b([A-Z_]+)×(\d+)/g, (_, k: string, n: string) => `${label(k)} ×${n}`)
        .replace("nothing due", t("nada pendiente", "nothing due"))
        .replace(/(\d+) still due/, (_, n: string) => t(`${n} aún pendientes`, `${n} still due`));
  const mins = lastSchedule ? Math.round((Date.now() - lastSchedule.startedAt.getTime()) / 60e3) : null;
  const health = mins == null ? { c: "attn", x: t("Aún no ha corrido una ronda automática", "No automatic round has run yet") } : mins <= 40 ? { c: "ok", x: t(`Funcionando · última ronda hace ${mins} min`, `Working · last round ${mins} min ago`) } : { c: "risk", x: t(`Sin rondas automáticas desde hace ${mins} min`, `No automatic rounds for ${mins} min`) };
  const ts = (d: Date) => new Intl.DateTimeFormat(i.es ? "es-CO" : "en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Bogota" }).format(d);

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb">{t("Equipo", "Team")}</div>
          <h1>{t("Trabajos en segundo plano", "Background work")}</h1>
          <p>{t("Cada 15 minutos, SOLU (el servidor ya no se duerme) lee respuestas de correo, importa correos de clientes conocidos, actualiza el catálogo de repuestos y recalcula cómo pagan los clientes, aunque nadie esté usando SOLU. Si algo falla, se reintenta solo; si sigue fallando, aparece aquí.", "Every 15 minutes, SOLU (the server no longer sleeps) reads email replies, imports emails from known customers, refreshes the parts catalog and recalculates how customers pay, even when nobody is using SOLU. If something fails it retries by itself; if it keeps failing, it shows here.")}</p>
        </div>
        <span className={`sig ${health.c}`}>{health.x}</span>
      </div>
      {sp.ok === "run" && <p className="card small ok-t" role="status">{t("Listo: se ejecutó una ronda ahora.", "Done: one round ran now.")}</p>}
      {sp.ok === "retry" && <p className="card small ok-t" role="status">{t("El trabajo vuelve a la cola; corre en la próxima ronda.", "The job is back in the queue; it runs in the next round.")}</p>}
      {sp.err === "run" && <p className="card small risk-t" role="alert">{t("La ronda falló. Revisa el detalle abajo.", "The round failed. See the details below.")}</p>}

      <section className="mk-sec">
        <h2>{t("1 · Respaldo opcional en GitHub", "1 · Optional GitHub backup")}</h2>
        <div className="card stack">
          <p className="small">{t("No es obligatorio: SOLU ya hace las rondas por sí mismo. Si quieres un segundo despertador por si el servidor se reinicia, crea esta clave y pégala en GitHub.", "Not required: SOLU already runs the rounds by itself. If you want a second alarm clock in case the server restarts, create this key and paste it in GitHub.")}</p>
          <p className="small">{key ? t(`Clave vigente terminada en …${key.hint}, creada por ${key.by} el ${i.day(key.at)}.`, `Current key ending in …${key.hint}, created by ${key.by} on ${i.day(key.at)}.`) : t("Sin clave (respaldo apagado).", "No key (backup off).")}</p>
          <KeyButton es={i.es} has={!!key} />
          <details>
            <summary className="small">{t("Cómo pegarla en GitHub (una sola vez)", "How to paste it in GitHub (once)")}</summary>
            <ol className="small">
              <li>{t("Abre github.com e inicia sesión. Entra al repositorio TomasRQ99/indsolusa-crm.", "Open github.com and sign in. Go to the TomasRQ99/indsolusa-crm repository.")}</li>
              <li>{t("Arriba, pulsa Settings (Configuración).", "At the top, click Settings.")}</li>
              <li>{t("A la izquierda: Secrets and variables → Actions.", "On the left: Secrets and variables → Actions.")}</li>
              <li>{t("Pulsa el botón verde New repository secret.", "Click the green New repository secret button.")}</li>
              <li>{t("En Name escribe SOLU_WORKER_KEY. En Secret pega la clave. Pulsa Add secret.", "In Name type SOLU_WORKER_KEY. In Secret paste the key. Click Add secret.")}</li>
              <li>{t("Para probar: pestaña Actions → SOLU worker → Run workflow. En un par de minutos esta página dirá «Funcionando».", "To test: Actions tab → SOLU worker → Run workflow. In a couple of minutes this page will say “Working”.")}</li>
            </ol>
          </details>
        </div>
      </section>

      <section className="mk-sec">
        <h2>{t("2 · Últimas rondas", "2 · Latest rounds")} <span className="src">{t(`${due} trabajos en cola`, `${due} jobs queued`)}</span></h2>
        <form action={runNow} style={{ marginBottom: 8 }}><button type="submit" className="secondary sm">{t("Ejecutar una ronda ahora", "Run one round now")}</button></form>
        <div className="card flush mk-scroll">
          <table>
            <thead><tr><th>{t("Cuándo", "When")}</th><th>{t("Origen", "Source")}</th><th className="n">{t("Hechos", "Done")}</th><th className="n">{t("Fallidos", "Failed")}</th><th>{t("Detalle", "Detail")}</th></tr></thead>
            <tbody>
              {runs.length === 0 && <tr><td colSpan={5} className="empty">{t("Aún no ha corrido ninguna ronda.", "No round has run yet.")}</td></tr>}
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>{ts(r.startedAt)}</td>
                  <td>{r.trigger === "SCHEDULE" ? "GitHub" : r.trigger === "INTERNAL" ? "SOLU" : r.trigger === "MANUAL" ? t("Manual", "Manual") : t("Local", "Local")}</td>
                  <td className="n">{r.done}</td>
                  <td className={`n ${r.failed ? "risk-t" : ""}`}>{r.failed}</td>
                  <td className="small">{!r.finishedAt ? <span className="sig attn">{t("en curso o interrumpida", "running or interrupted")}</span> : summaryText(r.summary)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mk-sec">
        <h2>{t("3 · Trabajos que no se pudieron hacer", "3 · Jobs that couldn't be done")}</h2>
        {failed.length === 0 ? <div className="card empty">{t("Ninguno.", "None.")}</div> : (
          <div className="card flush mk-scroll">
            <table>
              <thead><tr><th>{t("Trabajo", "Job")}</th><th>{t("Último intento", "Last attempt")}</th><th className="n">{t("Intentos", "Attempts")}</th><th>{t("Error", "Error")}</th><th /></tr></thead>
              <tbody>{failed.map((j) => (
                <tr key={j.id}>
                  <td>{label(j.kind)}</td>
                  <td>{j.doneAt ? ts(j.doneAt) : "—"}</td>
                  <td className="n">{j.attempts}</td>
                  <td className="small" style={{ maxWidth: 420, overflowWrap: "anywhere" }}>{j.lastError}</td>
                  <td><form action={retry.bind(null, j.id)}><button type="submit" className="secondary sm">{t("Reintentar", "Retry")}</button></form></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <p className="src">{t("Los correos y las respuestas también se leen cuando alguien abre Comunicación o Respuestas; el trabajador solo asegura que no dependa de eso.", "Emails and replies are also read when someone opens Communication or Replies; the worker just makes sure it doesn't depend on that.")}</p>
      </section>
    </>
  );
}
