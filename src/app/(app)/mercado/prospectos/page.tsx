import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canManageAll, canProspect } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { apolloConfigured, apolloCreditsThisMonth, apolloMonthlyCap, describeFilters, filtersFrom, hasCriteria, searchPeople, SENIORITIES, SIZES, type PeopleResult } from "@/lib/apollo";
import { addToMarket, reveal, setProspectStatus } from "./actions";

// Mercado · Explorar prospectos. People SOLU does not know yet, found in Apollo by role and company.
// Searching is free. Revealing one person (name, work email, LinkedIn) costs 1 Apollo credit, so it is
// always a deliberate click, and every revealed person says who revealed it, when and from where.

const OK: Record<string, [string, string]> = {
  revelado: ["Persona revelada y guardada en tus prospectos. Se usó 1 crédito de Apollo.", "Person revealed and saved to your prospects. 1 Apollo credit was used."],
  yaestaba: ["Esta persona ya estaba revelada: no se usó ningún crédito.", "This person was already revealed: no credit was used."],
  pasado: ["Listo: la empresa y la persona ya están en Clientes y Contactos.", "Done: the company and the person are now in Customers and Contacts."],
  yaexistia: ["Esta persona ya era un contacto en SOLU. Quedó enlazada, sin duplicar.", "This person was already a contact in SOLU. It was linked, with no duplicate."],
  yapasado: ["Esta persona ya estaba en Contactos.", "This person was already in Contacts."],
};
const ERR: Record<string, [string, string]> = {
  off: ["Apollo aún no está conectado. Abajo están los pasos para conectarlo.", "Apollo is not connected yet. The steps to connect it are below."],
  key: ["Apollo no aceptó la llave. Conviene revisar que la llave en Render sea la correcta y siga activa.", "Apollo did not accept the key. It is worth checking that the key in Render is correct and still active."],
  plan: ["El plan de Apollo de esta cuenta no permite esta función por API, o la llave no tiene este permiso. Se resuelve en Apollo: crear la llave como «master key» o revisar el plan.", "This account's Apollo plan does not allow this function over the API, or the key lacks this permission. It is solved in Apollo: create the key as a master key or review the plan."],
  rate: ["Apollo pide esperar un momento: se alcanzó su límite de consultas por hora. Conviene intentar de nuevo en unos minutos.", "Apollo asks to wait a moment: its hourly limit was reached. It is worth trying again in a few minutes."],
  cap: ["Se alcanzó el tope de créditos de Apollo de este mes en SOLU. La búsqueda sigue funcionando; revelar personas vuelve el próximo mes o cuando Gerencia suba el tope.", "This month's Apollo credit cap in SOLU was reached. Search still works; revealing people returns next month or when Management raises the cap."],
  credits: ["Apollo dice que a la cuenta no le quedan créditos para esto. Buscar sigue siendo gratis; revelar vuelve cuando Apollo renueve los créditos del plan.", "Apollo says the account has no credits left for this. Searching stays free; revealing returns when Apollo renews the plan's credits."],
  down: ["Apollo no respondió. No sabemos si alcanzó a recibir la solicitud; conviene esperar un minuto y revisar la lista de prospectos antes de intentar de nuevo.", "Apollo did not respond. We don't know if it received the request; it is worth waiting a minute and checking the prospects list before trying again."],
  notfound: ["Apollo no devolvió datos de esa persona. No se usó ningún crédito.", "Apollo returned no data for that person. No credit was used."],
  permiso: ["Tu rol no puede revelar ni pasar prospectos.", "Your role cannot reveal or pass prospects."],
};
const SENIORITY: Record<(typeof SENIORITIES)[number], [string, string]> = {
  owner: ["Dueño", "Owner"], founder: ["Fundador", "Founder"], c_suite: ["Alta dirección (C-level)", "C-suite"], partner: ["Socio", "Partner"], vp: ["Vicepresidente", "VP"],
  head: ["Jefe de área (Head)", "Head"], director: ["Director", "Director"], manager: ["Gerente o jefe", "Manager"], senior: ["Senior", "Senior"], entry: ["Inicial", "Entry"],
};
const SIZE: Record<(typeof SIZES)[number], string> = { "1,50": "1–50", "51,200": "51–200", "201,1000": "201–1.000", "1001,5000": "1.001–5.000", "5001,1000000": "5.001+" };
const EMAIL_STATUS: Record<string, [string, string, string]> = {
  verified: ["Correo verificado", "Verified email", "ok"], unverified: ["Correo sin verificar", "Unverified email", "attn"],
  "likely to engage": ["Correo probable", "Likely email", "attn"], unavailable: ["Sin correo", "No email", "wait"],
};

export default async function ProspectsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (!canProspect(user)) redirect("/mercado");
  const sp = await searchParams;
  const i = makeI18n(user.lang);
  const { t, es } = i;
  const one = (k: string) => { const v = sp[k]; return (Array.isArray(v) ? v[0] : v) ?? ""; };
  const f = filtersFrom(sp);
  const on = apolloConfigured();
  const searched = hasCriteria(f);
  const showDismissed = one("descartados") === "1";

  const [result, used, saved] = await Promise.all([
    on && searched ? searchPeople(f, user.name) : Promise.resolve<PeopleResult | null>(null),
    apolloCreditsThisMonth(),
    db.prospect.findMany({ where: showDismissed ? {} : { status: { not: "DISMISSED" } }, orderBy: [{ status: "desc" }, { revealedAt: "desc" }], take: 200 }),
  ]);
  const cap = apolloMonthlyCap();
  const left = Math.max(0, cap - used);
  const known = result?.ok ? new Map((await db.prospect.findMany({ where: { apolloId: { in: result.people.map((p) => p.id) } }, select: { apolloId: true, id: true } })).map((p) => [p.apolloId, p.id])) : new Map<string, string>();

  // The same search, as a link: used to come back after revealing, and to move between pages.
  const qs = (extra: Record<string, string> = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) { if (k === "ok" || k === "err") continue; for (const x of Array.isArray(v) ? v : v ? [v] : []) p.append(k, x); }
    for (const [k, v] of Object.entries(extra)) { p.delete(k); if (v) p.set(k, v); }
    const s = p.toString();
    return `/mercado/prospectos${s ? `?${s}` : ""}`;
  };
  const back = qs();
  const found = describeFilters(f);
  const ok = OK[one("ok")], err = ERR[one("err")] ?? (result && !result.ok ? ERR[result.error] : undefined);
  // Apollo's own words for what just failed: from this search, or from the reveal that sent the person back here.
  const lastFail = one("err") && !["permiso", "cap", "off"].includes(one("err"))
    ? await db.apolloUsage.findFirst({ where: { ok: false, userName: user.name, createdAt: { gte: new Date(Date.now() - 120_000) } }, orderBy: { createdAt: "desc" }, select: { detail: true } })
    : null;
  const said = (result && !result.ok ? result.said : undefined) || (lastFail?.detail?.includes("Apollo: ") ? lastFail.detail.split("Apollo: ").slice(-1)[0] : "");
  const pages = result?.ok ? Math.min(500, Math.ceil(result.total / result.perPage)) : 0;

  return (
    <>
      <div className="ph">
        <div>
          <h1>{t("Explorar prospectos", "Explore prospects")}</h1>
          <p>{t("Personas que SOLU todavía no conoce, buscadas en Apollo por cargo y empresa. Buscar no cuesta. Revelar una persona (nombre completo, correo de trabajo y LinkedIn) usa 1 crédito de Apollo.", "People SOLU does not know yet, found in Apollo by role and company. Searching is free. Revealing a person (full name, work email and LinkedIn) uses 1 Apollo credit.")}</p>
        </div>
        <span className="grow" />
        {on && <span className={`sig ${left === 0 ? "attn" : "info"}`} title={t("Conteo de SOLU. El de Apollo es el que factura.", "SOLU's count. Apollo's own count is the one that bills.")}>{t(`Créditos este mes: ${used} de ${cap}`, `Credits this month: ${used} of ${cap}`)}</span>}
      </div>

      {ok && <p className="note okn" style={{ marginBottom: 16 }}>{es ? ok[0] : ok[1]}</p>}
      {err && (
        <p className="note attn" style={{ marginBottom: 16 }}>
          <span>
            {es ? err[0] : err[1]}
            {said && <span className="src block" style={{ marginTop: 4 }}>{t("Lo que respondió Apollo", "What Apollo answered")}: «{said}»</span>}
          </span>
        </p>
      )}

      {!on && (
        <section className="card" data-zone="plan" id="conectar">
          <b>{t("APOLLO AÚN NO ESTÁ CONECTADO", "APOLLO IS NOT CONNECTED YET")}</b>
          <p className="small" style={{ margin: "6px 0 10px" }}>{t("Apollo (apollo.io) es una base de datos de empresas y personas de negocio. SOLU la consulta con una llave de tu cuenta de Apollo. Mientras no haya llave, esta pantalla no consulta nada y no cuesta nada.", "Apollo (apollo.io) is a database of companies and business people. SOLU queries it with a key from your Apollo account. Until there is a key, this screen queries nothing and costs nothing.")}</p>
          {canManageAll(user) ? (
            <ol className="small" style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 4 }}>
              <li>{t("Crea la cuenta en apollo.io con un correo de la empresa (no Gmail).", "Create the account at apollo.io with a company email (not Gmail).")}</li>
              <li>{t("En Apollo: Settings → Integrations → API Keys → «Create new key». Marca «Set as master key» y copia la llave.", "In Apollo: Settings → Integrations → API Keys → “Create new key”. Tick “Set as master key” and copy the key.")}</li>
              <li>{t("En Render: abre el servicio del CRM → Environment → «Add Environment Variable». Nombre: APOLLO_API_KEY. Valor: la llave. Guarda; Render reinicia solo.", "In Render: open the CRM service → Environment → “Add Environment Variable”. Name: APOLLO_API_KEY. Value: the key. Save; Render restarts by itself.")}</li>
              <li>{t("Opcional: APOLLO_MONTHLY_CREDITS con el tope de créditos al mes que SOLU puede usar (si no existe, son 90).", "Optional: APOLLO_MONTHLY_CREDITS with the monthly credit cap SOLU may use (90 if it is not set).")}</li>
              <li>{t("Vuelve a esta pantalla y haz una búsqueda. La llave nunca se escribe en SOLU ni en un chat.", "Come back to this screen and run a search. The key is never typed into SOLU or a chat.")}</li>
            </ol>
          ) : (
            <p className="small muted">{t("Gerencia o Dirección Comercial lo conectan una sola vez para todos.", "Management or the Commercial Director connects it once for everyone.")}</p>
          )}
        </section>
      )}

      <section className="card" data-zone="flow" id="buscar">
        <b>{t("BUSCAR PERSONAS", "FIND PEOPLE")}</b> <span className="small muted">{t("sin costo · escribe varias opciones separadas por comas", "free · write several options separated by commas")}</span>
        <form method="get" action="/mercado/prospectos" className="pr-form" data-no-pending>
          <label className="wide">{t("Cargos", "Job titles")}<input name="cargos" defaultValue={one("cargos")} placeholder={t("jefe de mantenimiento, maintenance manager, gerente de planta", "maintenance manager, plant manager")} /></label>
          <label>{t("Dónde vive la persona", "Where the person lives")}<input name="donde" defaultValue={one("donde")} placeholder="Colombia" /></label>
          <label>{t("Sede de la empresa", "Company headquarters")}<input name="sede" defaultValue={one("sede")} placeholder={t("Colombia, Texas", "Colombia, Texas")} /></label>
          <label>{t("Sitio web de la empresa", "Company website")}<input name="dominio" defaultValue={one("dominio")} placeholder="alpina.com" /></label>
          <label>{t("Palabras clave", "Keywords")}<input name="palabras" defaultValue={one("palabras")} placeholder={t("alimentos, empaque", "food, packaging")} /></label>
          <fieldset className="wide">
            <legend>{t("Nivel del cargo", "Seniority")}</legend>
            {SENIORITIES.map((s) => <label className="check" key={s}><input type="checkbox" name="nivel" value={s} defaultChecked={f.seniorities.includes(s)} />{es ? SENIORITY[s][0] : SENIORITY[s][1]}</label>)}
          </fieldset>
          <fieldset className="wide">
            <legend>{t("Tamaño de la empresa (empleados)", "Company size (employees)")}</legend>
            {SIZES.map((s) => <label className="check" key={s}><input type="checkbox" name="tam" value={s} defaultChecked={f.sizes.includes(s)} />{SIZE[s]}</label>)}
            <label className="check"><input type="checkbox" name="verificado" value="1" defaultChecked={f.verifiedOnly} />{t("Solo con correo verificado", "Only with a verified email")}</label>
          </fieldset>
          <div className="wide row">
            <button type="submit" disabled={!on}>{t("Buscar en Apollo", "Search Apollo")}</button>
            {searched && <Link href="/mercado/prospectos" className="small">{t("Limpiar", "Clear")}</Link>}
            {!on && <span className="small muted">{t("Se activa al conectar Apollo.", "It turns on when Apollo is connected.")}</span>}
          </div>
        </form>
      </section>

      {result?.ok && (
        <section className="card" id="resultados">
          <b>{t("RESULTADOS DE APOLLO", "APOLLO RESULTS")}</b> <span className="small muted">{t(`${i.n(result.total)} personas · página ${result.page} de ${Math.max(1, pages)}`, `${i.n(result.total)} people · page ${result.page} of ${Math.max(1, pages)}`)}</span>
          <p className="src" style={{ margin: "2px 0 8px" }}>{t("Apollo muestra el apellido incompleto y no entrega el correo hasta que se revela la persona. Fuente: Apollo, consultado ahora.", "Apollo shows a partial last name and gives no email until the person is revealed. Source: Apollo, queried just now.")}</p>
          {result.people.length === 0 ? (
            <div className="empty"><b>{t("Apollo no encontró personas con esos criterios", "Apollo found no people with those criteria")}</b>{t("Conviene quitar un filtro o escribir el cargo también en inglés.", "It is worth removing a filter or writing the title in English too.")}</div>
          ) : (
            <div className="tscroll">
              <table>
                <thead><tr><th>{t("Persona", "Person")}</th><th>{t("Cargo", "Title")}</th><th>{t("Empresa", "Company")}</th><th>{t("Apollo tiene", "Apollo has")}</th><th /></tr></thead>
                <tbody>
                  {result.people.map((p) => (
                    <tr key={p.id}>
                      <td><b>{p.firstName} {p.lastMasked}</b></td>
                      <td>{p.title ?? "—"}</td>
                      <td>{p.orgName ?? "—"}</td>
                      <td>{p.hasEmail ? <span className="sig ok">{t("Correo", "Email")}</span> : <span className="sig wait">{t("Sin correo", "No email")}</span>}</td>
                      <td className="n">
                        {known.has(p.id) ? (
                          <a className="small" href={`#p-${known.get(p.id)}`}>{t("Ya está en tus prospectos", "Already in your prospects")}</a>
                        ) : (
                          <form action={reveal} data-confirm={t(`¿Revelar a ${p.firstName} de ${p.orgName ?? "esta empresa"}? Usa 1 crédito de Apollo. Quedan ${left} este mes.`, `Reveal ${p.firstName} at ${p.orgName ?? "this company"}? It uses 1 Apollo credit. ${left} left this month.`)}>
                            <input type="hidden" name="apolloId" value={p.id} />
                            <input type="hidden" name="back" value={back} />
                            <input type="hidden" name="foundWith" value={found} />
                            <button type="submit" className="sm" disabled={left === 0}>{t("Revelar · 1 crédito", "Reveal · 1 credit")}</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pages > 1 && (
            <div className="row" style={{ marginTop: 10 }}>
              {result.page > 1 && <Link className="btn secondary sm" href={qs({ p: String(result.page - 1) }) + "#resultados"}>{t("← Anterior", "← Previous")}</Link>}
              {result.page < pages && <Link className="btn secondary sm" href={qs({ p: String(result.page + 1) }) + "#resultados"}>{t("Siguiente →", "Next →")}</Link>}
            </div>
          )}
        </section>
      )}

      <section className="card" id="prospectos">
        <b>{t("PROSPECTOS REVELADOS", "REVEALED PROSPECTS")}</b> <span className="small muted">{t("de todo el equipo · revelar de nuevo a alguien de esta lista no cuesta", "from the whole team · revealing someone on this list again costs nothing")}</span>
        {saved.length === 0 ? (
          <div className="empty"><b>{t("Todavía no hay prospectos revelados", "No revealed prospects yet")}</b>{t("Busca arriba y revela a las personas que valga la pena contactar.", "Search above and reveal the people worth contacting.")}</div>
        ) : (
          <div className="tscroll">
            <table>
              <thead><tr><th>{t("Persona", "Person")}</th><th>{t("Empresa", "Company")}</th><th>{t("Contacto", "Contact")}</th><th>{t("De dónde sale", "Where it comes from")}</th><th /></tr></thead>
              <tbody>
                {saved.map((p) => {
                  const st = p.emailStatus ? EMAIL_STATUS[p.emailStatus.toLowerCase()] : undefined;
                  return (
                    <tr key={p.id} id={`p-${p.id}`} className={p.status === "DISMISSED" ? "done-row" : undefined}>
                      <td><b>{p.firstName} {p.lastName}</b><span className="src block">{p.title ?? t("cargo sin dato", "no title")}{[p.city, p.country].filter(Boolean).length ? ` · ${[p.city, p.country].filter(Boolean).join(", ")}` : ""}</span></td>
                      <td>{p.orgName ?? "—"}<span className="src block">{[p.orgIndustry, p.orgEmployees ? t(`${i.n(p.orgEmployees)} empleados`, `${i.n(p.orgEmployees)} employees`) : null, p.orgDomain].filter(Boolean).join(" · ")}</span></td>
                      <td>
                        {p.email ? <a href={`mailto:${p.email}`}>{p.email}</a> : <span className="muted">{t("Apollo no entregó correo", "Apollo gave no email")}</span>}
                        <span className="src block">{st && <span className={`sig ${st[2]}`}>{es ? st[0] : st[1]}</span>} {p.linkedinUrl && <a href={p.linkedinUrl} target="_blank" rel="noopener noreferrer">LinkedIn</a>}</span>
                      </td>
                      <td><span className="src block">{t(`Apollo · reveló ${p.revealedByName} · ${i.dateShort(p.revealedAt)}`, `Apollo · revealed by ${p.revealedByName} · ${i.dateShort(p.revealedAt)}`)}</span>{p.foundWith && <span className="src block">{t("Búsqueda", "Search")}: {p.foundWith}</span>}</td>
                      <td className="n">
                        {p.contactId ? (
                          <span className="row" style={{ justifyContent: "flex-end" }}><span className="sig ok">{t("En Contactos", "In Contacts")}</span>{p.accountId && <Link className="small" href={`/accounts/${p.accountId}`}>{t("Abrir cliente", "Open customer")}</Link>}</span>
                        ) : p.status === "DISMISSED" ? (
                          <form action={setProspectStatus.bind(null, p.id)}><input type="hidden" name="back" value={back} /><input type="hidden" name="to" value="NEW" /><button type="submit" className="link small">{t("Recuperar", "Restore")}</button></form>
                        ) : (
                          <span className="row" style={{ justifyContent: "flex-end" }}>
                            <form action={addToMarket.bind(null, p.id)}><input type="hidden" name="back" value={back} /><button type="submit" className="sm">{t("Pasar a Clientes y Contactos", "Pass to Customers and Contacts")}</button></form>
                            <form action={setProspectStatus.bind(null, p.id)}><input type="hidden" name="back" value={back} /><input type="hidden" name="to" value="DISMISSED" /><button type="submit" className="link small">{t("Descartar", "Dismiss")}</button></form>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="small" style={{ marginTop: 10 }}><Link href={qs({ descartados: showDismissed ? "" : "1" }) + "#prospectos"}>{showDismissed ? t("Ocultar los descartados", "Hide dismissed") : t("Ver también los descartados", "Show dismissed too")}</Link></p>
      </section>

      <p className="src">{t("SOLU nunca pide a Apollo correos personales ni teléfonos. Al contactar a alguien por primera vez conviene decir de dónde salió su dato y ofrecer no volver a escribir.", "SOLU never asks Apollo for personal emails or phone numbers. When contacting someone for the first time it is worth saying where their data came from and offering not to write again.")}</p>
    </>
  );
}
