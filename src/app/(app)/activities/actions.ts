"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { optionalId, optionalText, parseForm, requiredText } from "@/lib/forms";
import { refreshApp } from "@/lib/revalidate";

const activitySchema = z.object({
  type: z.enum(["CALL", "MEETING", "EMAIL", "NOTE"]),
  subject: requiredText,
  body: optionalText,
  accountId: optionalId,
  contactId: optionalId,
  dealId: optionalId,
});

// Anyone can log activity against any record; the log is attributed to them.
export async function logActivity(formData: FormData) {
  const user = await requireUser();
  const data = parseForm(activitySchema, formData);
  await db.activity.create({ data: { ...data, userId: user.id } });
  refreshApp();
}
