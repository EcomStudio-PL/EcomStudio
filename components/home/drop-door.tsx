"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthDialog } from "@/components/auth/auth-dialog-context";

/**
 * THE UPLOAD BOX, AS FAR AS THE POINTER AND A DROPPED FILE ARE CONCERNED.
 *
 * The box on the Home looks like the place to drop a photograph because it is
 * where the work starts, and people drop photographs on things that look like
 * that. Without this, the browser's own default wins: it NAVIGATES to the
 * file, and the seller is thrown off GrovBase onto a bare image tab.
 *
 * What a drop does instead is exactly what the button does — open the page's
 * primary action (Generator Grovshot, or the tool hub when the generator is
 * closed), or, for a visitor, the existing sign-in dialog pointed at it. The
 * upload itself belongs to the generator's own session, where a photograph is
 * tied to a product, priced and sent to a model; there is no handoff into it
 * from outside, and this component does not invent one. Nothing is read,
 * stored or sent from here — the drop is a way IN, and the generator is where
 * the photograph is added.
 *
 * A PRESS anywhere on the box outside its button does the same: the box is one
 * target, and its button stays the one focusable link (a click that lands on a
 * link is left to that link).
 *
 * The highlight while a file is held over the box counts enters and leaves
 * rather than trusting `dragleave.relatedTarget`, which WebKit reports as null
 * — the glow would otherwise flicker at every child boundary in Safari.
 */
export function DropDoor({ href, signedIn, className, children }: {
  href: string | null;
  signedIn: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const auth = useAuthDialog();
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const holdsFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  const go = () => {
    if (!href) return;
    if (signedIn) router.push(href);
    else auth.open("login", href);
  };

  return (
    <div
      className={className}
      data-over={over ? "1" : undefined}
      onDragEnter={(e) => {
        if (!holdsFiles(e)) return;
        e.preventDefault();
        depth.current += 1;
        if (href) setOver(true);
      }}
      onDragOver={(e) => {
        if (!holdsFiles(e)) return;
        // Cancelled either way, so the browser never opens the file in the
        // tab; with no door to open, the cursor says so.
        e.preventDefault();
        e.dataTransfer.dropEffect = href ? "copy" : "none";
      }}
      onDragLeave={(e) => {
        if (!holdsFiles(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(e) => {
        if (!holdsFiles(e)) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        go();
      }}
      onClick={(e) => {
        if ((e.target as Element).closest("a")) return;
        go();
      }}
    >
      {children}
    </div>
  );
}
