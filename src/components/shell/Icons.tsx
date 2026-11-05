import type { ModuleKey } from "@/lib/nav";

// SOLU icon set: 24px grid, 1.5 stroke, round joins. Decorative: labels always carry meaning.
const base = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

export const MODULE_ICONS: Record<ModuleKey, React.ReactNode> = {
  midia: (
    <svg {...base}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" /></svg>
  ),
  mercado: (
    <svg {...base}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" /></svg>
  ),
  comercial: <svg {...base}><path d="M4 17l5-5 4 4 7-8" /><path d="M15 8h5v5" /></svg>,
  operaciones: <svg {...base}><path d="M3 7.5l9-4.5 9 4.5v9l-9 4.5-9-4.5v-9z" /><path d="M3 7.5l9 4.5 9-4.5M12 12v9" /></svg>,
  administracion: <svg {...base}><rect x="4" y="3" width="16" height="18" rx="1.5" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>,
  proyectos: <svg {...base}><path d="M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v4H4zM14 15h6v4h-6z" /></svg>,
  equipo: (
    <svg {...base}><circle cx="9" cy="8.5" r="3.5" /><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5" /><circle cx="17" cy="9.5" r="2.5" /><path d="M17 14.5c2.4 0 4 1.5 4.5 4" /></svg>
  ),
  gerencia: <svg {...base}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>,
};

export const IconSearch = () => <svg {...base} width={18} height={18}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>;
export const IconSparkle = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden><path fill="currentColor" d="M12 2.5c.6 4.6 2.9 6.9 7.5 7.5-4.6.6-6.9 2.9-7.5 7.5-.6-4.6-2.9-6.9-7.5-7.5 4.6-.6 6.9-2.9 7.5-7.5z" /></svg>
);
export const IconBell = () => <svg {...base}><path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15L6 16z" /><path d="M10 20.5a2 2 0 004 0" /></svg>;
export const IconChevron = () => <svg {...base} width={18} height={18}><path d="M15 6l-6 6 6 6" /></svg>;
export const IconMenu = () => <svg {...base}><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
export const IconClose = () => <svg {...base}><path d="M6 6l12 12M18 6L6 18" /></svg>;
