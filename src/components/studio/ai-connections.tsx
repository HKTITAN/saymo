"use client";

import { type ReactNode, useCallback, useEffect, useId, useState } from "react";
import { BotIcon, ChevronDownIcon, CopyIcon, KeyLeftIcon } from "@/components/icons";
import { DialButton, DialNote, LABEL, ROW } from "@/components/tool/dial";
import { type AiStatus, PROVIDERS, type ProviderState, type ProviderStatus } from "@/lib/studio/ai-types";
import { IS_PRODUCT } from "@/lib/studio/edition";
import { cn } from "@/lib/utils";
import { aiApi } from "./ai-api";
import { StudioError } from "./api";

// The AI part of the Connections pop-up: which AIs can make a film's
// changes on this Mac, whether each is ready, and how to set it up. Claude
// on the owner's plan is the default; Codex runs on a ChatGPT plan; the API
// key is for teammates without a plan. The product edition shows the API
// key alone (the server sends only that one). Nothing secret ever reaches here:
// the saved key shows as its last 4 characters at most.

export const STATE_WORDS: Record<ProviderState, string> = {
  ready: "Signed in",
  "not-installed": "Not installed",
  "sign-in": "Sign in needed",
  "no-key": "No key yet",
  unknown: "Checking",
};

// A saved key isn't a sign-in, so it says so.
export const stateWords = (s: ProviderStatus) => (s.id === "api-key" && s.state === "ready" ? "Key saved" : STATE_WORDS[s.state]);

const message = (e: unknown, fallback: string) => (e instanceof StudioError ? e.message : fallback);

export function AiSection() {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async (fresh: boolean) => {
    setChecking(true);
    try {
      setStatus(await aiApi.status(fresh));
      setError(null);
    } catch (e) {
      setError(message(e, "Unable to check the AIs. Try again."));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- checks the AIs when the pop-up opens
    void load(false);
  }, [load]);

  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="flex items-center gap-2 px-1 font-medium text-[12px] text-white/85 [&_svg]:size-3.5 [&_svg]:text-white/55">
        <BotIcon aria-hidden="true" />
        AI
      </h3>
      <DialNote>
        {IS_PRODUCT
          ? "Claude makes your changes, paid for by your own Anthropic API key."
          : "Which AI makes your changes. Pick one in each prompt box; Claude is the default."}
      </DialNote>
      {error ? <p className="rounded-[10px] bg-[#ff9592]/10 px-3 py-2 text-[11.5px] text-[#ff9592] leading-relaxed">{error}</p> : null}
      {status ? (
        status.providers.map((p) => (
          <Provider key={p.id} status={p} isDefault={status.providers.length > 1 && p.id === status.default} onStatus={setStatus} onError={setError} />
        ))
      ) : !error ? (
        <p className="px-1 pb-1 text-[11.5px]">
          <span className="studio-shimmer">Checking the AIs</span>
        </p>
      ) : null}
      {status ? (
        <DialButton loading={checking} onClick={() => void load(true)}>
          Check again
        </DialButton>
      ) : null}
    </section>
  );
}

function Provider({
  status,
  isDefault,
  onStatus,
  onError,
}: {
  status: ProviderStatus;
  isDefault: boolean;
  onStatus: (status: AiStatus) => void;
  onError: (error: string | null) => void;
}) {
  const [showSetup, setShowSetup] = useState(false);
  const setupId = useId();
  const ready = status.state === "ready";
  const facts = [status.plan, status.model].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col gap-1 rounded-[12px] bg-white/[0.03] p-1">
      <div className={cn(ROW, "gap-3 px-3")}>
        <span className={cn(LABEL, "text-white/85")}>{PROVIDERS[status.id].name}</span>
        {isDefault ? <span className="text-[11px] text-white/35">Default</span> : null}
        <span className={cn("ms-auto flex items-center gap-1.5 truncate", ready ? "text-white/70" : "text-[#ff9a5c]")}>
          <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", ready ? "bg-[#3dd68c]" : "bg-[#ff9a5c]")} />
          {stateWords(status)}
        </span>
      </div>
      <p className="px-3 text-[11px] text-white/40 leading-relaxed">{facts || PROVIDERS[status.id].via}</p>
      {status.detail ? <p className="px-3 text-[11px] text-white/60 leading-relaxed">{status.detail}</p> : null}
      {status.id === "api-key" ? <ApiKey status={status} onStatus={onStatus} onError={onError} /> : null}
      <button
        type="button"
        aria-expanded={showSetup}
        aria-controls={setupId}
        onClick={() => setShowSetup((s) => !s)}
        className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-[9px] px-3 text-left text-[12px] text-white/60 outline-none transition-colors hover:bg-white/[0.06] hover:text-white/85 focus-visible:ring-2 focus-visible:ring-ring"
      >
        How to set up
        <ChevronDownIcon aria-hidden="true" className={cn("ms-auto size-3.5 text-white/40 transition-transform duration-200", !showSetup && "-rotate-90")} />
      </button>
      <div id={setupId} hidden={!showSetup} className="px-1 pb-1">
        <Steps status={status} />
      </div>
    </div>
  );
}

function Steps({ status }: { status: ProviderStatus }) {
  const commands = status.setup.some((s) => s.command);
  return (
    <div className="flex flex-col gap-1.5 rounded-[10px] bg-white/[0.04] px-3 py-2.5 text-[11.5px] text-white/60 leading-relaxed">
      <ol className="flex list-decimal flex-col gap-1.5 ps-4">
        {status.setup.map((step) => (
          <li key={step.text}>
            {step.text}
            {step.command ? (
              <div className="mt-1">
                <Command command={step.command} />
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      {commands ? (
        <p className="text-white/40">
          Run these in Terminal, or in Claude Code by typing <span className="font-mono text-white/60">!</span> and a space before the command. Then press Check again.
        </p>
      ) : null}
    </div>
  );
}

// A command in a box: click to copy it.
function Command({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(command).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      aria-label={`Copy: ${command}`}
      className="flex min-h-8 cursor-pointer items-center gap-2 rounded-[8px] bg-white/[0.06] px-2.5 py-1.5 text-left font-mono text-[11px] text-white/80 outline-none hover:bg-white/[0.09] focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5 [&_svg]:shrink-0"
    >
      <span className="min-w-0 flex-1 break-all">{command}</span>
      {copied ? <span className="font-sans text-white/50">Copied</span> : <CopyIcon aria-hidden="true" />}
    </button>
  );
}

// ─── The API key ──────────────────────────────────────────────────────────

function ApiKey({
  status,
  onStatus,
  onError,
}: {
  status: ProviderStatus;
  onStatus: (status: AiStatus) => void;
  onError: (error: string | null) => void;
}) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const inputId = useId();

  const act = async (job: () => Promise<AiStatus>, fallback: string) => {
    onError(null);
    setBusy(true);
    try {
      onStatus(await job());
      setKey("");
      setAsking(false);
    } catch (e) {
      onError(message(e, fallback));
    } finally {
      setBusy(false);
    }
  };

  if (status.keyEnding) {
    return (
      <>
        <Row label="Key">
          <span className="text-white/70">
            Saved, ends in <span className="font-mono">{status.keyEnding}</span>
          </span>
        </Row>
        {asking ? (
          <div className="flex flex-col gap-1.5 rounded-[10px] bg-white/[0.04] p-2">
            <p className="px-1 text-[11.5px] text-white/65 leading-relaxed">
              {IS_PRODUCT
                ? "The studio forgets the key. Claude stops working here until you add one again."
                : "The studio forgets the key. Prompts sent to the API key stop working until you add one again."}
            </p>
            <div className="flex gap-1.5">
              <DialButton onClick={() => setAsking(false)}>Cancel</DialButton>
              <DialButton
                loading={busy}
                className="bg-[#ff9592]/12 text-[#ff9592] hover:bg-[#ff9592]/20"
                onClick={() => void act(() => aiApi.removeKey(), "Unable to remove the key. Try again.")}
              >
                Remove key
              </DialButton>
            </div>
          </div>
        ) : (
          <DialButton onClick={() => setAsking(true)} className="text-white/55">
            Remove key
          </DialButton>
        )}
      </>
    );
  }

  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (key.trim()) void act(() => aiApi.saveKey(key.trim()), "Unable to save the key. Try again.");
      }}
    >
      <label
        htmlFor={inputId}
        className={cn(
          ROW,
          "cursor-text gap-3 px-3 hover:bg-white/[0.07] has-[:focus-visible]:bg-white/[0.08] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-white/45",
        )}
      >
        <KeyLeftIcon aria-hidden="true" />
        <span className={LABEL}>Key</span>
        <input
          id={inputId}
          type="password"
          value={key}
          autoComplete="off"
          spellCheck={false}
          placeholder="sk-ant-…"
          onChange={(e) => setKey(e.target.value)}
          className="h-full min-w-0 flex-1 bg-transparent text-right font-mono text-white/90 outline-none placeholder:text-white/30"
        />
      </label>
      <DialButton type="submit" loading={busy} disabled={!key.trim()} className="bg-white text-[#141414] hover:bg-white/90">
        Save key
      </DialButton>
      <DialNote>
        {IS_PRODUCT ? "Kept on this Mac only, and used only when the studio asks Claude." : "Kept on this Mac only, and used only for prompts sent to the API key."}
      </DialNote>
    </form>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={cn(ROW, "gap-3 px-3")}>
      <span className={LABEL}>{label}</span>
      <span className="ms-auto flex min-w-0 items-center gap-2 truncate text-white/85">{children}</span>
    </div>
  );
}
