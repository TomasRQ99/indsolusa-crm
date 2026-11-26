// Email signatures as pictures (owner, 2026-11-26): each person uploads one or several in Mi perfil, gives each a
// name, marks one as the usual one, and picks which goes on each email. The picture travels inside the email
// (inline), so the customer sees it without downloading anything.

import { db } from "./db";

export const SIGNATURE_MIMES = ["image/png", "image/jpeg", "image/gif"];
export const MAX_SIGNATURE_BYTES = 500 * 1024;
export const MAX_SIGNATURES = 8;
/** Name the picture carries inside the email. */
export const SIGNATURE_CID = "firma-solu";

export const mySignatures = (userId: string) =>
  db.mailSignature.findMany({ where: { userId }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }], select: { id: true, name: true, size: true, isDefault: true } });

/** The signature to put on an email: the one chosen on screen when it is the person's own, never anyone else's. */
export async function signatureToSend(userId: string, id: string) {
  if (!/^[a-z0-9]{10,40}$/i.test(id)) return null;
  return db.mailSignature.findFirst({ where: { id, userId }, select: { name: true, mime: true, data: true } });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
/** The email's HTML with the signature picture after the text. */
export const withSignature = (html: string, name: string) =>
  `${html}<div style="margin-top:14px"><img src="cid:${SIGNATURE_CID}" alt="${esc(name)}" style="max-width:360px;height:auto;border:0"></div>`;
