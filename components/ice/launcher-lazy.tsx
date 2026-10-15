"use client";
import { lazy, Suspense } from "react";

/**
 * The launcher, fetched only when the gate renders it — an admin's page. The
 * root layout's client chunk (every visitor's) carries just this file; the
 * launcher's code arrives as its own chunk on demand.
 */
const Launcher = lazy(() => import("./launcher").then((m) => ({ default: m.IceLauncher })));

export function IceLauncherLazy(props: { sessions: { nonce: string; path: string }[]; supported: string[] }) {
  return (
    <Suspense fallback={null}>
      <Launcher {...props} />
    </Suspense>
  );
}
