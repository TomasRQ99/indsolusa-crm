import Link from "next/link";
import { CTX_GROUPS, type CtxGroup, type NeedContext } from "@/lib/need-handoff";

// M6 §12.4: Comercial enters seeing what is happening, desired result, impact, person, how they decide,
// what they value, how they buy, what we know, what's missing and the next useful move. Frozen at confirmation.
const ORDER: CtxGroup[] = ["WHAT", "PERSON", "IMPACT", "DECIDE", "VALUE", "BUY", "HURT", "OPERATE", "TECH", "SIGNAL", "MISSING", "NEXT"];

export default function MarketContext({ ctx, t, day }: { ctx: NeedContext | null; t: (es: string, en: string) => string; day: (d: Date) => string }) {
  if (!ctx?.items?.length) return null;
  const groups = ORDER.filter((g) => ctx.items.some((x) => x.group === g));
  return (
    <section className="jblock">
      <div className="jbh"><b>{t("LO QUE MERCADO YA SABÍA", "WHAT MERCADO ALREADY KNEW")}</b><span className="grow" />
        <span className="src">{ctx.explorationId ? <Link href={`/mercado/exploraciones/${ctx.explorationId}`}>{ctx.explorationName ?? t("Exploración", "Exploration")}</Link> : t("Mercado", "Market")} · {t("al confirmar la necesidad", "when the need was confirmed")}, {day(new Date(ctx.at))}</span>
      </div>
      <dl className="filedl">
        {groups.map((g) => (
          <div key={g} style={{ display: "contents" }}>
            <dt>{t(CTX_GROUPS[g].es, CTX_GROUPS[g].en)}</dt>
            <dd>{ctx.items.filter((x) => x.group === g).map((x, k) => <div key={k}>{x.text}{x.confidence === "INFERRED" ? <span className="sig attn"> {t("inferido", "inferred")}</span> : null}</div>)}</dd>
          </div>
        ))}
      </dl>
      <p className="src">{t("Cada dato conserva su fuente. Si algo cambió, actualízalo en Mercado: esta copia muestra lo que se sabía al empezar.", "Each fact keeps its source. If something changed, update it in Mercado: this copy shows what was known at the start.")}</p>
    </section>
  );
}
