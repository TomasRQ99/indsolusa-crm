"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AiNeedButton, type NeedAiFill } from "@/components/AiNeedButton";

// The first step of every order: a customer asks for something. Modelled on the team's own "Nueva Solicitud":
// customer and contact, what they need, the product or spare part (picked from what is already registered, so it
// is not typed again), the customer's machine, notes for internal use, photos, the date of the next contact, and
// the email that tells the customer we received the request.

type Opt = { id: string; name: string };
type Contact = { id: string; accountId: string; name: string; email: string | null };
type PartOpt = { code: string; name: string };
type Machine = { accountId: string; name: string };

export function NewNeedForm({ lang, action, accounts, contacts, parts, machines, defaultFollowUp, aiReady = false }: {
  lang: "ES" | "EN"; action: (fd: FormData) => void | Promise<void>;
  accounts: Opt[]; contacts: Contact[]; parts: PartOpt[]; machines: Machine[]; defaultFollowUp: string; aiReady?: boolean;
}) {
  const t = (es: string, en: string) => (lang === "EN" ? en : es);
  const [accountId, setAccountId] = useState("");
  const [contactId, setContactId] = useState("");
  const [code, setCode] = useState("");
  const [desc, setDesc] = useState("");
  const [ack, setAck] = useState(true);
  // What "Crear Necesidad con IA" understood: it only fills these boxes; the person reviews them and creates the Need.
  const [ai, setAi] = useState<NeedAiFill | null>(null);
  const useAi = (r: NeedAiFill) => {
    setAi(r); setAccountId(r.accountId ?? ""); setContactId(r.contactId ?? "");
    setCode(r.draft.itemCode ?? ""); setDesc(r.draft.itemDescription ?? "");
  };
  const g = ai?.draft;
  const bullets = (head: string, xs: string[]) => (xs.length ? [`${head}:`, ...xs.map((x) => `- ${x}`)].join("\n") : null);
  const aiNotes = g ? [g.internalNotes, bullets(t("Falta preguntar al cliente", "Still to ask the customer"), g.missing), bullets(t("Propuesta de SOLU (IA)", "SOLU's proposal (AI)"), g.plan)].filter(Boolean).join("\n\n").slice(0, 2000) : "";
  const mine = useMemo(() => contacts.filter((c) => c.accountId === accountId), [contacts, accountId]);
  const myMachines = useMemo(() => [...new Set(machines.filter((m) => m.accountId === accountId).map((m) => m.name))], [machines, accountId]);
  const contact = mine.find((c) => c.id === contactId) ?? null;
  const known = useMemo(() => new Map(parts.map((p) => [p.code.toUpperCase(), p.name])), [parts]);
  const isKnown = !!code && known.has(code.trim().toUpperCase());
  const pickCode = (v: string) => { setCode(v); const hit = known.get(v.trim().toUpperCase()); if (hit && !desc.trim()) setDesc(hit); };

  return (
    <section className="nn" aria-label={t("Nueva Necesidad", "New Need")}>
      <div className="nn-head">
        <span className="nn-plus" aria-hidden>+</span>
        <div>
          <h2>{t("Nueva Necesidad", "New Need")}</h2>
          <p>{t("Empieza aquí cuando un cliente pide algo. Con esto queda registrada la solicitud, se le confirma al cliente por correo y queda la fecha del próximo contacto.", "Start here when a customer asks for something. This records the request, confirms it to the customer by email and sets the date of the next contact.")}</p>
        </div>
        <AiNeedButton lang={lang} configured={aiReady} onUse={useAi} />
      </div>
      {ai && <p className="note attn nn-ai" role="status"><b>{t("Llenado con IA.", "Filled in with AI.")}</b> {t("Revisa cada casilla antes de crear la Necesidad: nombres, números de parte y cantidades.", "Check every box before creating the Need: names, part numbers and quantities.")}{!ai.accountId ? ` ${t("Falta elegir el cliente.", "The customer still has to be picked.")}` : ""}</p>}
      <form key={ai ? JSON.stringify(ai.draft).length + ai.draft.title : "manual"} action={action} className="nn-form">
        {g?.replyBody && <><input type="hidden" name="aiSubject" value={g.replySubject ?? ""} /><input type="hidden" name="aiBody" value={g.replyBody} /></>}
        <div className="nn-col">
          <b className="nn-step">1 · {t("Quién pide", "Who is asking")}</b>
          <label>{t("Cliente", "Customer")} *
            <select name="accountId" required value={accountId} onChange={(e) => { setAccountId(e.target.value); setContactId(""); }}>
              <option value="" disabled>{t("Elegir…", "Choose…")}</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <span className="src">{t("¿No está en la lista? ", "Not on the list? ")}<Link href="/accounts">{t("Créalo primero en Clientes", "Create it first in Customers")}</Link></span>
          <label>{t("Contacto principal", "Main contact")}
            <select name="contactId" value={contactId} onChange={(e) => setContactId(e.target.value)} disabled={!accountId}>
              <option value="">{!accountId ? t("Elige primero el cliente", "Pick the customer first") : mine.length ? t("Elegir…", "Choose…") : t("Este cliente aún no tiene contactos", "This customer has no contacts yet")}</option>
              {mine.map((c) => <option key={c.id} value={c.id}>{c.name}{c.email ? ` · ${c.email}` : ""}</option>)}
            </select>
          </label>

          <b className="nn-step">2 · {t("Qué necesita", "What they need")}</b>
          <label>{t("Asunto: qué necesita el cliente, en una línea", "Subject: what the customer needs, in one line")} *
            <input name="title" required maxLength={150} defaultValue={g?.title ?? ""} placeholder={t("Ej.: bomba dosificadora para la línea 2", "E.g.: dosing pump for line 2")} />
          </label>
          <label>{t("Resultado que busca el cliente (qué quiere lograr)", "Result the customer wants (what they want to achieve)")}
            <input name="desiredResult" maxLength={300} defaultValue={g?.desiredResult ?? ""} placeholder={t("Ej.: que la línea 2 no pare por la bomba", "E.g.: line 2 never stops because of the pump")} />
          </label>
          <span className="src">{t("Con esto escrito, el paso «Necesidad» queda hecho y sigue «Fuente». Si aún no lo sabes, lo escribes después en la Necesidad.", "With this written, the “Need” step is done and “Source” comes next. If you don't know it yet, write it later on the Need.")}</span>
          <label>{t("Detalle de la solicitud (lo que dijo el cliente)", "Request detail (what the customer said)")}
            <textarea name="needSpecs" rows={4} maxLength={2000} defaultValue={g?.needSpecs ?? ""} placeholder={t("Especificaciones, cantidades, para cuándo, qué falla hoy…", "Specifications, quantities, by when, what fails today…")} />
          </label>
          <label>{t("Observaciones (uso interno)", "Notes (internal use)")}
            <textarea name="internalNotes" rows={aiNotes ? 7 : 3} maxLength={2000} defaultValue={aiNotes} placeholder={t("Solo para el equipo: nunca se imprime ni se envía al cliente", "For the team only: never printed or sent to the customer")} />
          </label>
        </div>

        <div className="nn-col">
          <b className="nn-step">3 · {t("Producto, repuesto y equipo", "Product, spare part and equipment")}</b>
          <div className="nn-row">
            <label style={{ flex: "1 1 150px" }}>{t("Código o número de parte", "Code or part number")}
              <input name="itemCode" list="nn-parts" maxLength={60} value={code} onChange={(e) => pickCode(e.target.value)} autoComplete="off" placeholder={t("Escribe o elige uno registrado", "Type or pick a registered one")} />
            </label>
            <label style={{ flex: "0 1 90px" }}>{t("Cantidad", "Quantity")}<input name="itemQty" type="number" min="1" step="1" defaultValue={g?.itemQty ?? 1} /></label>
          </div>
          <datalist id="nn-parts">{parts.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</datalist>
          <label>{t("Descripción del producto o repuesto", "Product or spare part description")}
            <input name="itemDescription" maxLength={300} value={desc} onChange={(e) => setDesc(e.target.value)} />
          </label>
          <span className="src">{isKnown ? t("Ya está registrado en Localizar repuestos: SOLU trajo su descripción.", "Already registered in Find parts: SOLU brought its description.") : code.trim() ? t("Código nuevo: al crear la Necesidad queda registrado en Localizar repuestos para la próxima vez.", "New code: on creating the Need it is registered in Find parts for next time.") : t("Si aún no sabes el código, deja esto vacío y lo agregas después.", "If you don't know the code yet, leave this empty and add it later.")}</span>
          <label>{t("Máquina o equipo del cliente", "Customer's machine or equipment")}
            <input name="machine" list="nn-machines" maxLength={200} autoComplete="off" defaultValue={g?.machine ?? ""} placeholder={accountId && myMachines.length ? t("Elige uno ya registrado de este cliente, o escribe uno nuevo", "Pick one already registered for this customer, or type a new one") : t("Ej.: envasadora Krones línea 3", "E.g.: Krones filler, line 3")} />
          </label>
          <datalist id="nn-machines">{myMachines.map((m) => <option key={m} value={m} />)}</datalist>
          <label>{t("Fotos o archivos (placa, plano, la solicitud del cliente)", "Photos or files (nameplate, drawing, the customer's request)")}
            <input name="files" type="file" multiple accept="image/*,application/pdf" />
          </label>
          <span className="src">{t("Hasta 6 archivos de 5 MB. Quedan en la Necesidad y se pueden adjuntar al correo.", "Up to 6 files of 5 MB. They stay on the Need and can be attached to the email.")}</span>

          <b className="nn-step">4 · {t("Qué sigue", "What comes next")}</b>
          <label>{t("Fecha del próximo contacto con el cliente", "Date of the next contact with the customer")}
            <input name="nextContact" type="date" defaultValue={defaultFollowUp} />
          </label>
          <label className="nn-check"><input type="checkbox" name="sendAck" value="1" checked={ack} onChange={(e) => setAck(e.target.checked)} /> <span>{t("Enviar al cliente el correo «Recibimos su solicitud»", "Send the customer the “We received your request” email")}</span></label>
          <span className="src">{ack ? (contactId && contact && !contact.email ? t("Este contacto no tiene correo guardado: lo escribes en la pantalla siguiente.", "This contact has no email saved: you type it on the next screen.") : g?.replyBody ? t("Al crear, SOLU abre el correo con la respuesta que preparó la IA para que la revises, la cambies y la envíes.", "On creating, SOLU opens the email with the reply the AI prepared so you review it, change it and send it.") : t("Al crear, SOLU abre el correo ya escrito para que lo revises, marques los archivos que van adjuntos y lo envíes.", "On creating, SOLU opens the email already written so you review it, tick the files to attach and send it.")) : t("No se envía nada: solo se crea la Necesidad.", "Nothing is sent: only the Need is created.")}</span>
          <div className="nn-foot"><button type="submit">{ack ? t("Crear Necesidad y revisar el correo", "Create Need and review the email") : t("Crear Necesidad", "Create Need")}</button></div>
        </div>
      </form>
    </section>
  );
}
