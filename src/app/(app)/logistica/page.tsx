import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { makeI18n } from "@/lib/i18n";
import { buildShipment, fwdLabel, shipInclude, type FwdKey } from "@/lib/logistics";

// One row per shipment, never one per carrier scan. Grouped by what the result needs from us.
const ORDER: FwdKey[] = ["RISK", "DISPUTED", "HOLD", "PROTECTED", "UNKNOWN", "RECEIVED"];

export default async function ShipmentsPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const since = new Date(Date.now() - 30 * 864e5);
  const ships = await db.shipment.findMany({
    where: sp.all ? {} : { OR: [{ receipt: { not: "CONFIRMED" } }, { receivedAt: { gte: since } }] },
    include: shipInclude,
    orderBy: { createdAt: "desc" },
  });
  const rows = ships.map((s) => ({ s, B: buildShipment(s, i) }));
  const key = (B: ReturnType<typeof buildShipment>): FwdKey => B.fwd.key;
  const scans = rows.reduce((a, r) => a + r.B.scans.length, 0);
  const needs = rows.filter((r) => ["RISK", "DISPUTED", "HOLD"].includes(key(r.B))).length;
  const dm = (x: Date | null | undefined) => (x ? i.day(x) : "—");

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb">{t("Operaciones", "Operations")}</div>
          <h1>{t("Envíos", "Shipments")}</h1>
          <p>{t(`${rows.length} envíos · ${scans} lecturas normales del transportista resumidas · ${needs} necesitan una decisión.`, `${rows.length} shipments · ${scans} normal carrier checkpoints summarised · ${needs} need a decision.`)}</p>
        </div>
      </div>
      <section className="sum">
        {ORDER.filter((k) => k !== "UNKNOWN").map((k) => <div key={k}><span className="k">{fwdLabel(i, k).text}</span><span className="v">{rows.filter((r) => key(r.B) === k).length}</span></div>)}
      </section>
      <div className="card flush">
        <table>
          <thead><tr><th>{t("Envío", "Shipment")}</th><th>{t("Ahora", "Now")}</th><th className="n">{t("ETA transp.", "Carrier ETA")}</th><th className="n">{t("SOLU espera", "SOLU expected")}</th><th className="n">{t("Promesa", "Promise")}</th><th>{t("Hacia adelante", "Forward")}</th><th /></tr></thead>
          <tbody>
            {ORDER.map((k) => {
              const g = rows.filter((r) => key(r.B) === k);
              if (!g.length) return null;
              return [
                <tr className="grpr" key={k}><td colSpan={7}>{fwdLabel(i, k).text} <span>· {g.length}</span></td></tr>,
                ...g.map(({ s, B }) => {
                  const l = fwdLabel(i, B.fwd.key);
                  return (
                    <tr key={s.id}>
                      <td><b>{s.carrierName}{s.tracking ? ` · ${s.tracking}` : ""}</b><span className="src">{s.code} · <Link href={`/deals/${s.deal.id}`}>{s.deal.code}</Link> · {s.deal.account.name}</span></td>
                      <td className="small">{B.nowState.label}{B.nowState.where && <span className="src">{B.nowState.where}</span>}</td>
                      <td className="n mono">{dm(s.deliveredAt ?? s.carrierEta)}</td>
                      <td className="n mono">{B.exp.date ? `≈ ${dm(B.exp.date)}` : "—"}</td>
                      <td className="n mono">{dm(s.deal.promisedDate)}</td>
                      <td><span className={`sig ${l.cls}`}>{l.text}</span></td>
                      <td className="n"><Link className="btn secondary sm" href={`/logistica/${s.id}`}>{t("Abrir", "Open")}</Link></td>
                    </tr>
                  );
                }),
              ];
            })}
            {rows.length === 0 && <tr><td colSpan={7} className="empty"><b>{t("No hay envíos", "No shipments")}</b>{t("Se registran desde la pestaña Ejecución del Journey.", "They're recorded from the Journey's Execute tab.")}</td></tr>}
          </tbody>
        </table>
      </div>
      {!sp.all && <p className="src" style={{ marginTop: 8 }}><Link href="/logistica?all=1">{t("Ver también los recibidos hace más de 30 días", "Also show those received over 30 days ago")}</Link></p>}
    </>
  );
}
