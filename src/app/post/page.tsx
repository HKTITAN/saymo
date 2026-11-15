import type { Metadata } from "next";
import { Viewer } from "@/components/viewer";

export const metadata: Metadata = {
  title: "Sample post",
  description: "The sample speaker post the post tool is built on",
};

export default function Page() {
  return <Viewer />;
}
