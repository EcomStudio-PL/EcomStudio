"use client";
import dynamic from "next/dynamic";

/**
 * The tutorial and the starter gallery as separate chunks: a tool screen
 * paints without them, and they arrive with the guide answer — the only
 * moment either can be shown. A chunk that fails to load (a stale tab after
 * a deploy, a dropped connection) renders nothing instead of taking the tool
 * screen down with it. The admin preview imports the real modules.
 */
const nothing = () => null;

export const TutorialModal = dynamic(
  () => import("./tutorial-modal").then((m) => m.TutorialModal).catch(() => nothing),
  { ssr: false },
);
export const StarterGallery = dynamic(
  () => import("./starter-gallery").then((m) => m.StarterGallery).catch(() => nothing),
  { ssr: false },
);

/** Fetch both chunks ahead of time, alongside the guide request. */
export function preloadGuideChunks() {
  void import("./tutorial-modal").catch(() => undefined);
  void import("./starter-gallery").catch(() => undefined);
}
