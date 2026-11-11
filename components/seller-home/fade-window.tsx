"use client";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A MASONRY WINDOW THAT IS ONLY AS TALL AS ITS PHOTOS (Sesje produktowe, the
 * showcase's results). It shows at most the window's height — `maxHeight`, a
 * container-relative length per breakpoint — and fewer photos simply make it
 * shorter: no empty band, no fade over nothing.
 *
 * Cut (the photos go on past the window): the bottom fades and the button sits
 * over the fade, as always. Not cut: no fade, and the button sits under the
 * photos with an ordinary gap. Which one is measured here (the server's
 * estimate is only the first paint), again on every resize.
 */
export function FadeWindow({ initialCut, frameClassName, style, cta, children }: {
  initialCut: boolean;
  /** The per-breakpoint max-height classes (reading the style's variables). */
  frameClassName: string;
  style: CSSProperties;
  cta?: ReactNode;
  children: ReactNode;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [cut, setCut] = useState(initialCut);
  useEffect(() => {
    const f = frame.current;
    const c = content.current;
    if (!f || !c) return;
    const check = () => setCut(c.scrollHeight > f.clientHeight + 1);
    const ro = new ResizeObserver(check);
    ro.observe(f);
    ro.observe(c);
    check();
    return () => ro.disconnect();
  }, []);
  return (
    <div className="group/fade relative [container-type:inline-size]" data-cut={cut || undefined} style={style}>
      <div ref={frame} data-fade-gallery
        className={cn("relative overflow-hidden group-data-[cut]/fade:[mask-image:linear-gradient(to_bottom,black_72%,transparent_99%)]", frameClassName)}>
        <div ref={content}>{children}</div>
      </div>
      {cta && (
        <div className="relative mt-3 flex justify-center group-data-[cut]/fade:absolute group-data-[cut]/fade:inset-x-0 group-data-[cut]/fade:bottom-[5%] group-data-[cut]/fade:mt-0"
          data-fade-cta>
          {cta}
        </div>
      )}
    </div>
  );
}
