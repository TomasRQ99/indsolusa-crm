import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canFinance } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { EVENT_NAMES } from "@/lib/domain-events";

// Módulo 14 §10 · Eventos: what happened, in business words. Derived from the change history, so nothing is
// missing because a screen forgot to say it. Read-only.

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ tipo?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  if (!canFinance(user)) return <div className="note risk">{t("Esta vista es para Administración, Finanzas, Dirección y Gerencia.", "This view is for Administration, Finance, Direction and Management.")}</div>;
  const sp = await searchParams;
  const name = sp.tipo && EVENT_NAMES[sp.tipo] ? sp.tipo : null;
  const [rows, counts] = await Promise.all([
    db.domainEvent.findMany({ where: name ? { name } : {}, orderBy: { occurredAt: "desc" }, take: 150 }),
    db.domainEvent.groupBy({ by: ["name"], _count: { _all: true }, where: { occurredAt: { gte: new Date(Date.now() - 30 * 864e5) } } }),
  ]);
  const n = new Map(counts.map((c) => [c.name, c._count._all]));
  const show = (payload: unknown) => Object.entries((payload ?? {}) as Record<string, unknown>).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${k}: ${String(v).slice(0, 60)}`).join(" · ");

  return (
    <>
      <div className="ph"><div><h1>{t("Eventos", "Events")}</h1><p>{t("Lo que pasó, con nombre de negocio: sirve para conectar SOLU con contabilidad, bancos u otros sistemas sin que dependan de sus pantallas.", "What happened, in business words: it lets SOLU connect to accounting, banks or other systems without them depending on its screens.")}</p></div></div>
      <section className="card"><b>{t("ÚLTIMOS 30 DÍAS, POR TIPO", "LAST 30 DAYS, BY KIND")}</b>
        <p className="small" style={{ lineHeight: 2 }}>{Object.entries(EVENT_NAMES).map(([k, x]) => <Link key={k} href={`/administracion/eventos?tipo=${k}`} className={name === k ? "sig ok" : undefined} style={{ marginRight: 14, whiteSpace: "nowrap" }}>{t(x.es, x.en)} <span className="mono muted">{n.get(k) ?? 0}</span></Link>)}{name ? <Link href="/administracion/eventos">{t("ver todos", "see all")}</Link> : null}</p>
      </section>
      <section className="card"><b>{name ? t(EVENT_NAMES[name].es, EVENT_NAMES[name].en).toUpperCase() : t("LO MÁS RECIENTE", "MOST RECENT")}</b>
        {rows.length === 0 ? <p className="small muted">{t("Sin eventos todavía. Aparecen solos cuando alguien registra, aprueba o concilia algo.", "No events yet. They appear by themselves when someone records, approves or reconciles something.")}</p> : (
          <div className="tscroll"><table>
            <thead><tr><th>{t("Cuándo", "When")}</th><th>{t("Evento", "Event")}</th><th>{t("Quién", "Who")}</th><th>{t("Datos", "Data")}</th></tr></thead>
            <tbody>{rows.map((e) => <tr key={e.id}><td className="small" style={{ whiteSpace: "nowrap" }}>{i.date(e.occurredAt)}</td><td>{EVENT_NAMES[e.name] ? t(EVENT_NAMES[e.name].es, EVENT_NAMES[e.name].en) : e.name}<span className="src block mono">{e.name}</span></td><td className="small">{e.actorName}</td><td className="small" style={{ wordBreak: "break-word" }}>{show(e.payload)}<span className="src block mono">{e.entity} {e.entityId}</span></td></tr>)}</tbody>
          </table></div>
        )}
        <p className="src">{t("Los eventos empiezan a guardarse desde que se instaló este módulo: lo anterior está en el Historial de cambios.", "Events are kept from the day this module was installed: what came before is in the Change history.")} <Link href="/administracion/historial">{t("Historial de cambios", "Change history")}</Link></p>
      </section>
    </>
  );
}
