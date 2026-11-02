import { allowed, refused } from "@/lib/studio/films";
import { createLibraryFolder, listLibraryFolders } from "@/lib/studio/references";
import { folderName } from "@/lib/studio/validate";

// The library's own folders (films have theirs in films/folders.json).
export async function GET(request: Request) {
  if (!allowed(request)) return refused();
  return Response.json(await listLibraryFolders());
}

export async function POST(request: Request) {
  if (!allowed(request)) return refused();
  const name = folderName(await request.json().catch(() => null));
  if (!name) return Response.json({ error: "Give the folder a name." }, { status: 400 });
  return Response.json(await createLibraryFolder(name), { status: 201 });
}
