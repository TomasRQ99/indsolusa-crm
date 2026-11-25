import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { canManageAll } from "@/lib/permissions";
import { aiConfigured, aiSpentThisMonth, aiUsageByFeature, monthlyCap } from "@/lib/ai";
import { testAiConnection } from "./actions";

// Inteligencia artificial: is the company's AI key connected, does it work, how much it has spent this month, and
// which options it turns on. The key itself is never shown or typed here: it lives in Render → Environment.

const FEATURES: { keys: string[]; es: string; en: string; whereEs: string; whereEn: string; href: string }[] = [
  { keys: ["NEED_DRAFT"], es: "Crear Necesidad con IA", en: "Create Need with AI", whereEs: "COMERCIAL → Necesidades · Nueva Necesidad", whereEn: "COMMERCIAL → Needs · New Need", href: "/deals" },
  { keys: ["PART_PHOTO"], es: "Buscar por foto", en: "Search by photo", whereEs: "MERCADO → Localizar repuestos", whereEn: "MARKET → Find parts", href: "/localizar" },
  { keys: ["mail-progress", "mail-offer"], es: "Redactar con IA (avance de la solicitud y envío de la cotización)", en: "Draft with AI (request progress and sending the quotation)", whereEs: "En el correo, desde la Necesidad o la cotización", whereEn: "On the email, from the Need or the quotation", href: "/cotizaciones" },
  { keys: ["mail-delay"], es: "Proponer con IA (aviso de retraso)", en: "Propose with AI (delay notice)", whereEs: "En una Necesidad atrasada · Aviso de retraso", whereEn: "On a late Need · Delay notice", href: "/mi-dia" },
  { keys: ["VISIT_DRAFT"], es: "Borrador con IA (resultado de una visita)", en: "AI draft (visit outcome)", whereEs: "COMERCIAL → Visitas → una visita", whereEn: "COMMERCIAL → Visits → a visit", href: "/visitas" },
];

export default async function AiPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; msg?: string }> }) {
  const [sp, user] = await Promise.all([searchParams, requireUser()]);
  const i = makeI18n(user.lang);
  const { t } = i;
  const can = canManageAll(user) || user.role === "ADMINISTRACION";
  const on = aiConfigured();
  const cap = monthlyCap();
  const [spent, usage] = await Promise.all([aiSpentThisMonth(), aiUsageByFeature()]);
  const paused = on && spent.usd + 0.1 > cap;
  const usd = (v: number) => `USD ${v.toFixed(2)}`;
  const of = (keys: string[]) => usage.filter((u) => keys.includes(u.feature)).reduce((a, u) => ({ calls: a.calls + u.calls, usd: a.usd + u.usd }), { calls: 0, usd: 0 });
  const test = of(["PING"]);
  const errs: Record<string, string> = {
    permiso: t("La prueba la hacen Gerencia, Dirección Comercial o Administración.", "The test is run by Management, the Commercial Director or Administration."),
    OFF: t("No hay llave conectada en este servidor. Sigue los pasos de «Cómo conectar la llave», abajo.", "No key is connected on this server. Follow the steps under “How to connect the key”, below."),
    CAP: t("La IA está en pausa: ya se gastó el tope de este mes. Vuelve sola el primer día del mes, o Gerencia sube el tope en Render (AI_MONTHLY_CAP_USD).", "AI is paused: this month's cap has been spent. It comes back by itself on the first day of the month, or Management raises the cap in Render (AI_MONTHLY_CAP_USD)."),
    AUTH: t("Anthropic no aceptó la llave. Suele ser una llave mal copiada, borrada o de otra cuenta: crea una nueva en la consola de Anthropic y pégala completa en Render.", "Anthropic did not accept the key. It is usually a key that was copied badly, deleted or from another account: create a new one in the Anthropic console and paste all of it in Render."),
    RATE: t("Anthropic dice que hay demasiadas solicitudes en este momento. Espera un minuto y prueba de nuevo.", "Anthropic says there are too many requests right now. Wait a minute and test again."),
    REFUSED: t("La IA respondió, pero rechazó la prueba. La llave funciona; prueba de nuevo.", "AI answered, but declined the test. The key works; test again."),
    BAD_OUTPUT: t("La IA respondió, pero la respuesta llegó incompleta. La llave funciona; prueba de nuevo.", "AI answered, but the answer arrived incomplete. The key works; test again."),
    API: t("La llave está puesta, pero Anthropic no completó la prueba. Lo más común es que la cuenta no tenga saldo: revisa «Billing» en la consola de Anthropic.", "The key is set, but Anthropic did not complete the test. Most often the account has no credit: check “Billing” in the Anthropic console."),
  };

  return (
    <>
      <div className="ph"><div><h1>{t("Inteligencia artificial", "Artificial intelligence")}</h1><p>{t("Si la llave de IA de la empresa está conectada, si funciona, cuánto ha gastado este mes y qué opciones enciende. La IA solo prepara borradores: una persona siempre revisa antes de guardar o enviar.", "Whether the company's AI key is connected, whether it works, how much it has spent this month and which options it turns on. AI only prepares drafts: a person always reviews before saving or sending.")}</p></div></div>
      {sp.ok === "prueba" && <div className="note okn" role="status">{t("La prueba salió bien: la llave funciona y las opciones de IA están encendidas.", "The test went well: the key works and the AI options are on.")}</div>}
      {sp.err && errs[sp.err] && <div className="note risk" role="alert">{errs[sp.err]}{sp.msg && (sp.err === "API" || sp.err === "AUTH") ? <span className="src block">{t("Anthropic respondió: ", "Anthropic answered: ")}{sp.msg}</span> : null}</div>}

      <section className="sum">
        <div data-tone={on && !paused ? "ok" : "attn"}><span className="k">{t("Llave de IA", "AI key")}</span><span className="v">{!on ? t("Sin conectar", "Not connected") : paused ? t("En pausa", "Paused") : t("Conectada", "Connected")}</span><span className="s">{!on ? t("las opciones de IA están apagadas", "the AI options are off") : paused ? t("se gastó el tope del mes", "the month's cap was spent") : t("las opciones de IA están encendidas", "the AI options are on")}</span></div>
        <div><span className="k">{t("Gastado este mes", "Spent this month")}</span><span className="v">{usd(spent.usd)}</span><span className="s">{t(`${spent.calls} uso(s)`, `${spent.calls} use(s)`)}</span></div>
        <div><span className="k">{t("Tope del mes", "Month's cap")}</span><span className="v">{usd(cap)}</span><span className="s">{t("al llegar, la IA se pausa hasta el mes siguiente", "on reaching it, AI pauses until next month")}</span></div>
      </section>

      <section className="jblock loc-sec">
        <div className="jbh"><b>{t("PRUEBA DE LA LLAVE", "KEY TEST")}</b></div>
        {can ? (
          <form action={testAiConnection} className="qa-row" style={{ alignItems: "center", flexWrap: "wrap" }}>
            <button type="submit" disabled={!on} style={{ flex: "0 0 auto" }}>{t("Probar la conexión", "Test the connection")}</button>
            <span className="src" style={{ flex: "1 1 320px" }}>{on ? t("Hace una pregunta mínima a la IA con la llave de la empresa. Cuesta menos de un centavo de dólar y queda en la tabla de abajo.", "It asks AI one minimal question with the company's key. It costs less than one US cent and shows in the table below.") : t("Primero conecta la llave: los pasos están abajo.", "Connect the key first: the steps are below.")}</span>
          </form>
        ) : <p className="src">{errs.permiso}</p>}
      </section>

      <section className="jblock loc-sec">
        <div className="jbh"><b>{t("QUÉ ENCIENDE LA LLAVE", "WHAT THE KEY TURNS ON")}</b><span className="grow" /><span className="src">{t("uso de este mes", "this month's use")}</span></div>
        <div className="tscroll"><table>
          <thead><tr><th>{t("Opción", "Option")}</th><th>{t("Dónde está", "Where it is")}</th><th className="n">{t("Usos", "Uses")}</th><th className="n">{t("Costo", "Cost")}</th></tr></thead>
          <tbody>
            {FEATURES.map((f) => { const u = of(f.keys); return (
              <tr key={f.keys[0]}><td><Link href={f.href}>{t(f.es, f.en)}</Link></td><td>{t(f.whereEs, f.whereEn)}</td><td className="n">{u.calls || "—"}</td><td className="n">{u.calls ? usd(u.usd) : "—"}</td></tr>
            ); })}
            {test.calls > 0 && <tr><td>{t("Pruebas de conexión", "Connection tests")}</td><td>{t("Esta página", "This page")}</td><td className="n">{test.calls}</td><td className="n">{usd(test.usd)}</td></tr>}
          </tbody>
        </table></div>
        <p className="src">{t("El costo es una cuenta de SOLU con los precios públicos de Anthropic; la factura real está en la consola de Anthropic.", "The cost is SOLU's own count at Anthropic's public prices; the real bill is in the Anthropic console.")}</p>
      </section>

      <section className="jblock loc-sec">
        <div className="jbh"><b>{t("CÓMO CONECTAR LA LLAVE", "HOW TO CONNECT THE KEY")}</b></div>
        <ol className="ia-steps">
          <li>{t("En platform.claude.com, crea la cuenta de la empresa, agrega saldo en «Billing» y crea una llave en «API keys». Cópiala completa: empieza por sk-ant-.", "At platform.claude.com, create the company's account, add credit under “Billing” and create a key under “API keys”. Copy all of it: it starts with sk-ant-.")}</li>
          <li>{t("En Render, abre el servicio de SOLU y «Environment». En la variable ANTHROPIC_API_KEY pega la llave y guarda. Render reinicia SOLU en unos minutos.", "In Render, open the SOLU service and “Environment”. Paste the key into the ANTHROPIC_API_KEY variable and save. Render restarts SOLU in a few minutes.")}</li>
          <li>{t("Vuelve a esta página y haz clic en «Probar la conexión».", "Come back to this page and click “Test the connection”.")}</li>
        </ol>
        <p className="src">{t("La llave es como una contraseña con saldo: nunca la pegues en un correo, un chat o una pantalla de SOLU. El tope del mes se cambia en Render, en la variable AI_MONTHLY_CAP_USD.", "The key is like a password with credit: never paste it into an email, a chat or a SOLU screen. The month's cap is changed in Render, in the AI_MONTHLY_CAP_USD variable.")}</p>
      </section>
    </>
  );
}
