import { requireUser } from "@/lib/auth";
import { MAX_DOC_BYTES, extractDocument } from "@/lib/doc-extract";

// Reads a customer document (RUT, Cámara de Comercio) and returns the fields found,
// so the "Nuevo cliente" form can suggest them. Nothing is saved here.
export async function POST(req: Request) {
  await requireUser();
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "no-file" }, { status: 400 });
  if (file.size > MAX_DOC_BYTES) return Response.json({ error: "too-big" }, { status: 413 });
  try {
    const result = await extractDocument(new Uint8Array(await file.arrayBuffer()), file.type);
    return Response.json(result);
  } catch {
    return Response.json({ kind: "OTHER", fields: {}, readable: false });
  }
}
