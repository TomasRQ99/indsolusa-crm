import { requireUser } from "@/lib/auth";
import { AiError } from "@/lib/ai";
import { MAX_PHOTO_BYTES, PHOTO_MIMES, queryFromReading, readPartPhoto } from "@/lib/part-vision";

// Search by photo: reads the part in the picture with Claude and returns what to search for.
// The photo is not stored anywhere.
export async function POST(req: Request) {
  const user = await requireUser();
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "NO_FILE" }, { status: 400 });
  if (file.size > MAX_PHOTO_BYTES) return Response.json({ error: "TOO_BIG" }, { status: 413 });
  const mime = PHOTO_MIMES.find((m) => m === file.type);
  if (!mime) return Response.json({ error: "TYPE" }, { status: 415 });
  try {
    const reading = await readPartPhoto(Buffer.from(await file.arrayBuffer()), mime, user.name);
    return Response.json({ reading, query: queryFromReading(reading) });
  } catch (e) {
    const code = e instanceof AiError ? e.code : "API";
    if (!(e instanceof AiError) || code === "API" || code === "AUTH") console.error("[localizar/foto]", e instanceof Error ? e.message : e);
    return Response.json({ error: code }, { status: code === "OFF" || code === "CAP" ? 503 : 502 });
  }
}
