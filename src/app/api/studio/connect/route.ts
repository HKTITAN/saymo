import { connectionsStatus } from "@/lib/studio/connect";
import { failed, originOf } from "@/lib/studio/connect-http";
import { allowed, refused } from "@/lib/studio/films";

// Which Drives and which GitHub library this studio saves to. Never any
// token: only names, addresses and settings.
export async function GET(request: Request) {
  if (!allowed(request)) return refused();
  try {
    return Response.json(await connectionsStatus(originOf(request)));
  } catch (error) {
    return failed(error);
  }
}
