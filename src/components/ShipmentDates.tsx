import { db } from "@/lib/db";
import { today, dayInput } from "@/lib/domain";
import { makeI18n } from "@/lib/i18n";
import { getOpsPolicy } from "@/lib/ops-home";
import { promiseHealth } from "@/lib/ops-rules";
import { saveShipmentDates } from "@/app/(app)/logistica/actions";

// Operaciones O5a · ETA architecture (module 11 §30): nine separate dates, never one "ETA", and the health of the
// customer promise with its reason. The carrier's ETA informs what we expect; it is never copied into the promise.

export async function ShipmentDates({ shipmentId, lang, editable }: { shipmentId: string; lang: "ES" | "EN"; editable: boolean }) {
  const i = makeI18n(lang);
  const { t } = i;
  const s = await db.shipment.findUnique({ where: { id: shipmentId }, select: { id: true, plannedRts: true, rtsAt: true, plannedPickup: true, pickedUpAt: true, plannedDeparture: true, departedAt: true, carrierEta: true, carrierEtaSource: true, customsExpectedRelease: true, plannedDelivery: true, deliveredAt: true, toCustomer: true, deal: { select: { promisedDate: true } } } });
  if (!s) return null;
  const pol = await getOpsPolicy();
  // Current Expected Delivery: the latest of what we planned, what the carrier says and when customs should release.
  const cands = [s.plannedDelivery, s.carrierEta, s.customsExpectedRelease].filter((x): x is Date => !!x);
  const expected = cands.length ? new Date(Math.max(...cands.map((x) => +x))) : null;
  const h = s.deal.promisedDate ? promiseHealth(s.deal.promisedDate, expected, today(), pol.value, !!s.deliveredAt && s.toCustomer) : null;
  const tone = { PROTECTED: "ok", NARROW: "attn", AT_RISK: "risk", BREACHED: "risk", UNKNOWN: "wait" } as const;
  const word = { PROTECTED: t("Protegida", "Protected"), NARROW: t("Justa", "Narrow"), AT_RISK: t("En riesgo", "At risk"), BREACHED: t("Incumplida", "Breached"), UNKNOWN: t("Sin fecha esperada", "No expected date") };
  const row = (label: string, d: Date | null, note?: string | null) => <><dt>{label}</dt><dd className="mono">{d ? i.day(d) : "—"}{note ? <span className="muted small"> · {note}</span> : null}</dd></>;
  return (
    <section className="jblock" id="fechas">
      <div className="jbh"><b>{t("FECHAS: CADA UNA ES UN HECHO DISTINTO", "DATES: EACH ONE IS A DIFFERENT FACT")}</b><span className="grow" />{h && <span className={`sig ${tone[h.health]}`}>{t("Promesa", "Promise")}: {word[h.health]}</span>}</div>
      {h && <p className="small">{t(h.reason.es, h.reason.en)}</p>}
      <dl className="qv-dl tight">
        {row(t("Listo del proveedor (plan)", "Supplier ready (planned)"), s.plannedRts, s.rtsAt ? t(`real ${i.day(s.rtsAt)}`, `actual ${i.day(s.rtsAt)}`) : null)}
        {row(t("Recogida planeada", "Planned pickup"), s.plannedPickup)}
        {row(t("Recogida real", "Actual pickup"), s.pickedUpAt)}
        {row(t("Salida planeada", "Planned departure"), s.plannedDeparture)}
        {row(t("Salida real", "Actual departure"), s.departedAt)}
        {row(t("ETA del transportador", "Carrier ETA"), s.carrierEta, s.carrierEtaSource)}
        {row(t("Liberación esperada de aduana", "Expected customs release"), s.customsExpectedRelease)}
        {row(t("Entrega esperada hoy", "Current expected delivery"), expected, t("la más tardía de las anteriores", "the latest of the above"))}
        {row(t("Promesa al cliente", "Customer promise"), s.deal.promisedDate, t("no cambia sola", "doesn't change by itself"))}
      </dl>
      {editable && !s.deliveredAt && (
        <form action={saveShipmentDates.bind(null, s.id)} className="qa-row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ flex: "0 0 auto" }}>{t("Salida planeada", "Planned departure")}<input name="plannedDeparture" type="date" defaultValue={dayInput(s.plannedDeparture)} /></label>
          <label style={{ flex: "0 0 auto" }}>{t("Salida real", "Actual departure")}<input name="departedAt" type="date" defaultValue={dayInput(s.departedAt)} /></label>
          <label style={{ flex: "0 0 auto" }}>{t("Liberación esperada de aduana", "Expected customs release")}<input name="customsExpectedRelease" type="date" defaultValue={dayInput(s.customsExpectedRelease)} /></label>
          <button type="submit" className="secondary" style={{ flex: "0 0 auto" }}>{t("Guardar fechas", "Save dates")}</button>
        </form>
      )}
    </section>
  );
}