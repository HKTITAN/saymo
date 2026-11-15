import { allowed, createFolder, listFolders, refused } from "@/lib/studio/films/films";
import { folderName } from "@/lib/studio/films/validate";

// The folders on the studio's home page.
export async function GET(request: Request) {
  if (!allowed(request)) return refused();
  return Response.json(await listFolders());
}

export async function POST(request: Request) {
  if (!allowed(request)) return refused();
  const name = folderName(await request.json().catch(() => null));
  if (!name) return Response.json({ error: "Give the folder a name." }, { status: 400 });
  return Response.json(await createFolder(name), { status: 201 });
}
