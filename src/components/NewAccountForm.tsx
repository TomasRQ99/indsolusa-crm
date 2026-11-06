"use client";

import { useRef, useState } from "react";

type Fields = { name?: string; tradeName?: string; taxId?: string; address?: string; city?: string; department?: string; phone?: string; email?: string; ciiu?: string };
type Read = { file: string; kind: "RUT" | "CAMARA" | "OTHER"; fields: Fields; readable: boolean; nitMismatch?: boolean; state: "reading" | "done" | "error" | "skipped" };

const MAX = 5 * 1024 * 1024;
const MAX_TOTAL = 24 * 1024 * 1024;
const FILL = ["name", "taxId", "address", "phone", "billingContact"] as const;
type FillKey = (typeof FILL)[number];

// "Nuevo cliente": the RUT and the company's documents. When a document is a
// readable PDF (RUT or Cámara de Comercio), SOLU fills the empty boxes with what it
// found and marks them, so the person reviews before creating. Nothing typed by
// the person is overwritten.
export function NewAccountForm({ action, lang }: { action: (fd: FormData) => void | Promise<void>; lang: "ES" | "EN" }) {
  const es = lang === "ES";
  const t = (a: string, b: string) => (es ? a : b);
  const form = useRef<HTMLFormElement>(null);
  const [reads, setReads] = useState<Read[]>([]);
  const [filled, setFilled] = useState<Partial<Record<FillKey, string>>>({});
  const [sizeErr, setSizeErr] = useState("");

  const kindLabel = (k: Read["kind"]) => (k === "RUT" ? "RUT" : k === "CAMARA" ? t("Cámara de Comercio", "Chamber of Commerce") : t("Documento", "Document"));

  const apply = (fields: Fields, source: string) => {
    const f = form.current;
    if (!f) return;
    const address = [fields.address, fields.city, fields.department && fields.department !== fields.city ? fields.department : undefined].filter(Boolean).join(", ");
    const values: Record<FillKey, string | undefined> = { name: fields.name ?? fields.tradeName, taxId: fields.taxId, address: address || undefined, phone: fields.phone, billingContact: fields.email };
    const marked: Partial<Record<FillKey, string>> = {};
    for (const k of FILL) {
      const el = f.elements.namedItem(k) as HTMLInputElement | null;
      const v = values[k];
      if (!el || !v || el.value.trim()) continue;
      el.value = v;
      marked[k] = source;
    }
    setFilled((prev) => ({ ...prev, ...marked }));
  };

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.currentTarget.files ?? []);
    const total = files.reduce((s, f) => s + f.size, 0);
    if (files.some((f) => f.size > MAX) || total > MAX_TOTAL || files.length > 6) {
      setSizeErr(t("Máximo 6 archivos, 5 MB cada uno.", "Up to 6 files, 5 MB each."));
      e.currentTarget.value = "";
      setReads([]);
      return;
    }
    setSizeErr("");
    setReads(files.map((f) => ({ file: f.name, kind: "OTHER", fields: {}, readable: false, state: f.type === "application/pdf" ? "reading" : "skipped" })));
    await Promise.all(
      files.map(async (file, i) => {
        if (file.type !== "application/pdf") return;
        try {
          const body = new FormData();
          body.append("file", file);
          const res = await fetch("/accounts/leer-documento", { method: "POST", body });
          const r = (await res.json()) as { kind: Read["kind"]; fields: Fields; readable: boolean; nitMismatch?: boolean };
          setReads((prev) => prev.map((x, k) => (k === i ? { ...x, ...r, state: "done" } : x)));
          apply(r.fields ?? {}, r.kind === "RUT" ? "RUT" : r.kind === "CAMARA" ? t("Cámara", "Chamber") : file.name);
        } catch {
          setReads((prev) => prev.map((x, k) => (k === i ? { ...x, state: "error" } : x)));
        }
      }),
    );
  };

  const tag = (k: FillKey) => (filled[k] ? <span className="nac-tag" title={t("Leído del documento. Revísalo.", "Read from the document. Please check it.")}>{t("del", "from")} {filled[k]}</span> : null);
  const clearTag = (k: FillKey) => () => filled[k] && setFilled((p) => ({ ...p, [k]: undefined }));

  return (
    <form ref={form} action={action} className="nac">
      <div className="nac-docs">
        <label className="nac-drop">
          <b>{t("Documentos del cliente", "Customer documents")}</b>
          <span className="src">{t("RUT, Cámara de Comercio u otros (PDF o foto, hasta 5 MB). Si el PDF es el descargado de la DIAN o de la Cámara, SOLU llena las casillas por ti.", "RUT, Chamber of Commerce or others (PDF or photo, up to 5 MB). If the PDF was downloaded from DIAN or the Chamber, SOLU fills in the boxes for you.")}</span>
          <input type="file" name="docs" multiple accept="application/pdf,image/jpeg,image/png,image/webp" onChange={onFiles} />
        </label>
        {sizeErr && <p className="attn-t small" role="alert">{sizeErr}</p>}
        {reads.length > 0 && (
          <ul className="nac-reads" aria-live="polite">
            {reads.map((r, i) => (
              <li key={i}>
                <b>{r.file}</b>{" · "}
                {r.state === "reading" && t("leyendo…", "reading…")}
                {r.state === "skipped" && t("se guardará; las fotos no se leen automáticamente", "will be saved; photos aren't read automatically")}
                {r.state === "error" && t("no se pudo leer; se guardará igual", "couldn't be read; it will still be saved")}
                {r.state === "done" && (Object.keys(r.fields).length
                  ? <>{kindLabel(r.kind)}: {t("encontramos", "found")} {[r.fields.name && t("razón social", "legal name"), r.fields.taxId && "NIT", r.fields.address && t("dirección", "address"), r.fields.phone && t("teléfono", "phone"), r.fields.email && t("correo", "email"), r.fields.ciiu && `CIIU ${r.fields.ciiu}`].filter(Boolean).join(", ")}{r.nitMismatch && <span className="attn-t"> · {t("el dígito de verificación del NIT no cuadra: revísalo", "the NIT check digit doesn't match: check it")}</span>}</>
                  : r.readable ? t("no encontramos datos de empresa; se guardará igual", "no company data found; it will still be saved") : t("parece un escaneo sin texto; llena las casillas a mano (se guardará igual)", "looks like a scan without text; fill the boxes by hand (it will still be saved)"))}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="nac-grid">
        <label><span className="nac-l">{t("Razón social", "Legal name")}{tag("name")}</span><input name="name" required onInput={clearTag("name")} /></label>
        <label><span className="nac-l">{t("RUT / NIT", "Tax ID (RUT / NIT)")}{tag("taxId")}</span><input name="taxId" placeholder="900123456-7" onInput={clearTag("taxId")} /></label>
        <label>{t("Industria", "Industry")}<input name="industry" /></label>
        <label><span className="nac-l">{t("Teléfono", "Phone")}{tag("phone")}</span><input name="phone" onInput={clearTag("phone")} /></label>
        <label className="wide"><span className="nac-l">{t("Dirección", "Address")}{tag("address")}</span><input name="address" onInput={clearTag("address")} /></label>
        <label><span className="nac-l">{t("Correo para facturas", "Invoice email")}{tag("billingContact")}</span><input name="billingContact" type="email" onInput={clearTag("billingContact")} /></label>
        <label>{t("Sitio web", "Website")}<input name="website" type="url" placeholder="https://" /></label>
      </div>
      {Object.values(filled).some(Boolean) && <p className="src">{t("Las casillas marcadas se llenaron desde el documento. Revísalas antes de crear.", "Marked boxes were filled from the document. Check them before creating.")}</p>}
      <div><button type="submit">{t("Crear cliente", "Create customer")}</button></div>
    </form>
  );
}
