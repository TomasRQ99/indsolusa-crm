import { db } from "@/lib/db";
import { today, dayInput } from "@/lib/domain";
import { makeI18n } from "@/lib/i18n";
import { COMMIT_STATUS, MILESTONES, ORDER_KINDS, commitmentReading } from "@/lib/commitment-rules";
import { getOpsPolicy } from "@/lib/ops-home";
import { markOccurred, setOrderKind, updateCommitment } from "@/app/(app)/compras/actions";

// Operaciones O4b · what the supplier promised, by milestone: reported vs committed vs actually occurred, with a
// reading that says when there is nothing to do yet (waiting with control) and when a date passed without evidence.

export async function SpoCommitments({ spoId, lang, editable }: { spoId: string; lang: "ES" | "EN"; editable: boolean }) {
  const i = makeI18n(lang);
  const { t } = i;
  const spo = await db.supplierPO.findUnique({ where: { id: spoId }, select: { id: true, releasedAt: true, orderKind: true, commitments: { orderBy: { position: "asc" } } } });
  if (!spo?.releasedAt) return null;
  const T = today();
  const grace = (await getOpsPolicy()).value.graceDays;
  const label = (c: { type: string; label: string }) => { const m = Object.values(MILESTONES).flat().find((x) => x.key === c.type); return m ? t(m.es, m.en) : c.label; };
  const tone = { DONE: "ok", WAITING: "info", DUE: "attn", MISSED: "risk", NO_DATE: "wait" } as const;

  return (
    <section className="jblock" id="compromisos">
      <div className="jbh"><b>{t("LO QUE PROMETIÓ EL PROVEEDOR", "WHAT THE SUPPLIER PROMISED")}</b><span className="grow" /><span className="src">{t("Una fecha informada no es un hecho ocurrido", "A reported date is not a fact that happened")}</span></div>
      {editable && (
        <form action={setOrderKind.bind(null, spo.id)} className="qa-row" style={{ maxWidth: 520 }}>
          <label style={{ flex: "1 1 220px" }}>{t("Tipo de pedido (define los hitos)", "Kind of order (sets the milestones)")}<select name="orderKind" defaultValue={spo.orderKind ?? "STOCK"}>{Object.entries(ORDER_KINDS).map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select></label>
          <button type="submit" className="secondary" style={{ flex: "0 0 auto", alignSelf: "flex-end" }}>{spo.orderKind ? t("Cambiar", "Change") : t("Crear hitos", "Create milestones")}</button>
        </form>
      )}
      {spo.commitments.length === 0 ? <p className="small muted">{t("Elige el tipo de pedido para ver sus hitos: no es lo mismo algo en stock que algo que se fabrica.", "Choose the kind of order to see its milestones: a stock item is not the same as a manufactured one.")}</p> : spo.commitments.map((c) => {
        const r = commitmentReading(c, T, grace);
        return (
          <article key={c.id} className="exc-item">
            <header className="exc-head"><b>{label(c)}</b><span className="grow" /><span className={`sig ${tone[r.reading]}`}>{c.status === "OCCURRED" ? t("Ocurrió", "Occurred") : t(COMMIT_STATUS[c.status]?.es ?? c.status, COMMIT_STATUS[c.status]?.en ?? c.status)}</span></header>
            <p className="small">{c.status === "OCCURRED" ? <>{i.day(c.occurredAt)} · {c.occurredNote}</> : <>{c.expectedDate ? <><b>{i.day(c.expectedDate)}</b> · </> : null}{t(r.text.es, r.text.en)}</>}{c.source && c.status !== "OCCURRED" && <span className="src block">{c.source}{c.contact ? ` · ${c.contact}` : ""}{c.lastConfirmedAt ? ` · ${t("última confirmación", "last confirmed")} ${i.day(c.lastConfirmedAt)}` : ""}</span>}</p>
            {editable && c.status !== "OCCURRED" && (
              <div className="qa-row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
                <form action={updateCommitment.bind(null, c.id)} className="qa-row" style={{ flex: "1 1 420px", flexWrap: "wrap" }}>
                  <input name="expectedDate" type="date" defaultValue={dayInput(c.expectedDate)} aria-label={t("Fecha esperada", "Expected date")} />
                  <select name="status" defaultValue={c.status === "COMMITTED" ? "COMMITTED" : "REPORTED"} aria-label={t("Qué tan firme", "How firm")} style={{ flex: "0 0 150px" }}><option value="REPORTED">{t("Informado", "Reported")}</option><option value="COMMITTED">{t("Comprometido", "Committed")}</option></select>
                  <input name="source" maxLength={200} defaultValue={c.source ?? ""} placeholder={t("De dónde sale (correo de…)", "Where from (email from…)")} aria-label={t("Fuente", "Source")} style={{ flex: "1 1 160px" }} />
                  <button type="submit" className="secondary" style={{ flex: "0 0 auto" }}>{t("Guardar", "Save")}</button>
                </form>
                <form action={markOccurred.bind(null, c.id)} className="qa-row" style={{ flex: "1 1 300px" }}>
                  <input name="note" maxLength={200} placeholder={t("Evidencia de que ocurrió", "Evidence that it happened")} aria-label={t("Evidencia", "Evidence")} style={{ flex: "1 1 160px" }} />
                  <button type="submit" className="secondary" style={{ flex: "0 0 auto" }}>{t("Ocurrió", "It happened")}</button>
                </form>
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
