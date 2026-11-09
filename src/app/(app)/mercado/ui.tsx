import { CONFIDENCE, SOURCES } from "@/lib/market-rules";

type T = (es: string, en: string) => string;
type LL = { es: string; en: string } | undefined;

/** Source · reference · certainty fields, the same on every Mercado fact form. */
export function ProvFields({ t, defSource = "CONVERSATION" }: { t: T; defSource?: string }) {
  const L = (x: LL) => (x ? t(x.es, x.en) : "");
  return (
    <div className="row">
      <label>{t("Fuente", "Source")}<select name="sourceType" defaultValue={defSource}>{Object.entries(SOURCES).filter(([k]) => k !== "RULE").map(([k, v]) => <option key={k} value={k}>{L(v)}</option>)}</select></label>
      <label style={{ flex: 1 }}>{t("Referencia (quién, dónde o enlace)", "Reference (who, where or link)")}<input name="sourceRef" maxLength={300} /></label>
      <label>{t("Certeza", "Certainty")}<select name="confidence" defaultValue="REPORTED">{Object.entries(CONFIDENCE).filter(([k]) => k !== "UNKNOWN").map(([k, v]) => <option key={k} value={k}>{L(v)}</option>)}</select></label>
    </div>
  );
}

/** Certainty chip + source line. Provenance stays visible but quiet. */
export function Prov({ t, day, x }: { t: T; day: (d: Date) => string; x: { sourceType: string; sourceRef?: string | null; observedAt?: Date | null; confidence: string; capturedByName?: string | null } }) {
  const c = CONFIDENCE[x.confidence];
  const s = SOURCES[x.sourceType];
  return (
    <span className="src block"><span className={`sig ${c?.cls ?? "info"}`}>{c ? t(c.es, c.en) : x.confidence}</span> {s ? t(s.es, s.en) : x.sourceType}{x.sourceRef ? ` · ${x.sourceRef}` : ""}{x.observedAt ? ` · ${day(x.observedAt)}` : ""}{x.capturedByName ? ` · ${x.capturedByName}` : ""}</span>
  );
}

export const MSG_OK: Record<string, [string, string]> = {
  alias: ["Nombre agregado. SOLU también reconocerá a la empresa por él.", "Name added. SOLU will also recognize the company by it."],
  insight: ["Gracias. Ahora el equipo sabe un poco mejor cómo trabaja esta empresa.", "Thanks. The team now knows a bit better how this company works."],
  cambio: ["Anotado. La observación anterior queda en el historial con el motivo.", "Noted. The previous observation stays in history with the reason."],
  equipo: ["Equipo registrado.", "Equipment recorded."], impacto: ["Impacto guardado, con su base y su certeza.", "Impact saved, with its basis and certainty."],
  persona: ["Persona actualizada.", "Person updated."], pregunta: ["Pregunta anotada. Saber qué no sabemos ya es avanzar.", "Question noted. Knowing what we don't know is progress."],
  aprendido: ["Respuesta guardada con su fuente.", "Answer saved with its source."], nueva: ["Planta creada. Empieza por lo que ya sabes; lo demás puede esperar.", "Plant created. Start with what you already know; the rest can wait."],
};
export const MSG_ERR: Record<string, [string, string]> = {
  alias: ["Escribe el nombre.", "Write the name."], insight: ["Escribe la observación.", "Write the observation."],
  evidencia: ["Para «Qué valoran» necesitamos la evidencia: qué dijeron o hicieron. Así no suponemos.", "For “What they value” we need the evidence: what they said or did. That way we don't assume."],
  cambio: ["Cuéntanos en una frase qué cambió.", "Tell us in one sentence what changed."], planta: ["Escribe el nombre de la planta.", "Write the plant name."],
  equipo: ["Escribe qué equipo es.", "Write what equipment it is."], impacto: ["Di qué se detiene (línea, equipo o planta).", "Say what stops (line, equipment or plant)."],
  guiado: ["Para estimar necesitamos al menos la producción por hora y la contribución por unidad.", "To estimate we need at least production per hour and contribution per unit."],
  persona: ["Elige un contacto o escribe el nombre.", "Pick a contact or write the name."], pregunta: ["Escribe la pregunta.", "Write the question."], respuesta: ["Escribe la respuesta.", "Write the answer."],
};
