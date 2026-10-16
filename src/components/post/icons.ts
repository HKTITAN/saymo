import { Calendar04Icon, Location01Icon } from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";

// Hugeicons for the event details, as line icons. The calendar gets one
// marked day, as in the event's own artwork.
export const EVENT_ICONS: Record<"date" | "location", IconSvgElement> = {
  date: [
    ...Calendar04Icon,
    ["circle", { cx: "12", cy: "16", r: "2", stroke: "currentColor", strokeWidth: "1.5", key: "day" }],
  ],
  location: Location01Icon,
};
