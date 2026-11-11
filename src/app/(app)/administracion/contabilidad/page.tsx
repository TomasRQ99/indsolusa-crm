import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canExportReports, canFinance } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { dayInput, today } from "@/lib/domain";
import { EXPORT_KINDS } from "@/lib/accounting-export";

// Módulo 14 §2J · Contabilidad: files of operational facts for the accounting system, and the state of the bridge
// for customer invoices. SOLU does not replace the accounting software and claims no tax certainty (§1.10).

export default async function AccountingPage() {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  if (!canFinance(user)) return <div className="note risk">{t("Esta vista es para Administración, Finanzas, Dirección y Gerencia.", "This view is for Administration, Finance, Direction and Management.")}</div>;
  const T = today();
  const m0 = new Date(Date.UTC(T.getUTCFullYear(), T.getUTCMonth() - 1, 1)), m1 = new Date(Date.UTC(T.getUTCFullYear(), T.getUTCMonth(), 0));
  const [sync, log] = await Promise.all([
    db.invoice.groupBy({ by: ["syncState"], _count: { _all: true } }),
    db.accountingExport.findMany({ orderBy: { createdAt: "desc" }, take: 15 }),
  ]);
  const count = (s: string) => sync.find((x) => x.syncState === s)?._count._all ?? 0;
  const can = canExportReports(user);

  return (
    <>
      <div className="ph"><div><h1>{t("Contabilidad", "Accounting")}</h1><p>{t("SOLU entrega hechos operativos confiables al sistema contable; no lo reemplaza. Sacar un archivo no cambia nada en SOLU.", "SOLU hands reliable operational facts to the accounting system; it doesn't replace it. Taking a file out changes nothing in SOLU.")}</p></div></div>

      <section className="card" id="archivos"><b>{t("ARCHIVOS PARA CONTABILIDAD", "FILES FOR ACCOUNTING")}</b>
        {!can ? <p className="small muted">{t("Los archivos los descargan Gerencia y Finanzas.", "Files are downloaded by Management and Finance.")}</p> : Object.entries(EXPORT_KINDS).map(([k, x]) => (
          <form key={k} action="/administracion/contabilidad/csv" method="get" className="qa-row" style={{ alignItems: "flex-end", marginTop: 8 }}>
            <input type="hidden" name="kind" value={k} />
            <div style={{ flex: 3 }}><b className="small">{t(x.es, x.en)}</b><span className="src block">{t(x.noteEs, x.noteEn)}</span></div>
            <label>{t("Desde", "From")}<input type="date" name="from" required defaultValue={dayInput(m0)} /></label>
            <label>{t("Hasta", "To")}<input type="date" name="to" required defaultValue={dayInput(m1)} /></label>
            <button type="submit" className="secondary" style={{ flex: "0 0 auto" }}>{t("Descargar", "Download")}</button>
          </form>
        ))}
        <p className="src">{t("Archivos CSV que abre Excel. Máximo un año por archivo. Impuestos y retenciones van como se registraron: SOLU no los calcula ni garantiza su tratamiento tributario.", "CSV files that open in Excel. One year at most per file. Taxes and withholdings are as recorded: SOLU doesn't compute them or vouch for their tax treatment.")}</p>
      </section>

      <section className="card" id="puente"><b>{t("FACTURAS A CLIENTES EN EL SISTEMA CONTABLE", "CUSTOMER INVOICES IN THE ACCOUNTING SYSTEM")}</b>
        <dl className="qv-dl">
          <dt>{t("Sin enviar", "Not sent")}</dt><dd className="mono">{count("NOT_SENT")}</dd>
          <dt>{t("Enviadas, sin confirmar", "Sent, not confirmed")}</dt><dd className="mono">{count("SENT")}</dd>
          <dt>{t("Confirmadas con su ID contable", "Confirmed with their accounting ID")}</dt><dd className="mono">{count("CONFIRMED")}</dd>
          <dt>{t("Inciertas", "Uncertain")}</dt><dd className={`mono ${count("UNCERTAIN") ? "risk-t" : ""}`}>{count("UNCERTAIN")}</dd>
        </dl>
        <p className="src">{t("El estado se marca a mano en cada factura (pestaña de facturación del Journey): todavía no hay conexión automática con un sistema contable, bancos, nómina ni la DIAN.", "The state is set by hand on each invoice (the Journey's billing tab): there is no automatic connection yet to an accounting system, banks, payroll or DIAN.")} <Link href="/administracion/eventos">{t("Eventos para integrar", "Events to integrate")}</Link></p>
      </section>

      <section className="card" id="registro"><b>{t("ARCHIVOS DESCARGADOS", "FILES DOWNLOADED")}</b>
        {log.length === 0 ? <p className="small muted">{t("Ninguno todavía.", "None yet.")}</p> : <ul className="plain small">{log.map((e) => <li key={e.id}>{i.date(e.createdAt)} · {e.byName} · {EXPORT_KINDS[e.kind] ? t(EXPORT_KINDS[e.kind].es, EXPORT_KINDS[e.kind].en) : e.kind} · {i.day(e.periodFrom)} – {i.day(e.periodTo)} · {t(`${e.rows} filas`, `${e.rows} rows`)}</li>)}</ul>}
      </section>
    </>
  );
}
