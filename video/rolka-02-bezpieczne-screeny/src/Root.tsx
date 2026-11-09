import React from "react";
import { Composition } from "remotion";
import { Rolka02 } from "./Rolka02";
import { DURATION_IN_FRAMES, FPS, HEIGHT, WIDTH } from "./timing";

export const RemotionRoot: React.FC = () => (
  <Composition
    id="GrovBaseRolka02"
    component={Rolka02}
    durationInFrames={DURATION_IN_FRAMES}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
  />
);
