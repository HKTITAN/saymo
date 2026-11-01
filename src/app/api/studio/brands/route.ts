import { createBrand, listBrands } from "@/lib/studio/brands";
import { allowed, refused } from "@/lib/studio/films";

export async function GET(request: Request) {
  if (!allowed(request)) return refused();
  return Response.json(await listBrands());
}

// A new kit, empty but for Aerchain's shape.
export async function POST(request: Request) {
  if (!allowed(request)) return refused();
  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name : "New brand";
  return Response.json(await createBrand(name), { status: 201 });
}
