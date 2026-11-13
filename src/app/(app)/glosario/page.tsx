import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { GLOSSARY, GLOSS_AREAS, type GlossArea } from "@/lib/glossary";
import { GlossarySwitch } from "@/components/shell/GlossaryLayer";

// The whole glossary on one page. The same list feeds the bubbles on every screen (GlossaryLayer).
export default async function GlosarioPage() {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const L = (x: { es: string; en: string }) => (i.es ? x.es : x.en);
  const areas = Object.keys(GLOSS_AREAS) as GlossArea[];
  const sorted = [...GLOSSARY].sort((a, b) => L(a.name).localeCompare(L(b.name), i.es ? "es" : "en"));

  return (
    <div data-noglossary>
      <div className="ph">
        <div>
          <div className="crumb">SOLU</div>
          <h1>{t("Glosario", "Glossary")}</h1>
          <p>{t("Qué significa cada término de SOLU y qué significa en cada pantalla donde cambia. En las pantallas, cada término lleva un globo «i»: haz clic en él para ver esta misma explicación sin salir de donde estás.", "What each SOLU term means, and what it means on each screen where that changes. On screens every term carries an \"i\" bubble: click it to see this same explanation without leaving where you are.")}</p>
        </div>
        <div className="grow" />
        <GlossarySwitch lang={i.es ? "es" : "en"} />
      </div>

      <section className="card" data-zone="calm">
        <b>{t("TODOS LOS TÉRMINOS", "ALL TERMS")}</b>
        <p className="gl-index">{sorted.map((x) => <a key={x.id} href={`#${x.id}`}>{L(x.name)}</a>)}</p>
      </section>

      {areas.map((a) => {
        const list = sorted.filter((x) => x.area === a);
        if (!list.length) return null;
        return (
          <section className="card" key={a} data-zone="calm">
            <b>{L(GLOSS_AREAS[a]).toUpperCase()}</b>
            <dl className="gl-list">
              {list.map((x) => (
                <div key={x.id} id={x.id}>
                  <dt>{L(x.name)}</dt>
                  <dd>
                    <p>{L(x.def)}</p>
                    {x.ctx?.map((c, k) => <p key={k} className="gl-ctx"><span>{L(c.where)}</span>{L(c)}</p>)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        );
      })}
    </div>
  );
}
