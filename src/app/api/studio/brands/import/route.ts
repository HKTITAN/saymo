import { importBrand } from "@/lib/studio/brands";
import { allowed, refused } from "@/lib/studio/films";

// A kit .zip that another studio exported.
export async function POST(request: Request) {
  if (!allowed(request)) return refused();
  if (!request.body) return Response.json({ error: "Send the kit's .zip file." }, { status: 400 });
  try {
    return Response.json(await importBrand(request.body), { status: 201 });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
