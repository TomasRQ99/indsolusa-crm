"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavSection = { label: string; links: { href: string; label: string }[] };

export function NavLinks({ sections }: { sections: NavSection[] }) {
  const path = usePathname();
  // The most specific matching link is the active one.
  const all = sections.flatMap((s) => s.links.map((l) => l.href));
  const active = all
    .filter((h) => path === h || path.startsWith(h + "/"))
    .sort((a, b) => b.length - a.length)[0];
  return (
    <>
      {sections.map((s) => (
        <div className="sec" key={s.label}>
          <span>{s.label}</span>
          {s.links.map((l) => (
            <Link key={l.href} href={l.href} className={l.href === active ? "on" : undefined}>
              {l.label}
            </Link>
          ))}
        </div>
      ))}
    </>
  );
}
