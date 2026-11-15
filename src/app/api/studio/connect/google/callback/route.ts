import { originOf, safeReturn } from "@/lib/studio/connect/connect-http";
import { ConnectError } from "@/lib/studio/connect/connect-store";
import { allowed, refused } from "@/lib/studio/films/films";
import { finishGoogleSignIn } from "@/lib/studio/connect/google";

// Where Google sends the browser back. The `state` must match a sign-in
// this studio started, or nothing happens.
export async function GET(request: Request) {
  if (!allowed(request)) return refused();
  const q = new URL(request.url).searchParams;
  const back = (to: string, params: Record<string, string>) => {
    const url = new URL(safeReturn(to), originOf(request));
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return Response.redirect(url.toString(), 302);
  };
  try {
    const to = await finishGoogleSignIn(q.get("state"), q.get("code"), q.get("error"));
    return back(to, { connected: "google" });
  } catch (error) {
    const message = error instanceof ConnectError ? error.message : "Google Drive wasn't connected. Try again.";
    const to = (error as { returnTo?: string }).returnTo ?? "/studio";
    return back(to, { connect_error: message });
  }
}
