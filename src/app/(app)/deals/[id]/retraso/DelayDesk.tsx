"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { delayMail, tagText, type DelayTag, type OtherCase } from "@/lib/delay-rules";
import { proposeDelay, sendDelayNotice } from "./actions";

// The working part of "Aviso de retraso": cause → what we tell the customer → new date → other cases → the email,
// which rebuilds itself from those answers until the person edits it by hand.

type Props = {
  ui: "ES" | "EN";
  dealId: string;
  tags: DelayTag[];
  code: string | null; title: string; customerPo: string | null; promised: string | null;
  suggest: { date: string; why: string } | null; minDate: string;
  mailLang: "ES" | "EN"; contact: { name: string; email: string } | null;
  others: { ES: OtherCase[]; EN: OtherCase[] };
  sender: string; from: string; aiOn: boolean; mailOn: boolean; idem: string; failed: boolean;
};

type Saved = { tag: string; detail: string; explain: string; solution: string; newDate: string; lang: "ES" | "EN"; include: string[]; to: string; cc: string; subject: string; body: string; edited: boolean };

export function DelayDesk(p: Props) {
  const t = (a: string, b: string) => (p.ui === "ES" ? a : b);
  const storeKey = `solu.retraso.${p.dealId}`;
  const [tag, setTag] = useState("");
  const [detail, setDetail] = useState("");
  const [explain, setExplain] = useState("");
  const [solution, setSolution] = useState("");
  const [newDate, setNewDate] = useState(p.suggest?.date ?? "");
  const [lang, setLang] = useState<"ES" | "EN">(p.mailLang);
  const [include, setInclude] = useState<string[]>(p.others.ES.map((o) => o.id));
  const [to, setTo] = useState(p.contact?.email ?? "");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [edited, setEdited] = useState(false);
  const [aiMsg, setAiMsg] = useState("");
  const [aiBusy, startAi] = useTransition();
  const restored = useRef(false);

  // A send that was rejected brings the person back here: what they had written comes back with them.
  useEffect(() => {
    if (!p.failed || restored.current) return;
    restored.current = true;
    try {
      const s = JSON.parse(sessionStorage.getItem(storeKey) ?? "null") as Saved | null;
      if (!s) return;
      setTag(s.tag); setDetail(s.detail); setExplain(s.explain); setSolution(s.solution); setNewDate(s.newDate); setLang(s.lang); setInclude(s.include); setTo(s.to); setCc(s.cc); setSubject(s.subject); setBody(s.body); setEdited(s.edited);
    } catch { /* nothing kept: the form starts empty */ }
  }, [p.failed, storeKey]);

  const built = useMemo(() => delayMail({
    lang, contactName: p.contact?.name ?? null, code: p.code, customerPo: p.customerPo, what: p.title, promised: p.promised, newDate: newDate || null,
    explain, solution, others: p.others[lang].filter((o) => include.includes(o.id)), sender: p.sender, from: p.from,
  }), [lang, p.contact, p.code, p.customerPo, p.title, p.promised, newDate, explain, solution, p.others, include, p.sender, p.from]);
  // Until the person edits the email by hand, it follows their answers.
  useEffect(() => { if (!edited) { setSubject(built.subject); setBody(built.text); } }, [built, edited]);

  const pickTag = (k: string) => {
    setTag(k);
    const tt = tagText(p.tags.find((x) => x.key === k), lang);
    setExplain(tt.explain); setSolution(tt.solution);
  };
  const pickLang = (l: "ES" | "EN") => {
    const cur = p.tags.find((x) => x.key === tag);
    const was = tagText(cur, lang);
    setLang(l);
    // Texts still equal to the tag's own are translated with it; anything the person rewrote is left alone.
    const now = tagText(cur, l);
    if (explain === was.explain) setExplain(now.explain);
    if (solution === was.solution) setSolution(now.solution);
  };
  const keep = () => {
    try { sessionStorage.setItem(storeKey, JSON.stringify({ tag, detail, explain, solution, newDate, lang, include, to, cc, subject, body, edited } satisfies Saved)); } catch { /* not kept */ }
  };
  const askAi = () => {
    setAiMsg("");
    startAi(async () => {
      const r = await proposeDelay(p.dealId, { tag, detail, newDate, lang, include });
      if (r.ok) { setSolution(r.solution); setBody(r.body); setEdited(true); setAiMsg(t("Propuesta de IA puesta en el correo. Léela y cambia lo que quieras antes de enviar.", "AI proposal placed in the email. Read it and change what you want before sending.")); }
      else setAiMsg(r.reason === "off" ? t("La IA aún no está conectada. El correo de abajo ya está armado con los textos de la etiqueta.", "AI is not connected yet. The email below is already built from the tag's texts.") : r.reason === "cap" ? t("La IA llegó al tope del mes. El correo de abajo ya está armado con los textos de la etiqueta.", "AI reached this month's cap. The email below is already built from the tag's texts.") : t("La IA no respondió esta vez. Puedes seguir con el correo de abajo.", "AI did not answer this time. You can continue with the email below."));
    });
  };

  const others = p.others[lang];
  const ready = !!tag && !!newDate;
  const missing = [!tag && t("la causa", "the cause"), !newDate && t("la nueva fecha", "the new date")].filter(Boolean).join(t(" y ", " and "));

  return (
    <form action={sendDelayNotice.bind(null, p.dealId)} onSubmit={keep} className="rt-form">
      <input type="hidden" name="idem" value={p.idem} />
      <input type="hidden" name="tag" value={tag} />
      <input type="hidden" name="toName" value={p.contact?.name ?? ""} />

      <section className="card" id="causa">
        <b><i className="rt-n">1</i>{t("¿QUÉ CAUSÓ EL RETRASO?", "WHAT CAUSED THE DELAY?")}<span className="req" aria-hidden> *</span></b>
        <div className="rt-tags" role="radiogroup" aria-label={t("Causa del retraso", "Cause of the delay")}>
          {p.tags.map((x) => (
            <button key={x.key} type="button" role="radio" aria-checked={tag === x.key} className={`rt-tag${tag === x.key ? " on" : ""}`} onClick={() => pickTag(x.key)}>{x.label}</button>
          ))}
        </div>
        <label className="rt-l">{t("Detalle para el equipo (opcional, el cliente no lo ve)", "Detail for the team (optional, the customer does not see it)")}
          <input name="detail" value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={500} placeholder={t("Ej.: el proveedor confirmó despacho para el viernes", "E.g.: the supplier confirmed shipping for Friday")} />
        </label>
      </section>

      <section className="card" id="solucion">
        <b><i className="rt-n">2</i>{t("QUÉ LE DECIMOS AL CLIENTE Y QUÉ FECHA LE OFRECEMOS", "WHAT WE TELL THE CUSTOMER AND WHICH DATE WE OFFER")}</b>
        <div className="rt-two">
          <label className="rt-l">{t("Qué pasó (lo lee el cliente)", "What happened (the customer reads it)")}
            <textarea rows={3} value={explain} onChange={(e) => setExplain(e.target.value)} maxLength={500} placeholder={t("Elige una causa arriba y SOLU propone el texto", "Pick a cause above and SOLU proposes the text")} />
          </label>
          <label className="rt-l">{t("Qué estamos haciendo para resolverlo", "What we are doing to solve it")}
            <textarea rows={3} value={solution} onChange={(e) => setSolution(e.target.value)} maxLength={500} />
          </label>
        </div>
        <div className="rt-date">
          <label className="rt-l">{t("Nueva fecha de entrega", "New delivery date")}<span className="req" aria-hidden> *</span>
            <input type="date" name="newDate" value={newDate} min={p.minDate} onChange={(e) => setNewDate(e.target.value)} />
          </label>
          <p className="src">
            {p.suggest
              ? <><b>{t("Fecha que propone SOLU: ", "Date SOLU proposes: ")}</b>{p.suggest.why}{newDate !== p.suggest.date && <> <button type="button" className="secondary sm" onClick={() => setNewDate(p.suggest!.date)}>{t("Usar esa fecha", "Use that date")}</button></>}</>
              : t("SOLU no propone fecha porque falta la fecha de llegada del proveedor. Conviene confirmarla con el proveedor antes de prometerle una fecha al cliente.", "SOLU proposes no date because the supplier's arrival date is missing. It is worth confirming it with the supplier before promising the customer a date.")}
          </p>
        </div>
      </section>

      {others.length > 0 && (
        <section className="card" id="otros">
          <b><i className="rt-n">3</i>{t("SUS OTROS CASOS ABIERTOS, PARA CONTARLE CÓMO VAN", "THEIR OTHER OPEN CASES, TO TELL THEM HOW THEY ARE GOING")}</b>
          <p className="src">{t("Los que dejes marcados van en el mismo correo, con una línea cada uno.", "The ones you leave ticked go in the same email, one line each.")}</p>
          <ul className="rt-others">
            {others.map((o) => (
              <li key={o.id}>
                <label><input type="checkbox" checked={include.includes(o.id)} onChange={(e) => setInclude((v) => (e.target.checked ? [...v, o.id] : v.filter((x) => x !== o.id)))} /> <b>{o.code}</b> {o.what}<span className="src">{o.status}</span></label>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card" id="correo">
        <b><i className="rt-n">{others.length > 0 ? 4 : 3}</i>{t("EL CORREO AL CLIENTE", "THE EMAIL TO THE CUSTOMER")}</b>
        <div className="rt-bar">
          <div className="seg" role="group" aria-label={t("Idioma del correo", "Email language")}>
            <button type="button" className={lang === "ES" ? "on" : undefined} aria-pressed={lang === "ES"} onClick={() => pickLang("ES")}>{t("En español", "In Spanish")}</button>
            <button type="button" className={lang === "EN" ? "on" : undefined} aria-pressed={lang === "EN"} onClick={() => pickLang("EN")}>{t("En inglés", "In English")}</button>
          </div>
          {p.aiOn && <button type="button" className="secondary sm rt-ai" disabled={!tag || aiBusy} onClick={askAi}>{aiBusy ? t("Pensando…", "Thinking…") : t("Proponer con IA", "Propose with AI")}</button>}
          {edited && <button type="button" className="secondary sm" onClick={() => setEdited(false)}>{t("Volver al texto de SOLU", "Back to SOLU's text")}</button>}
        </div>
        {!p.aiOn && <p className="src">{t("La propuesta con IA se enciende cuando la empresa conecte su llave de IA. Mientras tanto, SOLU arma el correo con los textos de la etiqueta que elijas.", "The AI proposal turns on once the company connects its AI key. Meanwhile, SOLU builds the email from the texts of the tag you pick.")}</p>}
        {aiMsg && <p className="note" role="status">{aiMsg}</p>}
        <div className="rt-two">
          <label className="rt-l">{t("Para", "To")}<input name="to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="nombre@cliente.com" /></label>
          <label className="rt-l">{t("Copia (CC, opcional)", "Copy (CC, optional)")}<input name="cc" value={cc} onChange={(e) => setCc(e.target.value)} /></label>
        </div>
        <label className="rt-l">{t("Asunto", "Subject")}<input name="subject" value={subject} onChange={(e) => { setSubject(e.target.value); setEdited(true); }} maxLength={250} /></label>
        <label className="rt-l">{t("Texto", "Text")}<textarea name="body" rows={16} value={body} onChange={(e) => { setBody(e.target.value); setEdited(true); }} /></label>
        {!ready && <p className="rt-miss" role="status">{t(`Para continuar falta ${missing}.`, `To continue, ${missing} is missing.`)} <a href={!tag ? "#causa" : "#solucion"}>{t("Ir a completarlo", "Go fill it in")}</a></p>}
        <div className="rt-actions">
          <button type="submit" name="mode" value="send" disabled={!ready || !p.mailOn || !to.trim()}>{t("Enviar al cliente y guardar la nueva fecha", "Send to the customer and save the new date")}</button>
          <button type="submit" name="mode" value="save" className="secondary" disabled={!ready}>{t("Ya le avisé por otro medio: solo guardar la fecha", "I already told them another way: only save the date")}</button>
        </div>
        {!p.mailOn && <p className="src">{t("El correo de la empresa no está conectado en este servidor: puedes guardar la fecha y avisar por otro medio.", "The company mailbox is not connected on this server: you can save the date and tell them another way.")}</p>}
        {p.mailOn && ready && !to.trim() && <p className="src">{t("Escribe el correo del cliente en «Para» para poder enviarlo.", "Type the customer's email in “To” to be able to send it.")}</p>}
      </section>
    </form>
  );
}
