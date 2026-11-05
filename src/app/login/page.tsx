import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { COMPANY_NAME } from "@/lib/brand";
import { LoginForm } from "./LoginForm";
import { setLoginLanguage } from "./actions";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/mi-dia");
  const { t, es } = await getI18n();
  return (
    <div className="login">
      <form action={setLoginLanguage} className="seg login-lang" aria-label={t("Idioma", "Language")}>
        <button type="submit" name="lang" value="ES" className={es ? "on" : undefined} aria-pressed={es} title="Español">ES</button>
        <button type="submit" name="lang" value="EN" className={!es ? "on" : undefined} aria-pressed={!es} title="English">EN</button>
      </form>
      <div className="card">
        <div className="wordmark" style={{ width: "auto", paddingLeft: 0, marginBottom: 12 }}>SOLU<small>Industry Solutions</small></div>
        <p className="muted small" style={{ marginBottom: 12 }}>{t(`Ingresa con tu cuenta de ${COMPANY_NAME}.`, `Sign in with your ${COMPANY_NAME} account.`)}</p>
        <LoginForm es={es} />
      </div>
    </div>
  );
}
