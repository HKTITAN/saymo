import { Composition } from "remotion";
import { AerchainBands } from "./AerchainBands.jsx";
import { DURATION, FPS, H, W } from "./bands.js";

// Every composition the studio can render with Remotion. Each id here is
// listed in studio/compositions.json.
export const RemotionRoot = () => (
  <Composition
    id="aerchain-bands"
    component={AerchainBands}
    durationInFrames={DURATION * FPS}
    fps={FPS}
    width={W}
    height={H}
    defaultProps={{ engine: "Remotion" }}
  />
);
