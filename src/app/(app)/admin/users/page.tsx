import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { AutoSubmitSelect } from "@/components/AutoSubmitSelect";
import { TestEmailButton } from "@/components/TestEmailButton";
import { mailConfig } from "@/lib/mail";
import { createUser, setUserRole, toggleUserActive } from "./actions";

export default async function UsersPage() {
  const admin = await requireRole("ADMIN");
  const users = await db.user.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
  });

  const mail = mailConfig();

  return (
    <>
      <h1>Users & roles</h1>

      <div className="card">
        <h2>Email delivery</h2>
        {mail.configured ? (
          <p className="small">
            Sending as <strong>{mail.from}</strong> via {mail.description}.
          </p>
        ) : (
          <p className="error">Not configured. Set the Microsoft Graph settings and MAIL_FROM in .env.</p>
        )}
        {mail.configured && <TestEmailButton />}
      </div>

      <div className="card">
        <h2>Invite user</h2>
        <form action={createUser} className="inline">
          <label>Name<input name="name" required /></label>
          <label>Email<input name="email" type="email" required /></label>
          <label>Temporary password<input name="password" type="password" minLength={10} required /></label>
          <label>
            Role
            <select name="role" defaultValue="REP">
              <option value="REP">Rep</option>
              <option value="MANAGER">Manager</option>
              <option value="ADMIN">Admin</option>
            </select>
          </label>
          <button type="submit">Create user</button>
        </form>
        <p className="muted small">
          Reps edit their own records. Managers edit everything. Admins also manage users.
        </p>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Created</th><th></th></tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const self = u.id === admin.id;
              return (
                <tr key={u.id} className={u.active ? undefined : "muted"}>
                  <td>{u.name}{self && " (you)"}</td>
                  <td>{u.email}</td>
                  <td>
                    {self ? (
                      <span className="badge">{u.role}</span>
                    ) : (
                      <form action={setUserRole.bind(null, u.id)}>
                        <AutoSubmitSelect name="role" defaultValue={u.role} aria-label={`Role for ${u.name}`}>
                          <option value="REP">Rep</option>
                          <option value="MANAGER">Manager</option>
                          <option value="ADMIN">Admin</option>
                        </AutoSubmitSelect>
                      </form>
                    )}
                  </td>
                  <td>{u.active ? "Active" : "Deactivated"}</td>
                  <td>{formatDate(u.createdAt)}</td>
                  <td>
                    {!self && (
                      <form action={toggleUserActive.bind(null, u.id)}>
                        <button className={u.active ? "danger" : "secondary"} type="submit">
                          {u.active ? "Deactivate" : "Reactivate"}
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
