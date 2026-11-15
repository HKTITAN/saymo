import type { Metadata } from "next";
import { Viewer } from "@/components/viewer";

export const metadata: Metadata = {
  title: "Sample post",
  description: "An animated speaker post, made in code"
};

export default function Page() {
  return <Viewer />;
}
