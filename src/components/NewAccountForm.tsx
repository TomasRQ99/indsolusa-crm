"use client";

import { useRef, useState } from "react";
import { COUNTRIES, DIAL_CODES, countryOf, dvMismatch, looksLikeEmail, splitTaxId, tidyWebsite } from "@/lib/customer-fields";

type Fields = { name?: string; tradeName?: string; taxId?: string; address?: string; city?: string; department?: string; phone?: string; email?: string; ciiu?: string };
type Read = { file: string; kind: "RUT" | "CAMARA" | "OTHER"; fields: Fields; readable: boolean; nitMismatch?: boolean; state: "reading" | "done" | "error" | "skipped" };

const MAX = 5 * 1024 * 1024;
const MAX_TOTAL = 24 * 1024 * 1024;
const FILL = ["name", "taxId", "taxDv", "address", "city", "region", "phone", "billingContact"] as const;
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
  // Colombia first: most customers are there. Choosing another country also changes the phone code, until the person picks one.
  const [country, setCountry] = useState("CO");
  const [dial, setDial] = useState("+57");
  const [dialSet, setDialSet] = useState(false);
  const [cDial, setCDial] = useState("+57");
  const [cDialSet, setCDialSet] = useState(false);
  const [taxId, setTaxId] = useState("");
  const [dv, setDv] = useState("");
  const [cEmail, setCEmail] = useState("");
  const [bEmail, setBEmail] = useState("");
  const [web, setWeb] = useState("");
  // What a document wrote in each box and how much that document is trusted (RUT 3, Cámara 2, others 1).
  const auto = useRef<Partial<Record<FillKey, { v: string; rank: number }>>>({});
  const softMail = (v: string) => !!v.trim() && !looksLikeEmail(v);
  const pickCountry = (code: string) => {
    setCountry(code);
    const d = countryOf(code)?.dial;
    if (d && !dialSet) setDial(d);
    if (d && !cDialSet) setCDial(d);
  };
  // "900123456-7" typed or pasted in one piece: the last digit goes to its own box.
  const tidyTaxId = () => {
    const s = splitTaxId(taxId);
    if (s.dv) { setTaxId(s.base); if (!dv) setDv(s.dv); }
  };
  const wrongDv = country === "CO" && dvMismatch(taxId, dv);

  const kindLabel = (k: Read["kind"]) => (k === "RUT" ? "RUT" : k === "CAMARA" ? t("Cámara de Comercio", "Chamber of Commerce") : t("Documento", "Document"));

  const apply = (fields: Fields, source: string, rank: number) => {
    const f = form.current;
    if (!f) return;
    const nit = splitTaxId(fields.taxId);
    const values: Record<FillKey, string | undefined> = { name: fields.name ?? fields.tradeName, taxId: nit.base || undefined, taxDv: nit.dv || undefined, address: fields.address, city: fields.city, region: fields.department, phone: fields.phone, billingContact: fields.email };
    const marked: Partial<Record<FillKey, string>> = {};
    for (const k of FILL) {
      const el = f.elements.namedItem(k) as HTMLInputElement | null;
      const v = values[k];
      if (!el || !v) continue;
      // Fill an empty box, or replace what a less trusted document wrote if the person hasn't touched it. Never what the person typed.
      const prev = auto.current[k];
      const mine = !!prev && el.value === prev.v && rank > prev.rank;
      if (el.value.trim() && !mine) continue;
      if (k === "taxId") setTaxId(v);
      else if (k === "taxDv") setDv(v);
      else if (k === "billingContact") setBEmail(v);
      else el.value = v;
      auto.current[k] = { v, rank };
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
          apply(r.fields ?? {}, r.kind === "RUT" ? "RUT" : r.kind === "CAMARA" ? t("Cámara", "Chamber") : file.name, r.kind === "RUT" ? 3 : r.kind === "CAMARA" ? 2 : 1);
          // A RUT or a Cámara de Comercio certificate only exists for companies registered in Colombia.
          if (r.kind !== "OTHER") pickCountry("CO");
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
      <p className="nac-h">{t("Empresa", "Company")}</p>
      <div className="nac-grid">
        <label className="wide"><span className="nac-l">{t("Razón social", "Legal name")}{tag("name")}</span><input name="name" required onInput={clearTag("name")} /></label>
        <div className="nac-f">
          <span className="nac-l">{t("RUT / NIT", "Tax ID (RUT / NIT)")}{tag("taxId")}</span>
          <div className="nac-pair dv">
            <input name="taxId" aria-label={t("RUT / NIT", "Tax ID (RUT / NIT)")} placeholder="900123456" value={taxId} onChange={(e) => { setTaxId(e.currentTarget.value); clearTag("taxId")(); }} onBlur={tidyTaxId} />
            <input name="taxDv" className="nac-dv" inputMode="numeric" maxLength={1} placeholder="DV" aria-label={t("Dígito de verificación (opcional)", "Check digit (optional)")} title={t("Dígito de verificación del NIT en Colombia. Es opcional.", "Check digit of the NIT in Colombia. Optional.")} value={dv} onChange={(e) => { setDv(e.currentTarget.value.replace(/\D/g, "").slice(0, 1)); clearTag("taxDv")(); }} />
          </div>
          <span className={wrongDv ? "attn-t small" : "src"} role={wrongDv ? "alert" : undefined}>{wrongDv ? t("El dígito de verificación no cuadra con el NIT. Revisa los dos números.", "The check digit doesn't match the NIT. Check both numbers.") : t("DV: dígito de verificación, opcional (Colombia).", "DV: check digit, optional (Colombia).")}</span>
        </div>
        <label>{t("Industria", "Industry")}<input name="industry" /></label>
        <label>{t("Sitio web", "Website")}<input name="website" inputMode="url" autoCapitalize="none" placeholder="www.empresa.com" value={web} onChange={(e) => setWeb(e.currentTarget.value)} onBlur={() => setWeb((v) => (tidyWebsite(v) ?? "").replace(/^https:\/\//, ""))} /><span className="src">{t("Escríbelo como lo conozcas, por ejemplo www.empresa.com. SOLU lo acomoda.", "Type it as you know it, for example www.company.com. SOLU tidies it.")}</span></label>
      </div>

      <p className="nac-h">{t("Ubicación", "Location")}</p>
      <div className="nac-grid">
        <label>{t("País", "Country")}
          <select name="country" value={country} onChange={(e) => pickCountry(e.currentTarget.value)}>
            <option value="">{t("— sin definir —", "— not set —")}</option>
            {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{es ? c.es : c.en}</option>)}
          </select>
        </label>
        <label><span className="nac-l">{t("Departamento / Estado", "State / Department")}{tag("region")}</span><input name="region" onInput={clearTag("region")} /></label>
        <label><span className="nac-l">{t("Ciudad", "City")}{tag("city")}</span><input name="city" onInput={clearTag("city")} /></label>
        <label>{t("Código postal", "Postal code")}<input name="postalCode" maxLength={12} /></label>
        <label className="wide"><span className="nac-l">{t("Dirección", "Address")}{tag("address")}</span><input name="address" placeholder={t("Calle y número, sin la ciudad", "Street and number, without the city")} onInput={clearTag("address")} /></label>
      </div>

      <p className="nac-h">{t("Teléfono y correo de la empresa", "Company phone and email")}</p>
      <div className="nac-grid">
        <div className="nac-f">
          <span className="nac-l">{t("Teléfono", "Phone")}{tag("phone")}</span>
          <div className="nac-pair">
            <select name="phoneCode" aria-label={t("Indicativo del país", "Country code")} value={dial} onChange={(e) => { setDial(e.currentTarget.value); setDialSet(true); }}>
              {DIAL_CODES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <input name="phone" type="tel" aria-label={t("Número de teléfono", "Phone number")} onInput={clearTag("phone")} />
          </div>
        </div>
        <label><span className="nac-l">{t("Correo para facturas", "Invoice email")}{tag("billingContact")}</span><input name="billingContact" inputMode="email" autoCapitalize="none" placeholder="facturas@empresa.com" value={bEmail} onChange={(e) => { setBEmail(e.currentTarget.value); clearTag("billingContact")(); }} />{softMail(bEmail) && <span className="attn-t small">{t("Parece incompleto. Ejemplo: facturas@empresa.com. Puedes crear el cliente y corregirlo después.", "Looks incomplete. Example: invoices@company.com. You can create the customer and fix it later.")}</span>}</label>
      </div>

      <p className="nac-h">{t("Contacto para promociones", "Contact for promotions")} <span className="src">{t("opcional: la persona que recibirá nuestras novedades y campañas", "optional: the person who will receive our news and campaigns")}</span></p>
      <div className="nac-grid">
        <label>{t("Nombre", "First name")}<input name="contactFirstName" /></label>
        <label>{t("Apellido", "Last name")}<input name="contactLastName" /></label>
        <label>{t("Cargo", "Job title")}<input name="contactTitle" /></label>
        <label>{t("Correo de la persona", "Person's email")}<input name="contactEmail" inputMode="email" autoCapitalize="none" placeholder="nombre@empresa.com" value={cEmail} onChange={(e) => setCEmail(e.currentTarget.value)} />{softMail(cEmail) && <span className="attn-t small">{t("Parece incompleto. Ejemplo: nombre@empresa.com.", "Looks incomplete. Example: name@company.com.")}</span>}</label>
        <div className="nac-f">
          <span className="nac-l">{t("Celular", "Mobile")}</span>
          <div className="nac-pair">
            <select name="contactPhoneCode" aria-label={t("Indicativo del país del celular", "Mobile country code")} value={cDial} onChange={(e) => { setCDial(e.currentTarget.value); setCDialSet(true); }}>
              {DIAL_CODES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <input name="contactPhone" type="tel" aria-label={t("Número de celular", "Mobile number")} />
          </div>
        </div>
      </div>
      <label className="check nac-opt"><input type="checkbox" name="promoOptIn" disabled={!looksLikeEmail(cEmail)} /> <span>{t("Autorizó recibir información y promociones por correo", "Agreed to receive information and promotions by email")}<span className="src block">{t("Márcala solo si la persona lo aceptó. Sin esta autorización no se le envían campañas.", "Tick it only if the person agreed. Without this permission no campaigns are sent to them.")}</span></span></label>
      {Object.values(filled).some(Boolean) && <p className="src">{t("Las casillas marcadas se llenaron desde el documento. Revísalas antes de crear.", "Marked boxes were filled from the document. Check them before creating.")}</p>}
      <div><button type="submit">{t("Crear cliente", "Create customer")}</button></div>
    </form>
  );
}
