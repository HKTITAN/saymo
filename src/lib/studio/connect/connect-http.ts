import { ConnectError } from "./connect-store";

// Shared by the connection routes: the address the studio was opened at
// (for Google's return address), and plain-English failures.

export const originOf = (request: Request) => `http://${request.headers.get("host") ?? "localhost:3200"}`;

export function failed(error: unknown) {
  if (error instanceof ConnectError) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ error: "Unable to finish that. Try again, and if it keeps failing, restart the studio." }, { status: 500 });
}

// Only pages of the studio itself, never another site.
export const safeReturn = (to: string | null) => (to && /^\/studio(?:[/?#]|$)/.test(to) && !to.startsWith("//") ? to : "/studio");
