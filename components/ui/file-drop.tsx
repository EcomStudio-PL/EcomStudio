"use client";
import { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { acceptFiles, dragCarriesFiles, type IntakeLimits, type IntakeResult } from "@/lib/images/file-intake";

/**
 * GLOBAL FILE DROP — the whole tool is the target, not the little box.
 *
 * The generator has worked this way for a while: drag a photo anywhere over
 * the workspace and the page dims, a card appears, and the drop lands. Every
 * other image tool had a 90-pixel tile that a seller had to aim at, and a drop
 * that missed it did nothing at all — or worse, the browser navigated away from
 * the app to display the image. This is that generator behaviour, lifted out of
 * `components/genv3/uploader.tsx` and made configurable, so there is one
 * implementation and each tool supplies its own limits and its own copy.
 *
 * Two details carry the whole thing:
 *
 *   `dragenter`/`dragleave` are COUNTED, not toggled. Both fire again for every
 *   child element the pointer crosses, so a toggle makes the overlay strobe as
 *   the seller moves across the panel.
 *
 *   `dragover` must call preventDefault or there is no drop at all — the
 *   default action refuses the drag, and the browser then treats the release as
 *   a navigation to the dropped file.
 */
export function useFileDrop({ onFiles, enabled = true }: {
  /** Receives the raw list; the caller validates with its own limits so a
   *  batch tool can report "za dużo plików" and a single-image tool cannot. */
  onFiles: (files: FileList | null, event: DragEvent) => void;
  enabled?: boolean;
}): boolean {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const handler = useRef(onFiles);
  handler.current = onFiles;

  useEffect(() => {
    const reset = () => { depth.current = 0; setDragging(false); };

    const onEnter = (event: DragEvent) => {
      if (!dragCarriesFiles(event)) return;
      // Some engines only allow the drop when dragenter is prevented too.
      event.preventDefault();
      depth.current += 1;
      if (enabled) setDragging(true);
    };
    const onOver = (event: DragEvent) => {
      if (!dragCarriesFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = enabled ? "copy" : "none";
    };
    const onLeave = (event: DragEvent) => {
      if (!dragCarriesFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!dragCarriesFiles(event)) return;
      // Prevented unconditionally, even when the tool is busy: the alternative
      // is the browser leaving the app to open the file the seller dropped.
      event.preventDefault();
      event.stopPropagation();
      reset();
      if (!enabled) return;
      handler.current(event.dataTransfer?.files ?? null, event);
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    // A drag that ends outside the window, or an alt-tab mid-drag, leaves the
    // counter stuck otherwise and the overlay never clears.
    window.addEventListener("dragend", reset);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragend", reset);
      window.removeEventListener("blur", reset);
    };
  }, [enabled]);

  return dragging;
}

/**
 * The card the seller sees while dragging.
 *
 * `fullscreen` covers the viewport — right for a tool whose workspace IS the
 * page. The default stays absolute so a panel that already positions it (the
 * generator, Retusz) keeps the framing it was designed with.
 *
 * The application stays visible underneath: dimmed and blurred a little, not
 * hidden. A seller mid-drag needs to see they are over the right tool.
 */
export function FileDropOverlay({ show, title, sub, fullscreen = false }: {
  show: boolean;
  title: string;
  sub: string;
  fullscreen?: boolean;
}) {
  return (
    <div
      aria-hidden={!show}
      className={cn(
        "pointer-events-none z-50 flex items-center justify-center transition-opacity duration-150",
        fullscreen ? "fixed inset-0" : "absolute inset-0 rounded-2xl",
        show ? "opacity-100" : "opacity-0",
      )}
      style={{ visibility: show ? "visible" : "hidden" }}
    >
      <div className={cn(
        "absolute inset-0 bg-[rgb(var(--sunken)/0.82)] backdrop-blur-[3px]",
        !fullscreen && "rounded-2xl",
      )} />
      <div className={cn(
        "relative flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed",
        "border-[rgb(var(--accent)/0.55)] bg-[rgb(var(--surface))] px-8 py-7 text-center",
        // One soft brand glow, not a light show.
        "shadow-[0_20px_60px_-30px_rgb(0_0_0/0.5),0_0_0_1px_rgb(var(--accent)/0.10)]",
      )}>
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[rgb(var(--accent)/0.12)] text-accent">
          <Upload size={20} aria-hidden />
        </span>
        <p className="text-[14px] font-semibold tracking-tight">{title}</p>
        <p className="text-[11.5px] text-muted">{sub}</p>
      </div>
    </div>
  );
}

/**
 * The whole arrangement in one call: window-wide drag detection, the overlay's
 * visibility, and validation against this tool's limits.
 *
 * The caller gets an `IntakeResult`, exactly what its own file picker gets, so
 * the two routes cannot drift — which is the point of the module.
 */
export function useImageDrop({ limits, room, onIntake, enabled = true }: {
  limits: IntakeLimits;
  /** Remaining capacity right now. Single-image tools pass 1. */
  room: number;
  onIntake: (result: IntakeResult) => void;
  enabled?: boolean;
}): boolean {
  const roomRef = useRef(room);
  roomRef.current = room;
  const sink = useRef(onIntake);
  sink.current = onIntake;

  return useFileDrop({
    enabled,
    onFiles: (files) => sink.current(acceptFiles(files, limits, roomRef.current)),
  });
}
