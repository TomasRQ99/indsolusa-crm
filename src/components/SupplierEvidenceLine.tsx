import Link from "next/link";
import { replyLabel, type SupplierEvidence } from "@/lib/supplier-evidence";

type T = (es: string, en: string) => string;

/** One compact line of facts about a supplier, for places where someone is choosing one. No score. */
export function SupplierEvidenceLine({ ev, t, link = true }: { ev: SupplierEvidence | undefined; t: T; link?: boolean }) {
  if (!ev) return null;
  const bits: { text: string; tone?: "warn" | "ok" }[] = [];
  if (ev.partBuys) bits.push({ text: t(`nos vendió esta parte ${ev.partBuys} vez(es)`, `sold us this part ${ev.partBuys} time(s)`), tone: "ok" });
  if (ev.rts.measured) {
    const md = ev.rts.medianDelta;
    bits.push({ text: t(`despachó a tiempo ${ev.rts.onTime} de ${ev.rts.measured}`, `shipped on time ${ev.rts.onTime} of ${ev.rts.measured}`) + (md && md > 0 ? (ev.rts.measured >= 3 ? t(` (suele +${md} d)`, ` (usually +${md} d)`) : ev.rts.measured === 1 ? t(` (+${md} d)`, ` (+${md} d)`) : "") : ""), tone: ev.rts.onTime < ev.rts.measured / 2 ? "warn" : undefined });
  } else if (ev.pos.count) bits.push({ text: t(`${ev.pos.count} compra(s), sin despachos medidos`, `${ev.pos.count} purchase(s), no measured shipments`) });
  if (ev.rts.openLate) bits.push({ text: t(`${ev.rts.openLate} PO atrasada(s) ahora`, `${ev.rts.openLate} PO(s) late now`), tone: "warn" });
  if (ev.rfq.asked) {
    const done = ev.rfq.answered + ev.rfq.declined;
    const rl = replyLabel(ev.rfq.medianReplyHours, t);
    bits.push({ text: t(`respondió ${done} de ${ev.rfq.asked} solicitud(es)`, `answered ${done} of ${ev.rfq.asked} request(s)`) + (rl ? (ev.rfq.replyCount >= 3 ? t(` · suele tardar ${rl}`, ` · usually ${rl}`) : ev.rfq.replyCount === 1 ? t(` · tardó ${rl}`, ` · took ${rl}`) : "") : "") + (ev.rfq.declined ? t(` · ${ev.rfq.declined} no cotizó`, ` · ${ev.rfq.declined} declined`) : "") });
  }
  if (ev.recoveries.supplierCaused) bits.push({ text: t(`${ev.recoveries.supplierCaused} Recovery por causa del proveedor${ev.recoveries.open ? ` (${ev.recoveries.open} abierto)` : ""}`, `${ev.recoveries.supplierCaused} Recovery caused by the supplier${ev.recoveries.open ? ` (${ev.recoveries.open} open)` : ""}`), tone: "warn" });
  if (ev.docs.bankDifferent) bits.push({ text: t("un documento traía datos bancarios distintos al perfil", "a document had bank data different from the profile"), tone: "warn" });
  if (!bits.length) bits.push({ text: t("nuevo para nosotros: sin historia todavía", "new to us: no history yet") });
  return (
    <span className="sev">
      {bits.map((b, n) => <span key={n} className={b.tone ? `sev-${b.tone}` : undefined}>{n ? " · " : ""}{b.text}</span>)}
      {link && <> · <Link href={`/suppliers/${ev.supplierId}`}>{t("evidencia", "evidence")}</Link></>}
    </span>
  );
}
