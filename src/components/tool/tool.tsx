"use client";

import { useSyncExternalStore } from "react";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Dashboard } from "./dashboard";
import { Editor } from "./editor";
import { currentSearch, subscribe } from "./nav";

export function Tool() {
  // Read on the client only, like the viewer: the server renders nothing.
  const search = useSyncExternalStore(subscribe, currentSearch, () => null);
  if (search === null) return null;
  const id = new URLSearchParams(search).get("post");

  return (
    <ToastProvider position="bottom-center">
      <TooltipProvider>{id ? <Editor key={id} id={id} /> : <Dashboard />}</TooltipProvider>
    </ToastProvider>
  );
}
