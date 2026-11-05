"use client";

import { Popover } from "@base-ui/react/popover";
import { useEffect, useState } from "react";
import { MicOnIcon } from "@/components/icons";
import { DialSlider, SURFACE } from "@/components/tool/dial";
import { cn } from "@/lib/utils";
import { StudioError } from "./api";
import { Hint, ICON_BUTTON, PILL_BUTTON } from "./panel";
import { type VoiceInfo, videoApi } from "./video-api";

// A voiceover from typed words: pick a voice (Indian voices first, Rishi
// by default) and a pace, and the reading lands in the bin like any sound
// file, ready to place, trim and caption.
export function VoiceoverButton({ id, onMade }: { id: string; onMade: () => void }) {
  const [open, setOpen] = useState(false);
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [voice, setVoice] = useState("Rishi");
  const [rate, setRate] = useState(175);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || voices.length) return;
    videoApi
      .voices()
      .then((v) => {
        setVoices(v.voices);
        setVoice(v.defaultVoice);
      })
      .catch(() => setError("Unable to list the voices. Try again."));
  }, [open, voices.length]);

  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      await videoApi.voiceover(id, { text, voice, rate });
      setText("");
      setOpen(false);
      onMade();
    } catch (e) {
      setError(e instanceof StudioError ? e.message : "The voiceover couldn't be made. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Hint label="Add a voiceover">
        <Popover.Trigger className={ICON_BUTTON} aria-label="Add a voiceover">
          <MicOnIcon aria-hidden="true" />
        </Popover.Trigger>
      </Hint>
      <Popover.Portal>
        <Popover.Positioner side="right" align="start" sideOffset={12} collisionPadding={12} className="z-50">
          <Popover.Popup
            className={cn(
              SURFACE,
              "flex w-[300px] origin-(--transform-origin) flex-col gap-1.5 p-2 outline-none transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0",
            )}
          >
            <p className="px-1 pt-0.5 pb-1 font-medium text-[12px] text-white/85">Voiceover</p>
            <textarea
              value={text}
              rows={4}
              placeholder="Welcome to the product launch"
              aria-label="Words to read out"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim() && !busy) void make();
              }}
              className="w-full resize-none rounded-[10px] bg-white/[0.05] px-3 py-2 text-[12.5px] text-white/90 leading-relaxed outline-none placeholder:text-white/30 focus-visible:bg-white/[0.08] focus-visible:ring-1 focus-visible:ring-white/15"
            />
            <div className="flex flex-col gap-0.5 rounded-[10px] bg-white/[0.05] p-0.5" role="radiogroup" aria-label="Voice">
              {voices.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  role="radio"
                  aria-checked={voice === v.id}
                  disabled={!v.installed}
                  onClick={() => setVoice(v.id)}
                  className={cn(
                    "flex h-8 cursor-pointer items-center justify-between rounded-[8px] px-2.5 text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-40",
                    voice === v.id ? "bg-white/[0.13] text-white" : "text-white/60 hover:text-white/85",
                  )}
                >
                  {v.label}
                  <span className="text-[11px] text-white/40">{v.installed ? v.accent : "Not on this Mac"}</span>
                </button>
              ))}
            </div>
            <DialSlider
              label="Pace"
              value={rate}
              min={120}
              max={240}
              step={5}
              format={(v) => (Math.abs(v - 175) < 3 ? "Normal" : v < 175 ? "Slower" : "Faster")}
              onChange={setRate}
            />
            {busy ? (
              <p className="h-8 px-1 pt-2 text-[11.5px]">
                <span className="studio-shimmer">Recording the voiceover</span>
              </p>
            ) : (
              <button
                type="button"
                disabled={!text.trim()}
                onClick={() => void make()}
                className={cn(PILL_BUTTON, "justify-center bg-white text-black hover:bg-white/90")}
              >
                Read it out
              </button>
            )}
            {error ? <p className="px-1 text-[11.5px] text-[#ff9592] leading-relaxed">{error}</p> : null}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
