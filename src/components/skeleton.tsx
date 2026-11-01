"use client";

import { SkulletProvider } from "skullet/react";
import type { ReactNode } from "react";

export { Skeleton } from "skullet/react";

// Loading states for the tool and the studio, drawn by skullet: while data
// loads, the content is laid out unseen and drawn as quiet shapes that take
// exactly its space, so nothing moves when it arrives. The shapes are the
// same faint white the interface uses for its rows, with one slow shimmer
// across the page. (The post at / doesn't use this: its export must not
// change.)
const THEME = {
  light: { base: "rgb(0 0 0 / 0.07)", highlight: "rgb(255 255 255 / 0.6)" },
  dark: { base: "rgb(255 255 255 / 0.06)", highlight: "rgb(255 255 255 / 0.1)" },
  animation: "shimmer" as const,
  speed: "slow" as const,
  radius: "8px",
};

export function SkeletonProvider({ children }: { children: ReactNode }) {
  return (
    <SkulletProvider mode="dark" theme={THEME} reveal="smart">
      {children}
    </SkulletProvider>
  );
}
