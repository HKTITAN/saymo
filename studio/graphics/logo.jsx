import { useCurrentFrame, useVideoConfig } from "remotion";
import { BrandLogo, clamp01, landing } from "studio-kit";

// LOGO IN THE CORNER: the Aerchain wordmark held in a corner over footage.
//   0.00  it slides in a little from the right and fades up
//   end-0.5  it fades out
export default function Logo({ values, duration }) {
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const u = Math.min(W, H) / 1080;
  const t = frame / fps;
  const h = Math.round(Number(values.size) * u);
  const margin = Math.round(56 * u);
  const corner = String(values.corner);
  const p = landing(t / 0.6);
  const out = clamp01((t - (duration - 0.5)) / 0.5);
  return (
    <div
      data-part="logo"
      style={{
        position: "absolute",
        [corner.includes("right") ? "right" : "left"]: margin,
        [corner.startsWith("Top") ? "top" : "bottom"]: margin,
        opacity: p * (1 - out),
        transform: `translateX(${(1 - p) * 24 * u}px)`,
      }}
    >
      <BrandLogo height={h} ground={values.tone === "Dark" ? "light" : "dark"} letters={values.tone === "Dark" ? "#141414" : "#E9E5DD"} />
    </div>
  );
}
