import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";

export default async function ProjectsPage() {
  const user = await requireUser();
  const { t } = makeI18n(user.lang);
  return (
    <>
      <div className="ph">
        <div>
          <h1>{t("Proyectos", "Projects")}</h1>
          <p>{t("Aquí vivirán los proyectos que agrupan varias Necesidades de un mismo cliente u obra.", "Projects that group several Necessities for the same customer or site will live here.")}</p>
        </div>
      </div>
      <div className="card empty">
        <b>{t("Todavía no hay proyectos", "No projects yet")}</b>
        <p>{t("Este módulo está en diseño. Mientras tanto, cada pedido se sigue desde su Necesidad en ", "This module is being designed. Meanwhile, each order is followed from its Necessity in ")}<Link href="/deals">{t("Comercial", "Commercial")}</Link>.</p>
      </div>
    </>
  );
}
