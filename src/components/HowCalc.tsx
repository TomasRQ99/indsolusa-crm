import { METRICS } from "@/lib/metric-dictionary";

// Módulo 13 §10 · "¿Cómo se calcula?" next to a figure, without leaving the screen.
export function HowCalc({ id, es }: { id: string; es: boolean }) {
  // The goal key for contacts is VALUE_CONTACTS; its dictionary entry is USEFUL_CONTACTS.
  const m = METRICS[id === "VALUE_CONTACTS" ? "USEFUL_CONTACTS" : id];
  if (!m) return null;
  const t = (x: { es: string; en: string }) => (es ? x.es : x.en);
  return (
    <details className="qa" style={{ display: "inline-block", verticalAlign: "top" }}>
      <summary className="linkb small">{es ? "¿Cómo se calcula?" : "How is it calculated?"}</summary>
      <div className="note" style={{ maxWidth: 460, marginTop: 4 }}>
        <p className="small"><b>{t(m.name)}.</b> {t(m.definition)}</p>
        <p className="small">{t(m.formula)}</p>
        <p className="src">{es ? "Fuente" : "Source"}: {t(m.source)} · {es ? "Responsable" : "Owner"}: {t(m.owner)} · {t(m.closing)} · v{m.version}</p>
      </div>
    </details>
  );
}
