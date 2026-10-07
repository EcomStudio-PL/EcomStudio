"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * A PHOTO CHOSEN ON /home, HANDED TO THE TOOL THAT WILL USE IT.
 *
 * /home has no generation path of its own. Its "Generuj" puts the chosen File
 * here and navigates (client-side) to the task's EXISTING route; that screen
 * takes the File once and passes it to its OWN upload — the same validation,
 * storage folder, price and button as a photo picked on that screen. Nothing
 * else is carried: no prompt, no notes, no settings.
 *
 * In memory only, on purpose: a File cannot be put in sessionStorage, and
 * persisting product photos in IndexedDB would keep them on the device for no
 * gain. A hard reload simply loses it and the tool opens with its usual empty
 * uploader. Single-use and short-lived, and bound to ONE route: a stash meant
 * for /k/ecommerce/thumbnail is never picked up by any other screen.
 */

type Stash = { file: File; href: string; at: number };

const TTL_MS = 60_000;
let stash: Stash | null = null;

export function stashHomeUpload(file: File, href: string): void {
  stash = { file, href, at: Date.now() };
}

/** Take the photo meant for `pathname`, once. */
export function takeHomeUpload(pathname: string): File | null {
  const s = stash;
  if (!s) return null;
  if (Date.now() - s.at > TTL_MS) { stash = null; return null; }
  if (s.href !== pathname) return null;
  stash = null;
  return s.file;
}

/**
 * The receiving side, for a screen that has an upload of its own: on mount,
 * a photo handed over for THIS route goes to `accept` — the screen's own
 * upload function. Runs once per mount; does nothing when nothing was handed.
 */
export function useHomeHandoff(accept: (file: File) => void): void {
  const pathname = usePathname();
  const acceptRef = useRef(accept);
  useEffect(() => { acceptRef.current = accept; });
  useEffect(() => {
    const file = takeHomeUpload(pathname);
    if (file) acceptRef.current(file);
  }, [pathname]);
}
