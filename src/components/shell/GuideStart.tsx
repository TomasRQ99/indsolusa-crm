"use client";

import { startGuide } from "./GuideOverlay";

/** A button that starts an on-screen guide from a server-rendered page (search results). */
export function GuideStart({ id, route, className, children }: { id: string; route: boolean; className?: string; children: React.ReactNode }) {
  return <button type="button" className={className} onClick={() => startGuide(id, route)}>{children}</button>;
}
