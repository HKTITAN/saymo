import { post } from "@/content/post";

// The same post and motions, with and without the city skyline. `suffix` is
// added to the exported file names.
export const VERSIONS = [
  { id: "original", label: "Version 1", hint: "The lines on their own", suffix: "" },
  {
    id: "skyline",
    label: "Version 2",
    hint: `With the ${post.skyline.landmark}`,
    suffix: "-skyline",
  },
] as const;

export type VersionId = (typeof VERSIONS)[number]["id"];

export const isVersion = (v: string | null): v is VersionId =>
  VERSIONS.some((x) => x.id === v);
