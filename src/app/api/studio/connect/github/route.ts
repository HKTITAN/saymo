import { failed } from "@/lib/studio/connect/connect-http";
import { allowed, refused } from "@/lib/studio/films/films";
import { disconnectGithub } from "@/lib/studio/connect/github";

export async function DELETE(request: Request) {
  if (!allowed(request)) return refused();
  try {
    await disconnectGithub();
    return new Response(null, { status: 204 });
  } catch (error) {
    return failed(error);
  }
}
