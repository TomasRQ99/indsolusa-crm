import Link from "next/link";
import type { I18n } from "@/lib/i18n";
import type { Figure, Tile } from "@/lib/gerencia-home";
import type { NeededItem } from "@/lib/gerencia-store";
import { AREAS } from "@/lib/gerencia-rules";

// Módulo 15 · pieces shared by the Gerencia screens.

type Txt = { es: string; en: string };
export const fmtFig = (i: I18n, unit: "usd" | "n" | "pct" | "days", v: number | null) => (v == null ? "—" : unit === "usd" ? i.money(v) : unit === "pct" ? i.pct(v) : unit === "days" ? `${i.n(v)} d` : i.n(v));

/** One block of the pulse: a question, and two or three figures that each open their evidence. */
/** `plain`: figures without links, for a reader who may not open the modules behind them (Junta). */
export function TileCard({ tile, i, plain = false }: { tile: Tile; i: I18n; plain?: boolean }) {
  const t = (x: Txt) => i.t(x.es, x.en);
  return (
    <section className="gm-tile" id={`t-${tile.key}`}>
      <div className="gm-tile-h"><b>{t(tile.title)}</b>{plain ? null : <Link href={tile.href} className="small">{i.t("abrir", "open")}</Link>}</div>
      <p className="q">{t(tile.question)}</p>
      {tile.figures.map((f, k) => <FigureRow key={k} f={f} i={i} plain={plain} />)}
    </section>
  );
}
function FigureRow({ f, i, plain }: { f: Figure; i: I18n; plain: boolean }) {
  const t = (x: Txt) => i.t(x.es, x.en);
  const d = f.prev != null ? Math.round((f.value - f.prev) * 100) / 100 : null;
  return (
    <div className="gm-fig">
      <span>{plain ? t(f.label) : <Link href={f.href}>{t(f.label)}</Link>}{f.note ? <span className="src block">{t(f.note)}</span> : null}</span>
      <span><b className={f.tone ?? ""}>{fmtFig(i, f.unit, f.value)}</b>
        <span className="src block">{f.state ? i.t("hoy", "today") : d == null ? i.t("sin mes anterior", "no previous month") : d === 0 ? i.t("igual al mes anterior", "same as last month") : `${d > 0 ? "+" : "−"}${fmtFig(i, f.unit, Math.abs(d)).replace("USD ", "")} ${i.t("vs. mes anterior", "vs last month")}`}</span></span>
    </div>
  );
}

const SOURCE: Record<NeededItem["source"], Txt> = {
  REQUEST: { es: "Pedida a Gerencia", en: "Asked of Management" }, PURCHASE: { es: "Compra", en: "Purchase" }, INTERNAL: { es: "Compra interna", en: "Internal purchase" }, ESAGARA: { es: "Eságara baja", en: "Low Eságara" },
  CREDIT_REQUEST: { es: "Crédito", en: "Credit" }, CREDIT_LIMIT: { es: "Cupo superado", en: "Limit exceeded" }, POLICY: { es: "Política", en: "Policy" }, PAYMENT: { es: "Pago a proveedor", en: "Supplier payment" },
};
/** A matter waiting for a decision, with everything §2C asks for: question, why now, impact, options, facts apart
 *  from assumptions, recommendation, window and who takes it from there. */
export function NeededCard({ x, i, now }: { x: NeededItem; i: I18n; now: Date }) {
  const t = (v: Txt) => i.t(v.es, v.en);
  const late = !!x.deadline && x.deadline < now;
  return (
    <article className={`gm-dec${late ? " late" : ""}`} id={x.key}>
      <div className="gm-dec-h">
        <span className="q">{t(x.question)}</span>
        <span className="sig wait">{t(SOURCE[x.source])}</span>
        <span className="sig info">{t(AREAS[x.area] ?? { es: x.area, en: x.area })}</span>
      </div>
      <dl className="qv-dl">
        <dt>{i.t("Por qué ahora", "Why now")}</dt><dd>{t(x.whyNow)}</dd>
        <dt>{i.t("Cuánto pesa", "Impact")}</dt><dd>{x.impact ?? <span className="muted">{i.t("Sin valor en dinero registrado", "No money value recorded")}</span>}</dd>
        <dt>{i.t("Opciones", "Options")}</dt><dd>{x.options.length ? x.options.map((o, k) => <span key={k}>{k ? " · " : ""}{t(o)}</span>) : "—"}</dd>
        <dt>{i.t("Hechos", "Facts")}</dt><dd className="gm-pre">{x.facts || "—"}</dd>
        <dt>{i.t("Supuestos", "Assumptions")}</dt><dd className="gm-pre">{x.assumptions || <span className="muted">{x.requested ? i.t("Quien la pidió no escribió supuestos", "The requester wrote no assumptions") : i.t("Ninguno: todo lo anterior viene del registro", "None: everything above comes from the record")}</span>}</dd>
        {x.recommendation && <><dt>{i.t("Recomendación", "Recommendation")}</dt><dd className="gm-pre">{x.recommendation}{x.askedBy ? <span className="src block">{i.t("de", "from")} {x.askedBy}</span> : null}</dd></>}
        <dt>{i.t("Ventana", "Window")}</dt><dd>{x.deadline ? <>{i.date(x.deadline)}{late && <b className="risk-t"> · {i.t("ya pasó", "already past")}</b>}</> : <span className="muted">{i.t("Sin fecha límite", "No deadline")}</span>}</dd>
        <dt>{i.t("Quién sigue después", "Owner afterwards")}</dt><dd>{x.ownerAfter ?? <span className="muted">{i.t("Se define al decidir", "Set when deciding")}</span>}</dd>
      </dl>
      <div className="gm-dec-f"><Link className="btn secondary sm" href={x.href}>{x.source === "REQUEST" ? i.t("Decidir", "Decide") : i.t("Abrir y decidir donde vive", "Open and decide where it lives")}</Link>{x.askedBy && !x.recommendation ? <span className="src">{i.t("Pidió", "Asked by")}: {x.askedBy}</span> : null}
        {/* An approval is decided in its own module and leaves no management record: this opens one, already filled in. */}
        {x.source !== "REQUEST" && <Link className="small" href={`/gerencia/decisiones?${new URLSearchParams({ pregunta: t(x.question), href: x.href, label: t(SOURCE[x.source]), area: x.area })}#pedir`}>{i.t("Dejar también un registro de decisión", "Also keep a decision record")}</Link>}</div>
    </article>
  );
}

export function Notes({ sp, ok, err }: { sp: { ok?: string; err?: string }; ok: Record<string, string>; err: Record<string, string> }) {
  return (
    <>
      {sp.ok && ok[sp.ok] && <div className="note okn">{ok[sp.ok]}</div>}
      {sp.err && err[sp.err] && <div className="note risk">{err[sp.err]}</div>}
    </>
  );
}
