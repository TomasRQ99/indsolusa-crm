import { requireUser } from "@/lib/auth";
import { PasswordForm } from "./PasswordForm";

export default async function ProfilePage() {
  const user = await requireUser();
  return (
    <>
      <h1>My profile</h1>
      <div className="card">
        <p>{user.name} · {user.email} · <span className="badge">{user.role}</span></p>
        <h2>Change password</h2>
        <PasswordForm />
      </div>
    </>
  );
}
