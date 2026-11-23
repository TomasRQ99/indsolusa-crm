import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { canManageAll } from "@/lib/permissions";
import { causeLabel } from "@/lib/causes";
import { getDelayTags } from "@/lib/delay";
import { DELAY_CAUSES, MAX_DELAY_TAGS, type DelayTag } from "@/lib/delay-rules";
import { saveDelayTags } from "./actions";

// Causas de retraso: the tags offered in "Aviso de retraso". Each one says what the customer is told and what we
// propose to do, so the email is nearly written when the person picks it.

export default async function DelayTagsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const [sp, user] = await Promise.all([searchParams, requireUser()]);
  const i = makeI18n(user.lang);
  const { t } = i;
  const can = canManageAll(user) || user.role === "ADMINISTRACION";
  const cur = await getDelayTags();
  const blank: DelayTag = { key: "", label: "", cause: "OTHER", explainEs: "", explainEn: "", solutionEs: "", solutionEn: "", active: true };
  const rows = can && cur.value.length < MAX_DELAY_TAGS ? [...cur.value, blank] : cur.value;
  const okMsg: Record<string, string> = { guardada: t("Guardado. La lista nueva ya es la que ven las personas al avisar un retraso.", "Saved. The new list is now what people see when notifying a delay."), igual: t("No hubo cambios.", "No changes.") };
  const errMsg: Record<string, string> = { permiso: t("Esta lista la cambian Gerencia, Dirección Comercial o Administración.", "This list is changed by Management, the Commercial Director or Administration."), vacia: t("Debe quedar al menos una causa activa. No se guardó nada.", "At least one active cause must remain. Nothing was saved.") };

  return (
    <>
      <div className="ph"><div><h1>{t("Causas de retraso", "Delay causes")}</h1><p>{t("Las causas que una persona puede elegir cuando una entrega pasa su fecha prometida. Cada una trae lo que se le dice al cliente y lo que proponemos hacer; la persona puede ajustar el texto antes de enviar.", "The causes a person can pick when a delivery passes its promised date. Each one carries what the customer is told and what we propose to do; the person can adjust the text before sending.")}</p></div></div>
      {sp.ok && okMsg[sp.ok] && <div className="note okn" role="status">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk" role="alert">{errMsg[sp.err]}</div>}
      <p className="src">{cur.version === 0 ? t("En uso: la lista inicial de SOLU. Al guardar queda la tuya.", "In use: SOLU's starting list. Saving makes it yours.") : t(`Versión ${cur.version} · guardada por ${cur.by ?? "—"} el ${i.date(cur.at)}`, `Version ${cur.version} · saved by ${cur.by ?? "—"} on ${i.date(cur.at)}`)}</p>

      <form action={saveDelayTags} className="rt-admin">
        {rows.map((x, n) => (
          <section className="card" key={`${x.key}-${n}`}>
            <input type="hidden" name={`key_${n}`} value={x.key} />
            <div className="rt-two">
              <label className="rt-l">{x.key ? t("Nombre de la causa", "Name of the cause") : t("Agregar una causa nueva (deja el nombre vacío si no quieres agregar)", "Add a new cause (leave the name empty if you do not want to add one)")}
                <input name={`label_${n}`} defaultValue={x.label} maxLength={90} disabled={!can} placeholder={t("Ej.: Paro o cierre de vías", "E.g.: Strike or road closure")} />
              </label>
              <label className="rt-l">{t("Familia para los informes de Gerencia", "Family for Management reports")}
                <select name={`cause_${n}`} defaultValue={x.cause} disabled={!can}>{DELAY_CAUSES.map((c) => <option key={c} value={c}>{causeLabel(t, c)}</option>)}</select>
              </label>
            </div>
            <div className="rt-two">
              <label className="rt-l">{t("Qué pasó, para el cliente (español)", "What happened, for the customer (Spanish)")}<textarea name={`explainEs_${n}`} rows={2} defaultValue={x.explainEs} maxLength={500} disabled={!can} /></label>
              <label className="rt-l">{t("Qué pasó, para el cliente (inglés)", "What happened, for the customer (English)")}<textarea name={`explainEn_${n}`} rows={2} defaultValue={x.explainEn} maxLength={500} disabled={!can} /></label>
            </div>
            <div className="rt-two">
              <label className="rt-l">{t("Qué proponemos hacer (español)", "What we propose to do (Spanish)")}<textarea name={`solutionEs_${n}`} rows={2} defaultValue={x.solutionEs} maxLength={500} disabled={!can} /></label>
              <label className="rt-l">{t("Qué proponemos hacer (inglés)", "What we propose to do (English)")}<textarea name={`solutionEn_${n}`} rows={2} defaultValue={x.solutionEn} maxLength={500} disabled={!can} /></label>
            </div>
            {can && (
              <div className="rt-bar">
                <label><input type="checkbox" name={`active_${n}`} value="1" defaultChecked={x.active} /> {t("Activa (aparece en la lista)", "Active (shown in the list)")}</label>
                {x.key && <label><input type="checkbox" name={`remove_${n}`} value="1" /> {t("Quitar esta causa al guardar", "Remove this cause on save")}</label>}
              </div>
            )}
          </section>
        ))}
        {can ? <button type="submit">{t("Guardar las causas de retraso", "Save the delay causes")}</button> : <p className="src">{t("Esta lista la cambian Gerencia, Dirección Comercial o Administración.", "This list is changed by Management, the Commercial Director or Administration.")}</p>}
        <p className="src">{t("El texto para el cliente nunca debe nombrar ni culpar a un proveedor o transportador. Quitar una causa no cambia los avisos que ya se enviaron con ella.", "The text for the customer must never name or blame a supplier or carrier. Removing a cause does not change the notices already sent with it.")}</p>
      </form>
    </>
  );
}
