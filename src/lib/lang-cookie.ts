import { cookies } from "next/headers";
import { LANG_COOKIE } from "./i18n";

/** Remember the language in this browser too, so the sign-in page opens in it. */
export async function rememberLang(lang: "ES" | "EN") {
  (await cookies()).set(LANG_COOKIE, lang, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" });
}
