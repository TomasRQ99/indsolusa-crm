import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { PasswordForm } from "./PasswordForm";
import { setWorkday } from "./actions";

export default async function ProfilePage() {
  const user = await requireUser();
  const { t } = makeI18n(user.lang);
  return (
    <>
      <div className="ph"><div><h1>{t("Mi perfil", "My profile")}</h1><p>{user.name} · {user.email} · <span className="badge">{user.role}</span></p></div></div>
      <div className="grid cols-2">
        <div className="card">
          <h2>{t("Mi jornada", "My working day")}</h2>
          <p className="small muted" style={{ marginBottom: 10 }}>{t("Mi Plan usa este dato para saber cuánto cabe en cada día. No se usa para medir a nadie.", "My Plan uses this to know how much fits in each day. It is never used to measure anyone.")}</p>
          <form action={setWorkday} className="inline">
            <label>{t("Horas por día", "Hours per day")}<input name="hours" type="number" min="1" max="14" step="0.5" defaultValue={user.workdayMinutes / 60} /></label>
            <button type="submit">{t("Guardar", "Save")}</button>
          </form>
        </div>
        <div className="card">
          <h2>{t("Cambiar contraseña", "Change password")}</h2>
          <PasswordForm />
        </div>
      </div>
    </>
  );
}
