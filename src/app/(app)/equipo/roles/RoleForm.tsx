import type { I18n } from "@/lib/i18n";
import { dayInput, today } from "@/lib/domain";
import { ROLE_LABEL, WORK_ROLES } from "@/lib/permissions";
import { FUNCTIONS, FUNCTION_KEYS } from "@/lib/gerencia-rules";
import { AUTHORITY, COMMITMENT_KINDS, COMPETENCY_KINDS, DECISION_KINDS, PERFORMANCE_KINDS, RHYTHM_KINDS, kindedText, levelsText, type RoleProfileData } from "@/lib/team-rules";
import { publishRole } from "../role-actions";

// Módulo 16 §20 · the form of a role agreement, in the order of the eighteen fields. One item per line. Publishing
// writes a new version; nothing already published is edited.

export function RoleForm({ i, p, isNew, missing, principles }: { i: I18n; p: RoleProfileData | null; isNew: boolean; missing: Set<string>; principles: string[] }) {
  const { t, es } = i;
  const red = (k: string) => (missing.has(k) ? { style: { borderColor: "var(--risk)" } } : {});
  const lines = (xs: string[] | undefined) => (xs ?? []).join("\n");
  const ofKind = (xs: { kind: string; text: string }[] | undefined, k: string) => (xs ?? []).filter((x) => x.kind === k).map((x) => x.text).join("\n");
  const Area = ({ name, label, value, rows = 3, hint, required, ph }: { name: string; label: string; value: string; rows?: number; hint?: string; required?: boolean; ph?: string }) => (
    <label>{label}{hint ? <span className="src"> {hint}</span> : null}<textarea name={name} rows={rows} maxLength={6000} defaultValue={value} required={required} placeholder={ph} {...red(name)} /></label>
  );
  const one = t("una por línea", "one per line");

  return (
    <form action={publishRole} className="qa-form">
      <input type="hidden" name="mode" value={isNew ? "new" : "version"} />
      {!isNew && p ? <input type="hidden" name="roleKey" value={p.roleKey} /> : null}
      <div className="qa-row">
        <label style={{ flex: "2 1 240px" }}>{t("Nombre del rol", "Role name")}<input name="title" required maxLength={120} defaultValue={p?.title ?? ""} {...red("title")} /></label>
        <label>{t("Función", "Function")}<select name="functionKey" defaultValue={p?.functionKey ?? "COMERCIAL"} {...red("functionKey")}>{FUNCTION_KEYS.map((k) => <option key={k} value={k}>{es ? FUNCTIONS[k].es : FUNCTIONS[k].en}</option>)}</select></label>
        <label>{t("Rol de acceso en SOLU que le corresponde", "Matching access role in SOLU")}<select name="soluRole" defaultValue={p?.soluRole ?? ""}><option value="">{t("Ninguno en particular", "None in particular")}</option>{WORK_ROLES.map((r) => <option key={r} value={r}>{es ? ROLE_LABEL[r].es : ROLE_LABEL[r].en}</option>)}</select></label>
      </div>
      <label className="chk"><input type="checkbox" name="critical" value="1" defaultChecked={p?.critical ?? false} /> {t("Rol crítico: si queda sin un respaldo calificado, SOLU lo muestra como riesgo de continuidad", "Critical role: with no qualified backup, SOLU shows it as a continuity risk")}</label>

      <Area name="purpose" label={t("1 · Propósito: para qué existe el rol", "1 · Purpose: what the role exists for")} value={p?.purpose ?? ""} rows={2} required />
      <div className="eq-form-grid">
        <Area name="outcomes" label={t("2 · Resultados que debe producir", "2 · Outcomes it must produce")} hint={one} value={lines(p?.outcomes)} required />
        <Area name="functions" label={t("3 · Funciones: actividades recurrentes principales", "3 · Functions: main recurring activities")} hint={one} value={lines(p?.functions)} />
      </div>
      <Area name="responsibilities" label={t("4 · Responsabilidades: aquello por lo que responde, aunque otra persona ejecute una parte", "4 · Responsibilities: what it answers for, even if someone else does a part")} hint={one} value={lines(p?.responsibilities)} required />

      <p className="small" {...(missing.has("decisionRights") ? { style: { color: "var(--risk)" } } : {})}><b>{t("5 · Qué puede decidir", "5 · Decision rights")}</b> <span className="src">{t("al menos una decisión en alguno de los tres grupos", "at least one decision in any of the three groups")}</span></p>
      <div className="eq-cols3">
        {Object.keys(DECISION_KINDS).map((k) => <Area key={k} name={`decision_${k}`} label={es ? DECISION_KINDS[k].es : DECISION_KINDS[k].en} hint={one} value={ofKind(p?.decisionRights, k)} />)}
      </div>
      <fieldset style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "8px 12px" }}>
        <legend className="small">{t("Autoridad que el rol necesita en SOLU", "Authority the role needs in SOLU")}</legend>
        <div className="eq-cols">{Object.entries(AUTHORITY).map(([k, x]) => <label key={k} className="chk"><input type="checkbox" name="authorityDomains" value={k} defaultChecked={p?.authorityDomains.includes(k) ?? false} /> {es ? x.es : x.en}</label>)}</div>
        <p className="src">{t("Marcarla aquí no la concede: quién aprueba qué lo deciden las políticas. SOLU avisa cuando el acuerdo pide algo que las políticas no le dan a ese rol.", "Ticking it here does not grant it: who approves what is decided by the policies. SOLU tells you when the agreement asks for something the policies do not give that role.")}</p>
      </fieldset>
      <Area name="boundaries" label={t("6 · Límites: qué no puede decidir ni comprometer", "6 · Boundaries: what it may not decide or commit")} hint={one} value={lines(p?.boundaries)} required />
      <div className="eq-form-grid">
        <Area name="inputs" label={t("7 · Qué recibe", "7 · What it receives")} hint={one} value={lines(p?.inputs)} />
        <Area name="outputs" label={t("7 · Qué debe entregar", "7 · What it must deliver")} hint={one} value={lines(p?.outputs)} />
        <Area name="customers_INTERNAL" label={t("8 · Clientes internos", "8 · Internal customers")} hint={t("«A quién: qué espera», uno por línea", "“Whom: what they expect”, one per line")} value={(p?.customers ?? []).filter((c) => c.kind === "INTERNAL").map((c) => `${c.who}${c.expects ? `: ${c.expects}` : ""}`).join("\n")} ph={t("Operaciones: la orden aceptada con su promesa validada", "Operations: the accepted order with its validated promise")} />
        <Area name="customers_EXTERNAL" label={t("8 · Clientes externos", "8 · External customers")} hint={t("«A quién: qué espera», uno por línea", "“Whom: what they expect”, one per line")} value={(p?.customers ?? []).filter((c) => c.kind === "EXTERNAL").map((c) => `${c.who}${c.expects ? `: ${c.expects}` : ""}`).join("\n")} />
      </div>
      <Area name="qualityStandards" label={t("9 · Estándares de calidad: cómo se ve «bien hecho»", "9 · Quality standards: what “well done” looks like")} hint={one} value={lines(p?.qualityStandards)} />
      <Area name="behaviors" label={t("10 · Conductas esperadas: principios y valores traducidos a este rol", "10 · Expected behaviours: principles and values translated to this role")} hint={t("«Principio: conducta que se puede observar», una por línea", "“Principle: conduct that can be observed”, one per line")} rows={5} value={(p?.behaviors ?? []).map((b) => `${b.principle}: ${b.conduct}`).join("\n")} ph={t("Verdad: no prometer fecha sin validación operativa", "Truth: never promise a date without operational validation")} />
      {principles.length > 0 && <p className="src">{t("Principios de la identidad vigente", "Principles of the identity in force")}: {principles.join(" · ")}. {t("Se escriben conductas, nunca calificaciones.", "Write conduct, never ratings.")}</p>}
      <Area name="methodologies" label={t("Metodologías que aplican a este rol", "Methodologies that apply to this role")} hint={one} rows={2} value={lines(p?.methodologies)} />

      <p className="small"><b>{t("11 · Expectativas de desempeño", "11 · Performance expectations")}</b></p>
      <div className="eq-form-grid">{Object.keys(PERFORMANCE_KINDS).map((k) => <Area key={k} name={`performance_${k}`} label={es ? PERFORMANCE_KINDS[k].es : PERFORMANCE_KINDS[k].en} hint={one} rows={2} value={ofKind(p?.performance, k)} />)}</div>
      <Area name="competencies" label={t("12 · Competencias requeridas", "12 · Required competencies")} hint={t("«Tipo: competencia», una por línea. Tipos: Técnica, Comercial, Relacional, Gestión, Liderazgo", "“Kind: competency”, one per line. Kinds: Technical, Commercial, Relational, Management, Leadership")} value={kindedText(p?.competencies ?? [], COMPETENCY_KINDS, es)} />
      <Area name="risks" label={t("13 · Riesgos del rol: fallas típicas que afectan al cliente, la Eságara, el cumplimiento, los recursos o el equipo", "13 · Role risks: typical failures that affect the customer, Eságara, fulfilment, resources or the team")} hint={one} value={lines(p?.risks)} />
      <p className="small"><b>{t("14 · Ritmo del rol", "14 · Role rhythm")}</b></p>
      <div className="eq-form-grid">{Object.keys(RHYTHM_KINDS).map((k) => <Area key={k} name={`rhythm_${k}`} label={es ? RHYTHM_KINDS[k].es : RHYTHM_KINDS[k].en} hint={one} rows={2} value={ofKind(p?.rhythm, k)} />)}</div>
      <div className="eq-form-grid">
        <Area name="successSignals" label={t("15 · Lo estás haciendo bien cuando…", "15 · You are doing well when…")} hint={one} value={lines(p?.successSignals)} />
        <Area name="attentionSignals" label={t("16 · Necesita atención cuando…", "16 · It needs attention when…")} hint={one} value={lines(p?.attentionSignals)} />
      </div>
      <Area name="careerLevels" label={t("17 · Ruta del rol por niveles", "17 · Route of the role by levels")} hint={t("«Nivel | SER | HACER | TENER», uno por línea, del primero al último", "“Level | BE | DO | HAVE”, one per line, first to last")} value={levelsText(p?.careerLevels ?? [])} ph="Junior | … | … | …" />
      <Area name="careerExpectations" label={t("17 · Evidencia que muestra que alguien está listo para el siguiente nivel", "17 · Evidence that shows someone is ready for the next level")} hint={one} value={lines(p?.careerExpectations)} />
      <Area name="companyCommitments" label={t("18 · Compromisos de la compañía con el rol", "18 · Company commitments to the role")} hint={t("«Tipo: qué provee», uno por línea. Tipos: Herramienta, Información, Autoridad, Formación, Acompañamiento", "“Kind: what it provides”, one per line. Kinds: Tool, Information, Authority, Training, Support")} value={kindedText(p?.companyCommitments ?? [], COMMITMENT_KINDS, es)} />

      <div className="qa-row">
        <label>{t("Rige desde", "In force from")}<input type="date" name="effectiveFrom" required defaultValue={dayInput(today())} {...red("effectiveFrom")} /></label>
        <label style={{ flex: 3 }}>{isNew ? t("Por qué se crea", "Why it is created") : t("Por qué cambia", "Why it changes")}<input name="reason" required maxLength={1000} {...red("reason")} /></label>
      </div>
      <div><button type="submit">{isNew ? t("Publicar el acuerdo de rol", "Publish the role agreement") : t("Publicar como versión nueva", "Publish as a new version")}</button> <span className="src">{t("Se puede publicar con campos por completar: quedan señalados hasta que una versión nueva los traiga.", "It can be published with fields still to complete: they stay flagged until a new version brings them.")}</span></div>
    </form>
  );
}
