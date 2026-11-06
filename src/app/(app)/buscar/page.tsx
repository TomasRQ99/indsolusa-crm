import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { universalSearch, type Hit } from "@/lib/search";

// One search box for customers (name or NIT), Journeys (code, title, customer PO), invoices,
// supplier POs, delivery notes and suppliers. Exactly one result opens it directly.
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const { t } = makeI18n(user.lang);
  const q = ((await searchParams).q ?? "").trim();
  const hits = await universalSearch(q);
  if (hits.length === 1) redirect(hits[0].href);

  const groups: { kind: Hit["kind"]; title: string; mono?: boolean }[] = [
    { kind: "journey", title: "Journeys" },
    { kind: "customer", title: t("Clientes", "Customers") },
    { kind: "invoice", title: t("Facturas", "Invoices"), mono: true },
    { kind: "spo", title: "Supplier PO", mono: true },
    { kind: "delivery", title: t("Remisiones", "Delivery notes"), mono: true },
    { kind: "supplier", title: t("Proveedores", "Suppliers") },
    { kind: "part", title: t("Repuestos", "Parts"), mono: true },
  ];

  return (
    <>
      <div className="ph">
        <div>
          <h1>{t("Buscar", "Search")}</h1>
          <p>{q ? t(`${hits.length} resultados para "${q}"`, `${hits.length} results for "${q}"`) : t("Escribe o pega en la barra superior: pedido, OC, factura, cliente, NIT o proveedor.", "Type or paste in the top bar: order, PO, invoice, customer, tax ID or supplier.")}</p>
        </div>
      </div>
      {q && (
        <div className="grid cols-2">
          {groups.map((g) => {
            const list = hits.filter((h) => h.kind === g.kind);
            if (!list.length) return null;
            return (
              <div className="card" key={g.kind}>
                <h2>{g.title}</h2>
                <ul className="timeline">
                  {list.map((h) => (
                    <li key={h.id}>
                      <Link href={h.href} className={g.mono ? "mono" : undefined}>{h.label}</Link>
                      {h.sub && <span className="src block">{h.sub}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {hits.length === 0 && <div className="card empty"><b>{t("Sin resultados", "No results")}</b></div>}
          <div className="card">
            <p className="src">{t("¿Buscas un repuesto por descripción, con errores de escritura o en inglés?", "Looking for a part by description, with typos or in English?")} <Link href={`/localizar?q=${encodeURIComponent(q)}`}>{t(`Buscar “${q}” en Localizar repuestos`, `Search “${q}” in Find parts`)}</Link></p>
          </div>
        </div>
      )}
    </>
  );
}
