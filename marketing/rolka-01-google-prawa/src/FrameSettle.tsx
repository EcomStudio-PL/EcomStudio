import { useLayoutEffect } from "react";
import { continueRender, delayRender, useCurrentFrame } from "remotion";

/**
 * Render-stability guard. Heavy frames (motion-blur samples, many 3D layers) can make the headless
 * compositor hand over a frame in which an overlay layer (caption / headline) still shows the previous
 * state. Holding every frame for three animation frames lets raster finish before the screenshot.
 * Verified by rendering twice with different concurrency and comparing frames (see QA.md).
 */
export const FrameSettle: React.FC = () => {
  const frame = useCurrentFrame();
  useLayoutEffect(() => {
    const handle = delayRender(`settle frame ${frame}`);
    let id = 0;
    let n = 0;
    const tick = () => {
      n += 1;
      if (n >= 3) continueRender(handle);
      else id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(id);
      continueRender(handle);
    };
  }, [frame]);
  return null;
};
