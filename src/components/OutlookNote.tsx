import Link from "next/link";

// One plain-language message per Outlook result code (from ?cal=…).
export function OutlookNote({ code, t }: { code?: string; t: (es: string, en: string) => string }) {
  if (!code) return null;
  const msg: Record<string, [string, string, "ok" | "attn" | "risk"]> = {
    ok: ["Listo: tu calendario de Outlook quedó conectado.", "Done: your Outlook calendar is connected.", "ok"],
    connect: ["Primero conecta tu calendario de Outlook aquí abajo.", "First connect your Outlook calendar below.", "attn"],
    DENIED: [
      "Microsoft no dio permiso para el calendario. Falta agregar el permiso «Calendars.ReadWrite» a la app de SOLU en Microsoft Entra y dar «Grant admin consent». Cuando esté, vuelve a intentar.",
      "Microsoft denied calendar access. The SOLU app in Microsoft Entra needs the \"Calendars.ReadWrite\" permission with \"Grant admin consent\". Then try again.",
      "risk",
    ],
    NO_MAILBOX: ["Microsoft no encontró un buzón de Outlook para tu correo de ingreso.", "Microsoft found no Outlook mailbox for your sign-in email.", "risk"],
    NOT_CONFIGURED: ["La conexión con Microsoft 365 no está configurada en el servidor.", "The Microsoft 365 connection isn't configured on the server.", "risk"],
    FULL: ["No encontré un espacio libre en tu calendario en los próximos días laborales.", "I found no free slot in your calendar in the next working days.", "attn"],
    OTHER: ["Outlook no respondió como se esperaba. Intenta de nuevo en un momento.", "Outlook didn't respond as expected. Try again shortly.", "risk"],
  };
  const m = msg[code] ?? msg.OTHER;
  return (
    <div className={`note ${m[2] === "ok" ? "" : m[2]}`} style={{ marginBottom: 16 }}>
      {t(m[0], m[1])}
      {code !== "ok" && code !== "connect" && code !== "FULL" && <> <Link href="/profile">{t("Ver conexión", "See connection")}</Link></>}
    </div>
  );
}
