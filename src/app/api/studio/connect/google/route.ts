import { failed } from "@/lib/studio/connect-http";
import { allowed, refused } from "@/lib/studio/films";
import { disconnectGoogle, rootFolder, setGoogle } from "@/lib/studio/google";

// { active?: email, autoDrafts?: boolean, folderName?: string }
export async function PATCH(request: Request) {
  if (!allowed(request)) return refused();
  const body = (await request.json().catch(() => null)) as { active?: unknown; autoDrafts?: unknown; folderName?: unknown } | null;
  try {
    await setGoogle({
      active: typeof body?.active === "string" ? body.active : undefined,
      autoDrafts: typeof body?.autoDrafts === "boolean" ? body.autoDrafts : undefined,
      folderName: typeof body?.folderName === "string" ? body.folderName : undefined,
    });
    // A new account or folder name: find or make the folder now.
    if (typeof body?.active === "string" || typeof body?.folderName === "string") await rootFolder();
    return new Response(null, { status: 204 });
  } catch (error) {
    return failed(error);
  }
}

// { email }: Google forgets the studio's access, then this Mac does.
export async function DELETE(request: Request) {
  if (!allowed(request)) return refused();
  const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
  if (typeof body?.email !== "string") return Response.json({ error: "Say which account to disconnect." }, { status: 400 });
  try {
    await disconnectGoogle(body.email);
    return new Response(null, { status: 204 });
  } catch (error) {
    return failed(error);
  }
}
