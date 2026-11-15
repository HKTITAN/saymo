import type { Metadata } from "next";
import { Tool } from "@/components/tool/tool";

export const metadata: Metadata = {
  title: "Speaker post tool",
  description: "Make speaker posts: edit the words and pictures, then download the video",
};

export default function Page() {
  return <Tool />;
}
