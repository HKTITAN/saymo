"use client";

import { DialGroup, DialNote, DialSlider, DialText, DialToggle, LABEL, ROW } from "@/components/tool/dial";
import { type Film, type Param, SIZES } from "@/lib/studio/contract";
import { cn } from "@/lib/utils";
import { BrandRow } from "./brand-row";
import { ColorRow } from "./color-row";
import { Panel } from "./panel";

// The film's settings on the right: its size and length, then whatever the
// film exposes as params, each as a DialKit row. Changes show on the film at
// once and save a moment later.

export type Values = Record<string, Param["value"]>;

const SHORT: Record<string, string> = {
  "Wide 16:9": "16:9",
  "Square 1:1": "1:1",
  "Portrait 4:5": "4:5",
  "Story 9:16": "9:16",
};

export function Inspector({
  film,
  values,
  onParam,
  onSize,
  onDuration,
  folded,
  onFold,
  hidden,
  style,
  editLength,
  soundGroup,
  onBrand,
}: {
  onBrand?: (id: string) => void; // the film's brand kit
  film: Film;
  values: Values;
  onParam: (key: string, value: Param["value"]) => void;
  onSize: (width: number, height: number) => void;
  onDuration: (seconds: number, commit: boolean) => void;
  folded: boolean;
  onFold: (folded: boolean) => void;
  hidden: boolean;
  style?: React.CSSProperties;
  // A video film runs as long as its timeline, so its length isn't set here.
  editLength?: number;
  soundGroup?: React.ReactNode; // the film's sound design, last
}) {
  const size = SIZES.find((s) => s.width === film.width && s.height === film.height);
  return (
    <Panel
      title="Film"
      folded={folded}
      onFold={onFold}
      hidden={hidden}
      className="top-[68px] right-4 max-h-[calc(100dvh-160px)] w-[288px]"
      pillClassName="top-[68px] right-4"
      style={style}
      bodyClassName="flex flex-col gap-4 overflow-y-auto px-3 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <DialGroup title="Frame">
        <Choice
          label="Size"
          value={size?.label ?? ""}
          options={SIZES.map((s) => ({ value: s.label, label: SHORT[s.label] ?? s.label, hint: s.label }))}
          onChange={(label) => {
            const next = SIZES.find((s) => s.label === label);
            if (next) onSize(next.width, next.height);
          }}
        />
        {!size ? (
          <DialNote>
            {film.width} × {film.height} pixels
          </DialNote>
        ) : null}
        {onBrand ? <BrandRow value={film.brand ?? "aerchain"} onChange={onBrand} /> : null}
        {editLength !== undefined ? (
          <DialNote>
            The film runs as long as its timeline,{" "}
            <span className="font-mono tabular-nums">{editLength.toFixed(1)} s</span>. Changing the size keeps each
            clip framed where you put it.
          </DialNote>
        ) : (
          <DialSlider
            label="Length"
            value={film.duration}
            min={1}
            max={Math.max(30, Math.ceil(film.duration))}
            step={0.1}
            format={(v) => `${v.toFixed(1)} s`}
            onChange={(v) => onDuration(v, false)}
            onCommit={(v) => onDuration(v, true)}
          />
        )}
      </DialGroup>
      {editLength !== undefined && !film.params.length ? null : film.params.length ? (
        <DialGroup title="Settings">
          {film.params.map((p) => (
            <ParamRow key={p.key} param={p} value={values[p.key] ?? p.value} onChange={(v) => onParam(p.key, v)} />
          ))}
        </DialGroup>
      ) : (
        <DialNote>
          Ask Claude to add settings here, such as colours, speeds or words you want to change without asking again.
        </DialNote>
      )}
      {soundGroup}
    </Panel>
  );
}

export function ParamRow({ param, value, onChange }: { param: Param; value: Param["value"]; onChange: (v: Param["value"]) => void }) {
  switch (param.type) {
    case "number": {
      const min = param.min ?? 0;
      const max = param.max ?? Math.max(1, Number(param.value) * 2);
      const step = param.step ?? (max - min <= 2 ? 0.01 : max - min <= 20 ? 0.1 : 1);
      const decimals = step < 0.1 ? 2 : step < 1 ? 1 : 0;
      return (
        <DialSlider
          label={param.label}
          value={Number(value)}
          min={min}
          max={max}
          step={step}
          format={(v) => `${v.toFixed(decimals)}${param.unit ? ` ${param.unit}` : ""}`}
          onChange={onChange}
        />
      );
    }
    case "text":
      return <DialText label={param.label} value={String(value)} onChange={onChange} />;
    case "toggle":
      return <DialToggle label={param.label} checked={Boolean(value)} onChange={onChange} />;
    case "color":
      return <ColorRow label={param.label} value={String(value)} onChange={onChange} />;
    case "choice":
      return (
        <Choice
          label={param.label}
          value={String(value)}
          options={(param.options ?? []).map((o) => ({ value: o, label: o }))}
          onChange={onChange}
        />
      );
  }
}

// One of a few, as a segmented row: the label on the left, the choices on
// the right. Many or long choices wrap onto a second line under the label.
export function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string; hint?: string }[];
  onChange: (value: string) => void;
}) {
  const long = options.reduce((n, o) => n + o.label.length, 0) > 18;
  return (
    <div className={cn(ROW, long ? "h-auto flex-col items-stretch gap-1.5 p-1 ps-3 pt-2.5" : "ps-3 pe-1")}>
      <span className={LABEL}>{label}</span>
      <div className={cn("flex gap-0.5", long ? "flex-wrap" : "ms-auto")} role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            aria-label={o.hint}
            onClick={() => onChange(o.value)}
            className={cn(
              "h-7 cursor-pointer rounded-[7px] px-2.5 font-mono text-[11.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              !/\d/.test(o.label) && "font-sans text-[12px]",
              value === o.value ? "bg-white/[0.13] text-white" : "text-white/45 hover:text-white/75",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
