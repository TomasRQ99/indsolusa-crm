import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { APP_NAME } from "@/lib/brand";
import { getLang } from "@/lib/i18n";

const display = Archivo({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display" });
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: APP_NAME,
  description: "SOLU USA · Industry Solutions",
  // SOLU translates itself with the ES | EN switch; the browser's own translator would garble it.
  other: { google: "notranslate" },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  return (
    <html lang={lang === "EN" ? "en" : "es"} translate="no" className={`notranslate ${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
