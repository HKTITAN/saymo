import { copyFile, rm } from "node:fs/promises";
import path from "node:path";
import { checkKit, createBrand, kitDir, MAX_FILE, saveBrandFile, withBrand, writeBrand } from "@/lib/studio/brands";
import { allowed, refused, ROOT } from "@/lib/studio/films";
import { checkStyle, type FacePick, type KitFont, kitOf, SHIPPED_FONTS } from "@/lib/studio/personal-style";

// A personal style (personal-style.ts) made into an ordinary kit, in one go:
// a blank kit as "New kit" makes, the chosen fonts (copied from
// studio/fonts/ with their licence, or uploaded), the photo or mark, then
// brand.json, checked like any kit the page saves. If anything fails, the
// half-made kit goes.
//
// POST multipart: `style` (JSON), and the files `photo`, `heading`, `text`.

const FONT_FILE = /\.(ttf|otf|woff2?)$/i;
const LOGO_FILE = /\.(svg|png|webp)$/i;
const fontsDir = path.join(ROOT, "studio/fonts");

export async function POST(request: Request) {
  if (!allowed(request)) return refused();
  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: "Send the style as a form." }, { status: 400 });
  let raw: unknown = null;
  try {
    raw = JSON.parse(String(form.get("style") ?? ""));
  } catch {}
  const style = checkStyle(raw);
  if (typeof style === "string") return Response.json({ error: style }, { status: 400 });

  const fileOf = (key: string, kind: RegExp): File | null => {
    const v = form.get(key);
    return v instanceof File && v.size > 0 && v.size <= MAX_FILE && kind.test(v.name) ? v : null;
  };
  const photo = fileOf("photo", LOGO_FILE);
  const uploads = { heading: fileOf("heading", FONT_FILE), text: fileOf("text", FONT_FILE) };
  for (const pick of [style.heading, style.body]) {
    if ("upload" in pick && !uploads[pick.upload]) return Response.json({ error: "Upload the font again: send a TTF, OTF or WOFF2 file." }, { status: 400 });
  }

  const made = await createBrand(style.name);
  const id = made.id;
  try {
    const kit = await withBrand(id, async () => {
      const dir = kitDir(id);
      const saved = new Map<string, KitFont>();
      const place = async (pick: FacePick): Promise<KitFont> => {
        const key = "shipped" in pick ? `shipped:${pick.shipped}` : `upload:${pick.upload}`;
        const done = saved.get(key);
        if (done) return done;
        let font: KitFont;
        if ("shipped" in pick) {
          const f = SHIPPED_FONTS.find((s) => s.id === pick.shipped);
          if (!f) throw new Error("That font isn't in the studio any more. Pick another.");
          const base = f.file.replace(/\.[^.]+$/, "");
          await copyFile(path.join(fontsDir, f.id, f.file), path.join(dir, "fonts", f.file));
          await copyFile(path.join(fontsDir, f.id, "OFL.txt"), path.join(dir, "fonts", `${base}-OFL.txt`));
          font = { family: f.family, file: `fonts/${f.file}`, weights: f.weights, ...(f.axes ? { axes: f.axes } : {}), licence: `OFL, see fonts/${base}-OFL.txt` };
        } else {
          const upload = uploads[pick.upload] as File;
          const file = await saveBrandFile(id, upload.name, upload.stream(), "fonts");
          font = { family: pick.family, file, weights: pick.weights, ...(pick.axes ? { axes: pick.axes } : {}), licence: "Uploaded, so check its licence before sharing" };
        }
        saved.set(key, font);
        return font;
      };
      const heading = await place(style.heading);
      const body = await place(style.body);
      let logo: { file: string; kind: "Photo" | "Mark" } | null = null;
      if (photo) {
        const file = await saveBrandFile(id, photo.name, photo.stream(), "logos");
        logo = { file, kind: /\.svg$/i.test(photo.name) ? "Mark" : "Photo" };
      }
      const checked = checkKit(id, kitOf(style, { heading, body }, logo), made);
      if (typeof checked === "string") throw new Error(checked);
      await writeBrand(checked);
      return checked;
    });
    return Response.json(kit, { status: 201 });
  } catch (error) {
    await rm(kitDir(id), { recursive: true, force: true });
    return Response.json({ error: (error as Error).message || "The style couldn't be saved. Try again." }, { status: 400 });
  }
}
