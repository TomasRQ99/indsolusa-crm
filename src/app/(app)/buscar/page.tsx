import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { universalSearch, type Hit } from "@/lib/search";
import { searchGuides } from "@/lib/guide";
import { GuideStart } from "@/components/shell/GuideStart";

// One search box for customers (name or NIT), Journeys (code, title, customer PO), invoices,
// supplier POs, delivery notes and suppliers. Exactly one result opens it directly.
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const { t } = makeI18n(user.lang);
  const q = ((await searchParams).q ?? "").trim();
  const hits = await universalSearch(q);
  // "hacer factura" is a request for help, not a record: offer the on-screen guides first.
  const guides = user.guideOn && q.length >= 3 ? searchGuides(q, user) : [];
  if (hits.length === 1 && guides.length === 0) redirect(hits[0].href);

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
      {guides.length > 0 && (
        <section className="card" data-zone="flow">
          <b>{t("TE GUÍO EN PANTALLA", "I'LL GUIDE YOU ON SCREEN")}</b>
          <p className="src">{t("Los pasos de la Guía de campo, sobre la pantalla donde se hacen.", "The steps of the field guide, on the screen where they are done.")}</p>
          <div className="items">
            {guides.map((g) => (
              <div className="item" key={g.id}>
                <span className="t">{g.title}</span>
                <span className="a">
                  {g.routeLen > 0 && <GuideStart id={g.id} route className="sm">{t(`Desde el inicio · ${g.routeLen} etapas`, `From the start · ${g.routeLen} stages`)}</GuideStart>}
                  <GuideStart id={g.id} route={false} className={g.routeLen > 0 ? "sm secondary" : "sm"}>{g.routeLen > 0 ? t("Solo esta parte", "Only this part") : t("Guíame", "Guide me")}</GuideStart>
                </span>
                <span className="d">{g.why} <span className="src">{g.path}</span></span>
              </div>
            ))}
          </div>
        </section>
      )}
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
