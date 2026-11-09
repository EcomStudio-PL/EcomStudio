import React from "react";
import { Composition, Folder } from "remotion";
import { DURATION_FRAMES, FPS, HEIGHT, WIDTH } from "./config";
import { Main } from "./Main";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="GrovBaseRolka01"
      component={Main}
      durationInFrames={DURATION_FRAMES}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={{ showSafeZones: false, withMusic: true }}
    />
    <Folder name="QA">
      <Composition
        id="GrovBaseRolka01-SafeZones"
        component={Main}
        durationInFrames={DURATION_FRAMES}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        defaultProps={{ showSafeZones: true, withMusic: true }}
      />
      <Composition
        id="GrovBaseRolka01-NoMusic"
        component={Main}
        durationInFrames={DURATION_FRAMES}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        defaultProps={{ showSafeZones: false, withMusic: false }}
      />
    </Folder>
  </>
);
