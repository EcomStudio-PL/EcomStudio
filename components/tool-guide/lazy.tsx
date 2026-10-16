"use client";
import dynamic from "next/dynamic";

/**
 * The tutorial and the starter gallery as separate chunks: a tool screen
 * paints without them, and they arrive with the guide answer — the only
 * moment either can be shown. The admin preview imports the real modules.
 */
export const TutorialModal = dynamic(() => import("./tutorial-modal").then((m) => m.TutorialModal), { ssr: false });
export const StarterGallery = dynamic(() => import("./starter-gallery").then((m) => m.StarterGallery), { ssr: false });

/** Fetch both chunks ahead of time, alongside the guide request. */
export function preloadGuideChunks() {
  void import("./tutorial-modal");
  void import("./starter-gallery");
}
