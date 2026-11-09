import type { Metadata } from "next";
import { Studio } from "@/components/studio/studio";

export const metadata: Metadata = {
  title: "Saymo",
  description: "Make Aerchain films by asking Claude, pointing at the film and tuning its settings",
};

export default function Page() {
  return <Studio />;
}
