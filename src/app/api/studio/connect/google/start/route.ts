import { failed, originOf, safeReturn } from "@/lib/studio/connect/connect-http";
import { allowed, refused } from "@/lib/studio/films/films";
import { googleSignInUrl } from "@/lib/studio/connect/google";

// One click: sends the browser to Google to pick an account and allow the
// studio its own folder. ?returnTo=/studio?film=… is where it comes back.
export async function GET(request: Request) {
  if (!allowed(request)) return refused();
  try {
    const back = safeReturn(new URL(request.url).searchParams.get("returnTo"));
    return Response.redirect(googleSignInUrl(originOf(request), back), 302);
  } catch (error) {
    return failed(error);
  }
}
