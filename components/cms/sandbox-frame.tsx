"use client";
import { useEffect, useRef, useState } from "react";

/**
 * A CUSTOM BLOCK THAT RUNS JAVASCRIPT, KEPT WHERE IT CANNOT REACH ANYTHING.
 *
 * `sandbox="allow-scripts"` WITHOUT `allow-same-origin` puts the document in
 * an opaque origin of its own. Everything the brief forbids follows from that
 * one omission, not from a list of blocked APIs:
 *
 *   · `document.cookie` is a different origin's cookie jar — so the session
 *     token is unreachable;
 *   · `localStorage` / `sessionStorage` / IndexedDB are per-origin, and an
 *     opaque origin has none;
 *   · `window.parent.document` throws — the page around it, including the
 *     admin panel when previewing, cannot be read or rewritten;
 *   · `fetch("/api/…")` carries no credentials it could borrow, and our own
 *     routes answer only an authenticated session.
 *
 * Nothing here calls eval(). The code is handed to the browser as the body of
 * a document and parsed by the HTML parser, which is the same mechanism a
 * <script> tag has always used.
 *
 * HEIGHT. An iframe has no intrinsic height, and a fixed one either clips the
 * block or leaves a hole under it. The document measures itself and posts the
 * number out; this side accepts it only from its OWN frame and only as a
 * bounded number, because a message is input like any other.
 */

/** A block is a section of a page, not a scroll region: 20000px is past any
 *  honest layout and stops a runaway loop from growing the page forever. */
const MAX_HEIGHT = 20_000;
const MIN_HEIGHT = 40;

export function SandboxFrame({ srcDoc, title, className }: {
  srcDoc: string; title: string; className?: string;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(MIN_HEIGHT);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // A sandboxed frame has a null origin, so the origin cannot identify it.
      // The source window can: only the frame this component owns is heard.
      if (!ref.current || event.source !== ref.current.contentWindow) return;
      const data = event.data as { type?: unknown; height?: unknown };
      if (!data || data.type !== "cms:height") return;
      const value = Number(data.height);
      if (!Number.isFinite(value)) return;
      setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(value))));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <iframe
      ref={ref}
      title={title}
      srcDoc={srcDoc}
      // allow-same-origin is absent ON PURPOSE. Adding it would hand the
      // block our origin and undo every guarantee in the comment above.
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
      // The block may open a link; it may not navigate the page around it.
      referrerPolicy="no-referrer"
      loading="lazy"
      style={{ height }}
      className={className ?? "w-full border-0"}
    />
  );
}
