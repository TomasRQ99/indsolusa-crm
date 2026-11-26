import { addSignature, removeSignature, renameSignature, setDefaultSignature } from "@/app/(app)/profile/signature-actions";
import { MAX_SIGNATURES } from "@/lib/signatures";

// Mi perfil → Firmas de correo: upload a picture of your signature, name it, keep several and say which is the usual one.

type Sig = { id: string; name: string; size: number; isDefault: boolean };

export function SignatureCard({ lang, list, ok, err }: { lang: "ES" | "EN"; list: Sig[]; ok?: string; err?: string }) {
  const t = (es: string, en: string) => (lang === "EN" ? en : es);
  const oks: Record<string, string> = {
    firma: t("Firma guardada. Ya puedes elegirla al enviar un correo.", "Signature saved. You can now pick it when sending an email."),
    "firma-usual": t("Esa es ahora tu firma de siempre.", "That is now your usual signature."),
    "firma-nombre": t("Nombre cambiado.", "Name changed."),
    "firma-quitada": t("Firma quitada.", "Signature removed."),
  };
  const errs: Record<string, string> = {
    "firma-archivo": t("Elige la imagen de tu firma.", "Choose the picture of your signature."),
    "firma-tipo": t("La firma debe ser una imagen PNG, JPG o GIF.", "The signature must be a PNG, JPG or GIF picture."),
    "firma-peso": t("La imagen pesa más de 500 KB. Recórtala o guárdala más pequeña y súbela de nuevo.", "The picture is over 500 KB. Crop it or save it smaller and upload it again."),
    "firma-tope": t(`Ya tienes ${MAX_SIGNATURES} firmas. Quita una para subir otra.`, `You already have ${MAX_SIGNATURES} signatures. Remove one to upload another.`),
    "firma-nombre": t("Escribe un nombre para la firma.", "Type a name for the signature."),
  };
  return (
    <div className="card" id="firmas">
      <h2>{t("Firmas de correo", "Email signatures")}</h2>
      {ok && oks[ok] && <p className="small"><span className="sig ok">{oks[ok]}</span></p>}
      {err && errs[err] && <p className="note risk" role="alert">{errs[err]}</p>}
      <p className="small muted" style={{ marginBottom: 10 }}>{t("Sube la imagen de tu firma una sola vez y SOLU la guarda. Si subes varias, ponle nombre a cada una (por ejemplo «Formal» o «Corta») y elige cuál va en cada correo.", "Upload the picture of your signature once and SOLU keeps it. If you upload several, name each one (for example “Formal” or “Short”) and choose which goes on each email.")}</p>
      {list.length === 0 ? <p className="quiet-p">{t("Todavía no has subido ninguna firma.", "You have not uploaded a signature yet.")}</p> : (
        <ul className="sg-list">{list.map((s) => (
          <li key={s.id}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/firma/${s.id}`} alt={s.name} className="sg-img" />
            <div className="sg-body">
              <form action={renameSignature.bind(null, s.id)} className="sg-name">
                <input name="name" defaultValue={s.name} maxLength={60} aria-label={t("Nombre de la firma", "Signature name")} />
                <button type="submit" className="secondary sm">{t("Guardar nombre", "Save name")}</button>
              </form>
              <div className="sg-act">
                {s.isDefault ? <span className="sig ok">{t("La de siempre", "Usual one")}</span> : <form action={setDefaultSignature.bind(null, s.id)}><button type="submit" className="secondary sm">{t("Usar siempre esta", "Always use this one")}</button></form>}
                <form action={removeSignature.bind(null, s.id)}><button type="submit" className="secondary sm" data-confirm={t(`¿Quitar la firma «${s.name}»?`, `Remove the signature “${s.name}”?`)}>{t("Quitar", "Remove")}</button></form>
              </div>
            </div>
          </li>
        ))}</ul>
      )}
      {list.length < MAX_SIGNATURES && (
        <form action={addSignature} className="qa-form" style={{ marginTop: 12 }}>
          <label>{t("Imagen de la firma (PNG, JPG o GIF, hasta 500 KB)", "Signature picture (PNG, JPG or GIF, up to 500 KB)")}<input name="file" type="file" accept="image/png,image/jpeg,image/gif" required /></label>
          <label>{t("Nombre de esta firma", "Name of this signature")}<input name="name" maxLength={60} placeholder={t("Ej.: Formal, Corta, Con logo", "E.g.: Formal, Short, With logo")} /></label>
          {list.length > 0 && <label style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><input type="checkbox" name="isDefault" value="1" /> <span>{t("Usar siempre esta", "Always use this one")}</span></label>}
          <button type="submit" className="sm" style={{ alignSelf: "flex-start" }}>{t("Subir firma", "Upload signature")}</button>
        </form>
      )}
      <p className="src" style={{ marginTop: 8 }}>{t("Solo tú ves y usas tus firmas. Al enviar un correo desde SOLU, en «Firma» eliges cuál va; la de siempre viene elegida. La imagen va dentro del correo, debajo del texto.", "Only you see and use your signatures. When sending an email from SOLU, under “Signature” you choose which one goes; the usual one comes chosen. The picture goes inside the email, below the text.")}</p>
    </div>
  );
}
