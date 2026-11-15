import { failed } from "@/lib/studio/connect/connect-http";
import { chooseFolder, destinationsStatus, pickDestination, stopDestination } from "@/lib/studio/connect/destinations";
import { allowed, refused } from "@/lib/studio/films/films";

// Where finished films are copied on this Mac (destinations.ts). GET: the
// cloud folders found and the one in use. PUT { path }: use one of them.
// POST: pick any folder in Finder, on this Mac. DELETE: stop copying.
// Each answers with the status as it is afterwards.

export async function GET(request: Request) {
  if (!allowed(request)) return refused();
  try {
    return Response.json(await destinationsStatus());
  } catch (error) {
    return failed(error);
  }
}

export async function PUT(request: Request) {
  if (!allowed(request)) return refused();
  try {
    const body = (await request.json().catch(() => null)) as { path?: unknown } | null;
    if (typeof body?.path !== "string") return Response.json({ error: "Pick one of the folders listed." }, { status: 400 });
    await pickDestination(body.path);
    return Response.json(await destinationsStatus());
  } catch (error) {
    return failed(error);
  }
}

export async function POST(request: Request) {
  if (!allowed(request)) return refused();
  try {
    await chooseFolder();
    return Response.json(await destinationsStatus());
  } catch (error) {
    return failed(error);
  }
}

export async function DELETE(request: Request) {
  if (!allowed(request)) return refused();
  try {
    await stopDestination();
    return Response.json(await destinationsStatus());
  } catch (error) {
    return failed(error);
  }
}
