import { failed } from "@/lib/studio/connect-http";
import { allowed, refused } from "@/lib/studio/films";
import { pollGithub } from "@/lib/studio/github";

// Has the code been entered on github.com yet?
export async function POST(request: Request) {
  if (!allowed(request)) return refused();
  try {
    return Response.json({ result: await pollGithub() });
  } catch (error) {
    return failed(error);
  }
}
