import { allowed, refused } from "@/lib/studio/films";
import { addFromFilm, addLink, addNote, addUpload, LibraryError, listLibrary, toEntry } from "@/lib/studio/references";

// The reference library (references-shared.ts): everything in it, and
// adding to it. A file comes as the body with its name in x-file-name; a
// link, a note or a film's file comes as JSON.
export async function GET(request: Request) {
  if (!allowed(request)) return refused();
  return Response.json(await listLibrary());
}

export async function POST(request: Request) {
  if (!allowed(request)) return refused();
  try {
    const raw = request.headers.get("x-file-name");
    if (raw !== null) {
      let name = raw;
      try {
        name = decodeURIComponent(raw);
      } catch {}
      if (!name || !request.body) return Response.json({ error: "Send the file with its name." }, { status: 400 });
      const item = await addUpload(name, request.body, request.headers.get("x-library-folder"));
      return Response.json(toEntry(item), { status: 201 });
    }
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return Response.json({ error: "Send a file, a link or a note." }, { status: 400 });
    const item =
      typeof body.link === "string"
        ? await addLink(body.link, body.folder, body.note)
        : typeof body.text === "string"
          ? await addNote(body.text, body.folder, body.name)
          : typeof body.film === "string"
            ? await addFromFilm(body)
            : null;
    if (!item) return Response.json({ error: "Send a file, a link or a note." }, { status: 400 });
    return Response.json(toEntry(item), { status: 201 });
  } catch (error) {
    const known = error instanceof LibraryError;
    return Response.json({ error: known ? error.message : "Unable to add it to the library. Try again." }, { status: known ? 400 : 500 });
  }
}
