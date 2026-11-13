import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { buildPlan, hm, type PlanItem } from "@/lib/plan";
import { OutlookNote } from "@/components/OutlookNote";
import { pushPlanToOutlook, reservePlan, unplanTask } from "./actions";

export default async function MiPlanPage({ searchParams }: { searchParams: Promise<{ cal?: string; outlook?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const plan = await buildPlan(user);
  const free = plan.totals.workday - plan.totals.buffer - plan.totals.planned - plan.totals.proposed;

  const Item = ({ it }: { it: PlanItem }) => (
    <div className="item">
      <div className="t">{it.title}</div>
      <div className="a"><span className="val small">{hm(it.minutes)}</span></div>
      <div className="d small">
        {it.dealId ? <Link href={`/deals/${it.dealId}`}>{it.dealCode ?? t("Necesidad", "Necessity")}</Link> : null}
        {it.account ? <> · {it.account}</> : null}
        {it.due ? <> · {t("para el", "due")} {i.dateShort(it.due)}</> : <> · {t("sin fecha", "no date")}</>}
      </div>
    </div>
  );

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb">{t("Mi día", "My day")} · {t("Mi Plan", "My Plan")}</div>
          <h1>{t("Mi semana", "My week")}</h1>
          <p>{t("SOLU arma los bloques con lo que ya sabe: tus pendientes y los siguientes movimientos de tus Necesidades. Deja libre una parte de cada día para urgencias.", "SOLU builds the blocks from what it already knows: your to-dos and your Necessities' next movements. Part of each day stays free for urgencies.")}</p>
        </div>
        <div className="grow" />
        {plan.worth.length > 0 && (
          <form action={reservePlan}>
            <button type="submit">{t(`Reservar los ${plan.worth.length} bloques`, `Reserve the ${plan.worth.length} blocks`)}</button>
          </form>
        )}
        {user.outlookConnectedAt ? (
          <form action={pushPlanToOutlook}>
            <button type="submit" className="secondary">{t("Enviar a mi Outlook", "Send to my Outlook")}</button>
          </form>
        ) : (
          <>
            <Link className="btn secondary" href="/profile#outlook">{t("Conectar Outlook", "Connect Outlook")}</Link>
            <a className="btn secondary" href="/mi-plan/ics">{t("Descargar .ics", "Download .ics")}</a>
          </>
        )}
      </div>
      <OutlookNote code={sp.cal} t={t} />
      {sp.outlook != null && (
        <div className="note" style={{ marginBottom: 16 }}>
          {Number(sp.outlook) > 0
            ? t(`Listo: ${sp.outlook} bloques quedaron en tu calendario de Outlook, en espacios libres.`, `Done: ${sp.outlook} blocks are now in your Outlook calendar, in free slots.`)
            : t("No había bloques reservados pendientes de enviar a Outlook.", "There were no reserved blocks left to send to Outlook.")}
        </div>
      )}

      <section className="sum">
        <div><span className="k">{t("Jornada de la semana", "Week's working time")}</span><span className="v">{hm(plan.totals.workday)}</span><span className="s">{t("según tu perfil", "from your profile")}</span></div>
        <div><span className="k">{t("Protegido para urgencias", "Kept for urgencies")}</span><span className="v">{hm(plan.totals.buffer)}</span><span className="s">30 %</span></div>
        <div><span className="k">{t("Ya reservado", "Already reserved")}</span><span className="v">{hm(plan.totals.planned)}</span></div>
        <div><span className="k">{t("Vale la pena reservar", "Worth reserving")}</span><span className="v">{hm(plan.totals.proposed)}</span><span className="s">{plan.worth.length} {t("bloques", "blocks")}</span></div>
        <div><span className="k">{t("Queda libre", "Still free")}</span><span className="v">{hm(Math.max(0, free))}</span></div>
      </section>

      <div className="week" style={{ marginBottom: 20 }}>
        {plan.days.map((d, k) => {
          const used = [...d.planned, ...d.proposed].reduce((s, x) => s + x.minutes, 0);
          return (
            <div key={k} className={`day ${k === 0 ? "today" : ""}`}>
              <div className="h"><span>{i.dateShort(d.date)}</span><span className="src">{d.workday ? `${hm(used)} / ${hm(d.capacity)}` : t("descanso", "off")}</span></div>
              {d.workday > 0 && (
                <div className="bar"><i style={{ width: `${Math.min(100, (used / Math.max(1, d.workday)) * 100)}%` }} /><i className="soft" style={{ width: `${(1 - d.capacity / Math.max(1, d.workday)) * 100}%`, marginLeft: "auto" }} /></div>
              )}
              {d.planned.map((it) => (
                <div key={it.key} className="pblock task" title={it.title}>
                  {it.title}
                  {it.taskId && (
                    <form action={unplanTask.bind(null, it.taskId)} style={{ display: "inline" }}>
                      {" "}<button type="submit" className="link small" aria-label={t("Quitar del plan", "Remove from plan")}>×</button>
                    </form>
                  )}
                </div>
              ))}
              {d.proposed.map((it) => (
                <div key={it.key} className="pblock" title={it.title} style={{ borderStyle: "dashed" }}>{it.title}</div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="lanes">
        <div className="card lane">
          <h2><span>{t("Vale la pena reservar", "Worth reserving")}</span><span className="src">{plan.worth.length} · {hm(plan.totals.proposed)}</span></h2>
          <p className="src" style={{ marginBottom: 6 }}>{t("Tiene fecha esta semana y cabe antes de esa fecha.", "Due this week and fits before its date.")}</p>
          <div className="items">{plan.worth.map((it) => <Item key={it.key} it={it} />)}</div>
          {plan.worth.length === 0 && <p className="empty small"><b>{t("Nada por reservar", "Nothing to reserve")}</b>{t("Tu semana ya está organizada.", "Your week is already organized.")}</p>}
        </div>
        <div className="card lane">
          <h2><span>{t("Puede esperar", "Can wait")}</span><span className="src">{plan.canWait.length}</span></h2>
          <p className="src" style={{ marginBottom: 6 }}>{t("Su fecha es después de esta semana o no tiene fecha.", "Due after this week or has no date.")}</p>
          <div className="items">{plan.canWait.map((it) => <Item key={it.key} it={it} />)}</div>
        </div>
        <div className="card lane">
          <h2><span>{t("No cabe", "Doesn't fit")}</span><span className="src">{plan.noFit.length}</span></h2>
          <p className="src" style={{ marginBottom: 6 }}>{t("Vence esta semana pero no hay espacio antes. Conviene mover la fecha, pedir ayuda o liberar algo.", "Due this week but there is no room before it. Worth moving the date, asking for help or freeing something.")}</p>
          <div className="items">{plan.noFit.map((it) => <Item key={it.key} it={it} />)}</div>
        </div>
      </div>
      <p className="src" style={{ marginTop: 12 }}>{t("Cada bloque dura 30 min si no tiene estimado. Cambia la duración en Pendientes. Tu jornada se ajusta en Mi perfil.", "Blocks last 30 min unless estimated. Change durations in To-dos. Adjust your working day in My profile.")}</p>
    </>
  );
}
