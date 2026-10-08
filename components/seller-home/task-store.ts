"use client";
import { useSyncExternalStore } from "react";
import type { UploadToolKey } from "@/lib/seller-home-config";

/**
 * Which upload pill is selected — shared by the upload tile and the
 * "Gdzie sprzedajesz?" dialog, which pre-selects the seller's channel's tool
 * the moment it is answered. A tiny module store rather than a context, so
 * the server-rendered sections around them stay server components. `null` =
 * nothing chosen yet → the page's default applies.
 */

let selected: UploadToolKey | null = null;
const listeners = new Set<() => void>();

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function setSelectedTool(key: UploadToolKey): void {
  if (selected === key) return;
  selected = key;
  listeners.forEach((fn) => fn());
}

export function useSelectedTool(): UploadToolKey | null {
  return useSyncExternalStore(subscribe, () => selected, () => null);
}

/** The upload tile's section id and its pick-a-photo control's id. */
export const HERO_ID = "seller-upload-section";
export const UPLOAD_ID = "seller-upload";
