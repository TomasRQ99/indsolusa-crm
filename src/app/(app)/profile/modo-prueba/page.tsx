import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { canManageAll } from "@/lib/permissions";
import { withTestData } from "@/lib/test-mode";
import { saveTestMarks } from "../actions";

// Mi perfil → Modo prueba → which customers and suppliers are test information. This screen always shows
// everything, whatever the person chose in Modo prueba, so a mark can be taken off again.
export default async function TestMarksPage({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const { ok } = await searchParams;
  const user = await requireUser();
  if (!canManageAll(user)) redirect("/profile");
  const i = makeI18n(user.lang);
  const { t } = i;
  const [accounts, suppliers] = await withTestData(() => Promise.all([
    db.account.findMany({ where: { internal: false }, orderBy: { name: "asc" }, select: { id: true, name: true, isDemo: true, isTest: true, createdAt: true, _count: { select: { deals: true } } } }),
    db.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, isDemo: true, isTest: true, createdAt: true, _count: { select: { pos: true } } } }),
  ]));
  const mine = <T extends { isDemo: boolean }>(rows: T[]) => rows.filter((r) => !r.isDemo);
  const samples = accounts.filter((a) => a.isDemo).length + suppliers.filter((s) => s.isDemo).length;
  const marked = mine(accounts).filter((a) => a.isTest).length + mine(suppliers).filter((s) => s.isTest).length;

  const table = (title: string, field: "account" | "supplier", rows: { id: string; name: string; isTest: boolean; createdAt: Date; n: number }[], nLabel: string, href: (id: string) => string) => (
    <div className="card">
      <h2>{title}</h2>
      {rows.length === 0 ? <p className="small muted">{t("Todavía no hay ninguno.", "There are none yet.")}</p> : (
        <table>
          <thead><tr><th>{t("De prueba", "Test")}</th><th>{t("Nombre", "Name")}</th><th>{t("Registrado", "Registered")}</th><th className="num">{nLabel}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><input type="hidden" name={`${field}Shown`} value={r.id} /><input type="checkbox" name={field} value={r.id} defaultChecked={r.isTest} aria-label={t(`${r.name} es de prueba`, `${r.name} is test`)} /></td>
                <td><a href={href(r.id)}>{r.name}</a></td>
                <td className="small muted">{i.date(r.createdAt)}</td>
                <td className="num">{r.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  return (
    <>
      <div className="ph"><div><div className="crumb"><a href="/profile#modo-prueba">{t("Mi perfil", "My profile")}</a></div><h1>{t("Información de prueba", "Test information")}</h1>
        <p>{t("Marca los clientes y proveedores que se crearon para probar. Quien desactive el modo prueba en su perfil deja de verlos, con sus Necesidades, cotizaciones, pedidos, facturas, pagos y tareas. No se borra nada, y la marca se puede quitar aquí mismo.", "Tick the customers and suppliers that were created for testing. Whoever turns test mode off in their profile stops seeing them, with their Needs, quotes, orders, invoices, payments and tasks. Nothing is deleted, and the mark can be removed right here.")}</p></div></div>
      {ok && <p className="small" style={{ marginBottom: 12 }}><span className="sig ok">{t("Guardado", "Saved")}</span> {t(`${marked} marcados como prueba.`, `${marked} marked as test.`)}</p>}
      <form action={saveTestMarks}>
        <div className="grid cols-2">
          {table(t("Clientes", "Customers"), "account", mine(accounts).map((a) => ({ ...a, n: a._count.deals })), t("Necesidades", "Needs"), (id) => `/accounts/${id}`)}
          {table(t("Proveedores", "Suppliers"), "supplier", mine(suppliers).map((s) => ({ ...s, n: s._count.pos })), t("Órdenes de compra", "Purchase orders"), (id) => `/suppliers/${id}`)}
        </div>
        <p style={{ marginTop: 14 }}><button type="submit">{t("Guardar información de prueba", "Save test information")}</button></p>
      </form>
      <p className="src" style={{ marginTop: 10 }}>
        {samples > 0
          ? t(`Los ${samples} clientes y proveedores de ejemplo de SOLU, que dicen «(ejemplo)», siempre cuentan como prueba y no aparecen en esta lista.`, `SOLU's ${samples} sample customers and suppliers, marked “(ejemplo)”, always count as test and are not on this list.`)
          : t("Los datos de ejemplo de SOLU no están cargados.", "SOLU's sample data is not loaded.")}{" "}
        {t("Esta lista vale para todo el equipo; ver o no la información de prueba lo decide cada persona en su perfil.", "This list applies to the whole team; seeing the test information or not is each person's choice in their profile.")}
      </p>
    </>
  );
}
