"use client";

import { RefreshIcon } from "@/components/icons";
import { DialButton, DialGroup, DialNote, DialSlider, DialToggle } from "@/components/tool/dial";
import type { SoundState } from "./use-sound";

// The film's sound design in the inspector: on or off for the film and its
// renders, how loud, a mute just for listening while you work, a fresh
// render of the score, and quick requests that go to Claude like any prompt.

const IDEAS = ["Calmer", "More punch on the orange"];

export function SoundGroup({
  sound,
  isVideo,
  claudeBusy,
  onOn,
  onVolume,
  onPrompt,
}: {
  sound: SoundState;
  isVideo: boolean;
  claudeBusy: boolean;
  onOn: (on: boolean) => void;
  onVolume: (volume: number, commit: boolean) => void;
  onPrompt: (prompt: string) => void;
}) {
  const { status, error } = sound;
  const rendering = status.state === "rendering";
  const failed = error ?? (status.state === "failed" ? status.message : null);

  if (status.state === "none" && !error) {
    return (
      <DialGroup title="Sound">
        <DialButton disabled={claudeBusy} onClick={() => onPrompt("Add sound design")}>
          Ask Claude to design the sound
        </DialButton>
        <DialNote>Claude writes music and sound effects that land on the film’s moments.</DialNote>
      </DialGroup>
    );
  }

  const ideas = isVideo ? [...IDEAS, "Duck under the speech"] : IDEAS;
  return (
    <DialGroup title="Sound">
      <DialToggle label="In the film" checked={sound.sound.on} onChange={onOn} />
      <DialSlider
        label="Volume"
        value={sound.sound.volume}
        min={0}
        max={1.5}
        step={0.05}
        disabled={!sound.sound.on}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => onVolume(v, false)}
        onCommit={(v) => onVolume(v, true)}
      />
      <DialToggle label="Mute while I work" checked={sound.muted} onChange={sound.setMuted} />
      {rendering ? (
        <p className="overflow-hidden px-1 text-[11.5px]">
          <span key={status.step} className="studio-shimmer block animate-in truncate fade-in slide-in-from-bottom-1 duration-200">
            {status.step || "Composing the sound…"}
          </span>
        </p>
      ) : failed ? (
        <p className="px-1 text-[11.5px] text-[#ff9592] leading-relaxed">The sound couldn’t be made. {failed}</p>
      ) : null}
      <DialButton loading={rendering} onClick={() => void sound.render()}>
        <RefreshIcon aria-hidden="true" />
        {failed ? "Try again" : "Make it again"}
      </DialButton>
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        {ideas.map((idea) => (
          <button
            key={idea}
            type="button"
            disabled={claudeBusy}
            onClick={() => onPrompt(idea)}
            className="h-7 cursor-pointer rounded-[8px] bg-white/[0.05] px-2.5 text-[12px] text-white/65 outline-none transition-colors hover:bg-white/[0.09] hover:text-white focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-45"
          >
            {idea}
          </button>
        ))}
      </div>
    </DialGroup>
  );
}
