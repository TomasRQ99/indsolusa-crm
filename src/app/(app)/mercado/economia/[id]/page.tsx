import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { companyEconomics } from "@/lib/econ";
import { EconBlock } from "../../EconBlock";
import { addAsProspect } from "../actions";

// One company in the economic datasets: what the evidence shows, before it's a customer or prospect.
export default async function EconomicCompany({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const d = await companyEconomics({ companyId: id });
  if (!d) notFound();
  const i = makeI18n(user.lang);
  const { t } = i;
  const c = d.c;
  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/mercado/economia">{t("Mercado · Explorador económico", "Market · Economic explorer")}</Link></div>
          <h1>{c.name}</h1>
          <p className="small">NIT {c.nit}{c.sector ? ` · ${c.sector}` : ""}{c.ciiu ? ` · CIIU ${c.ciiu}` : ""}{c.city || c.department ? ` · ${[c.city, c.department].filter(Boolean).join(", ")}` : ""}</p>
          {c.otherNames.length > 0 && <span className="src block">{t("Antes", "Previously")}: {c.otherNames.join(" · ")}</span>}
        </div>
        {c.account ? <Link href={`/mercado/empresas/${c.account.id}`} className="btn secondary">{t("Ver cómo funciona esta empresa", "See how this company works")}</Link> : (
          <form action={addAsProspect.bind(null, c.id)}><button type="submit">{t("Agregar como prospecto", "Add as a prospect")}</button></form>
        )}
      </div>
      <EconBlock d={d} t={t} lang={user.lang} day={i.day} />
    </>
  );
}
