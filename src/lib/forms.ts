import { z } from "zod";

export const requiredText = z.string().trim().min(1, "Required").max(200);
export const optionalText = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .transform((v) => (v ? v : null));
export const optionalId = z
  .string()
  .optional()
  .transform((v) => (v ? v : null));
export const optionalDate = z
  .string()
  .optional()
  .transform((v) => (v ? new Date(v) : null));

export function parseForm<T extends z.ZodTypeAny>(schema: T, formData: FormData): z.infer<T> {
  const result = schema.safeParse(Object.fromEntries(formData));
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`${issue.path.join(".") || "Form"}: ${issue.message}`);
  }
  return result.data;
}
