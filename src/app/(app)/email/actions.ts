"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole, requireUser } from "@/lib/auth";
import { describeMailError, mailConfig, sendMail } from "@/lib/mail";
import { APP_NAME } from "@/lib/brand";
import { requiredText } from "@/lib/forms";
import { refreshApp } from "@/lib/revalidate";

export type EmailState = { ok?: string; error?: string };

const schema = z.object({
  contactId: z.string().min(1, "Pick a recipient."),
  subject: requiredText,
  body: z.string().trim().min(1, "Write a message.").max(20000),
});

// Sends from the shared sales mailbox and logs the email on the contact's timeline.
export async function sendEmail(_prev: EmailState, formData: FormData): Promise<EmailState> {
  const user = await requireUser();
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { contactId, subject, body } = parsed.data;

  const contact = await db.contact.findUnique({
    where: { id: contactId },
    select: { id: true, firstName: true, lastName: true, email: true, accountId: true },
  });
  if (!contact?.email) return { error: "That contact has no email address." };

  try {
    await sendMail({
      to: { name: `${contact.firstName} ${contact.lastName}`, address: contact.email },
      subject,
      text: body,
      senderName: user.name,
    });
  } catch (e) {
    return { error: describeMailError(e) };
  }

  await db.activity.create({
    data: { type: "EMAIL", subject, body, userId: user.id, contactId: contact.id, accountId: contact.accountId },
  });
  refreshApp();
  return { ok: `Sent to ${contact.email}.` };
}

export async function sendTestEmail(_prev: EmailState, _formData: FormData): Promise<EmailState> {
  await requireRole("ADMIN");
  const { from } = mailConfig();
  try {
    await sendMail({
      to: from ?? "",
      subject: `${APP_NAME} test email`,
      text: `This is a test message from ${APP_NAME}. If you can read it, outgoing email is working.`,
    });
  } catch (e) {
    return { error: describeMailError(e) };
  }
  return { ok: `Test email sent to ${from}. Check that inbox.` };
}
