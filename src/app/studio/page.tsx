import type { Metadata } from "next";
import { Studio } from "@/components/studio/studio";
import { THEME_SCRIPT } from "@/components/studio/theme-script";

export const metadata: Metadata = {
  title: "Saymo",
  description: "Make Aerchain films by asking Claude, pointing at the film and tuning its settings",
};

export default function Page() {
  return (
    <>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed script that sets the chosen theme before paint */}
      <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      <Studio />
    </>
  );
}
