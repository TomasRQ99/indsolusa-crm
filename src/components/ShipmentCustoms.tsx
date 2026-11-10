import { db } from "@/lib/db";
import { dayInput } from "@/lib/domain";
import { makeI18n } from "@/lib/i18n";
import { CLASSIFICATION_RULE, importReadiness } from "@/lib/freight-audit";
import { saveCustomsCase } from "@/app/(app)/logistica/auditoria-actions";

// Operaciones O7 · customs case of an international shipment (module 11 §32–33): what is still needed to import,
// the classification with where it comes from, duties expected vs actual, holds and release.

type Doc = { key: string; ready: boolean };

export async function ShipmentCustoms({ shipmentId, lang, editable }: { shipmentId: string; lang: "ES" | "EN"; editable: boolean }) {
  const i = makeI18n(lang);
  const { t } = i;
  const s = await db.shipment.findUnique({ where: { id: shipmentId }, select: { id: true, international: true, docs: true, customsCase: true } });
  if (!s || !s.international) return null;
  const c = s.customsCase;
  const docs = (Array.isArray(s.docs) ? s.docs : []) as unknown as Doc[];
  const has = (k: string) => docs.some((d) => d.key === k && d.ready);
  const needs = importReadiness({ international: true, hasInvoice: has("ci"), hasPackingList: has("pl"), hasTransportDoc: has("awb"), origin: c?.origin ?? null, classification: c?.classification ?? null, classificationStatus: c?.classificationStatus ?? "PENDING", consignee: c?.consignee ?? null, broker: c?.broker ?? null, declaredValue: c?.declaredValue != null ? Number(c.declaredValue) : null });
  const cls = { PENDING: { tone: "wait", txt: t("Sin clasificar", "Not classified") }, HISTORICAL: { tone: "attn", txt: t("Histórica: usada antes, sin validar hoy", "Historical: used before, not validated today") }, VALIDATED_CURRENT: { tone: "ok", txt: t("Validada con la norma vigente", "Validated against current rules") } }[c?.classificationStatus ?? "PENDING"] ?? { tone: "wait", txt: "—" };
  const usd = (x: unknown) => (x == null ? "—" : `USD ${i.n2(Number(x))}`);
  const dutyDiff = c?.dutiesExpected != null && c?.dutiesActual != null ? Number(c.dutiesActual) - Number(c.dutiesExpected) : null;

  return (
    <section className="jblock" id="aduana">
      <div className="jbh"><b>{t("CASO DE ADUANA", "CUSTOMS CASE")}</b><span className="grow" /><span className={`sig ${needs.length ? "attn" : "ok"}`}>{needs.length ? t(`Faltan ${needs.length} para importar`, `${needs.length} missing to import`) : t("Listo para importar", "Ready to import")}</span></div>
      {needs.length > 0 && <ul className="plain small">{needs.map((n) => <li key={n.key}>• {t(n.what.es, n.what.en)}</li>)}</ul>}
      {c && (
        <dl className="qv-dl tight">
          <dt>{t("Clasificación arancelaria", "Tariff classification")}</dt><dd>{c.classification ? <b className="mono">{c.classification}</b> : "—"} <span className={`sig ${cls.tone}`}>{cls.txt}</span>{c.classificationSource && <span className="src block">{c.classificationSource}</span>}</dd>
          <dt>{t("Origen", "Origin")}</dt><dd>{c.origin ?? "—"}</dd>
          <dt>{t("Valor declarado", "Declared value")}</dt><dd className="mono">{usd(c.declaredValue)}</dd>
          <dt>{t("Consignatario", "Consignee")}</dt><dd>{c.consignee ?? "—"}</dd>
          <dt>{t("Agente de aduana", "Customs broker")}</dt><dd>{c.broker ?? "—"}{c.declarationNo && <span className="muted small"> · {t("declaración", "declaration")} {c.declarationNo}</span>}</dd>
          {c.permits && <><dt>{t("Permisos", "Permits")}</dt><dd className="small">{c.permits}</dd></>}
          <dt>{t("Tributos", "Duties and taxes")}</dt><dd className="mono">{t("esperados", "expected")} {usd(c.dutiesExpected)} · {t("reales", "actual")} {usd(c.dutiesActual)}{dutyDiff != null && Math.abs(dutyDiff) > 0.005 && <span className={dutyDiff > 0 ? "risk-t" : "ok-t"}> · {dutyDiff > 0 ? "+" : ""}{i.n2(dutyDiff)}</span>}{c.vatTreatment && <span className="src block">IVA: {c.vatTreatment}</span>}</dd>
          {c.inspection && <><dt>{t("Inspección", "Inspection")}</dt><dd className="small">{c.inspection}</dd></>}
          {c.holdReason && <><dt>{t("Retención", "Hold")}</dt><dd className="small"><span className="risk-t">{c.holdReason}</span>{c.correctiveSteps && <span className="block">{t("Para liberar", "To release")}: {c.correctiveSteps}</span>}</dd></>}
          <dt>{t("Tiempos", "Timing")}</dt><dd className="small">{t("llegó", "arrived")} <span className="mono">{c.arrivedAt ? i.day(c.arrivedAt) : "—"}</span> · {t("liberado", "released")} <span className="mono">{c.releasedAt ? i.day(c.releasedAt) : "—"}</span>{c.expectedDays != null && ` · ${t(`${c.expectedDays} días esperados`, `${c.expectedDays} days expected`)}`}{c.arrivedAt && c.releasedAt && ` · ${t(`${Math.round((+c.releasedAt - +c.arrivedAt) / 864e5)} días reales`, `${Math.round((+c.releasedAt - +c.arrivedAt) / 864e5)} actual days`)}`}</dd>
        </dl>
      )}
      <p className="src">{t(CLASSIFICATION_RULE.es, CLASSIFICATION_RULE.en)}</p>
      {editable && (
        <details className="qa"><summary className="qa-btn">{c ? t("Actualizar caso de aduana", "Update customs case") : t("+ Abrir caso de aduana", "+ Open customs case")}</summary>
          <form action={saveCustomsCase.bind(null, s.id)} className="qa-form" style={{ marginTop: 8, maxWidth: 680 }}>
            <div className="qa-row">
              <label style={{ flex: "0 0 170px" }}>{t("Clasificación arancelaria", "Tariff classification")}<input name="classification" maxLength={40} defaultValue={c?.classification ?? ""} /></label>
              <label style={{ flex: "0 0 230px" }}>{t("¿Qué tan firme es?", "How firm is it?")}<select name="classificationStatus" defaultValue={c?.classificationStatus === "VALIDATED_CURRENT" ? "VALIDATED_CURRENT" : "HISTORICAL"}><option value="HISTORICAL">{t("Usada antes (histórica)", "Used before (historical)")}</option><option value="VALIDATED_CURRENT">{t("Validada hoy por el agente", "Validated today by the broker")}</option></select></label>
              <label>{t("Quién la validó o de dónde sale", "Who validated it or where it comes from")}<input name="classificationSource" maxLength={200} defaultValue={c?.classificationSource ?? ""} /></label>
            </div>
            <div className="qa-row">
              <label>{t("País de origen", "Country of origin")}<input name="origin" maxLength={80} defaultValue={c?.origin ?? ""} /></label>
              <label style={{ flex: "0 0 170px" }}>{t("Valor declarado (USD)", "Declared value (USD)")}<input name="declaredValue" inputMode="decimal" defaultValue={c?.declaredValue != null ? String(c.declaredValue) : ""} /></label>
              <label>{t("Consignatario", "Consignee")}<input name="consignee" maxLength={160} defaultValue={c?.consignee ?? ""} /></label>
            </div>
            <div className="qa-row">
              <label>{t("Agente de aduana", "Customs broker")}<input name="broker" maxLength={120} defaultValue={c?.broker ?? ""} /></label>
              <label>{t("Declaración n.º", "Declaration no.")}<input name="declarationNo" maxLength={60} defaultValue={c?.declarationNo ?? ""} /></label>
              <label>{t("Permisos o vistos buenos", "Permits or approvals")}<input name="permits" maxLength={300} defaultValue={c?.permits ?? ""} /></label>
            </div>
            <div className="qa-row">
              <label style={{ flex: "0 0 170px" }}>{t("Tributos esperados (USD)", "Expected duties (USD)")}<input name="dutiesExpected" inputMode="decimal" defaultValue={c?.dutiesExpected != null ? String(c.dutiesExpected) : ""} /></label>
              <label style={{ flex: "0 0 170px" }}>{t("Tributos reales (USD)", "Actual duties (USD)")}<input name="dutiesActual" inputMode="decimal" defaultValue={c?.dutiesActual != null ? String(c.dutiesActual) : ""} /></label>
              <label>{t("Tratamiento del IVA", "VAT treatment")}<input name="vatTreatment" maxLength={120} defaultValue={c?.vatTreatment ?? ""} /></label>
            </div>
            <div className="qa-row">
              <label>{t("Inspección (si hubo)", "Inspection (if any)")}<input name="inspection" maxLength={200} defaultValue={c?.inspection ?? ""} /></label>
              <label>{t("Motivo de retención", "Hold reason")}<input name="holdReason" maxLength={300} defaultValue={c?.holdReason ?? ""} /></label>
              <label>{t("Qué hace falta para liberar", "What is needed to release")}<input name="correctiveSteps" maxLength={300} defaultValue={c?.correctiveSteps ?? ""} /></label>
            </div>
            <div className="qa-row">
              <label style={{ flex: "0 0 160px" }}>{t("Llegó a aduana", "Arrived at customs")}<input name="arrivedAt" type="date" defaultValue={dayInput(c?.arrivedAt)} /></label>
              <label style={{ flex: "0 0 160px" }}>{t("Liberado", "Released")}<input name="releasedAt" type="date" defaultValue={dayInput(c?.releasedAt)} /></label>
              <label style={{ flex: "0 0 160px" }}>{t("Días esperados", "Expected days")}<input name="expectedDays" inputMode="numeric" defaultValue={c?.expectedDays ?? ""} /></label>
            </div>
            <button type="submit">{t("Guardar caso", "Save case")}</button>
          </form>
        </details>
      )}
    </section>
  );
}
