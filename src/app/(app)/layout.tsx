import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { canManageAll } from "@/lib/permissions";
import { MODULES } from "@/lib/nav";
import { shellAttention } from "@/lib/attention";
import { ShellClient, type ShellModule } from "@/components/shell/ShellClient";

// SOLU global shell: exactly 8 modules (MI DÍA … GERENCIA/INSIGHTS), universal search and
// "Pregúntale a SOLU" always visible. Sections of a module are tabs inside the content.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t, es } = i;
  const manager = canManageAll(user);
  const { counters, alerts } = await shellAttention(user, i);

  const modules: ShellModule[] = MODULES.map((m) => {
    const tabs = m.tabs
      .filter((tab) => (!tab.managerOnly || manager) && (!tab.adminOnly || user.role === "ADMIN"))
      .map((tab) => ({ href: tab.href, label: es ? tab.es : tab.en }));
    return { key: m.key, label: es ? m.es : m.en, href: tabs[0]?.href ?? m.match[0], match: m.match, tabs, counter: counters[m.key] };
  });

  const initials = user.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const role = user.role === "ADMIN" ? t("Administración del sistema", "System admin") : user.role === "MANAGER" ? t("Gerencia", "Management") : t("Comercial", "Sales");

  return (
    <ShellClient lang={user.lang} user={{ name: user.name, role, initials }} modules={modules} alerts={alerts}>
      {children}
    </ShellClient>
  );
}
