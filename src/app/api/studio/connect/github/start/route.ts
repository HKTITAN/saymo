import { failed } from "@/lib/studio/connect-http";
import { allowed, refused } from "@/lib/studio/films";
import { cancelGithubSignIn, startGithub } from "@/lib/studio/github";

// One click: signs in with a code on github.com, or with this Mac's GitHub
// CLI when the studio has no GitHub OAuth App.
export async function POST(request: Request) {
  if (!allowed(request)) return refused();
  try {
    return Response.json({ result: await startGithub() });
  } catch (error) {
    return failed(error);
  }
}

export async function DELETE(request: Request) {
  if (!allowed(request)) return refused();
  cancelGithubSignIn();
  return new Response(null, { status: 204 });
}
