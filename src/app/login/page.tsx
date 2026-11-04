import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { APP_NAME, COMPANY_NAME } from "@/lib/brand";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  return (
    <div className="login">
      <div className="card">
        <h1>{APP_NAME}</h1>
        <p className="muted small">Sign in with your {COMPANY_NAME} account.</p>
        <LoginForm />
      </div>
    </div>
  );
}
