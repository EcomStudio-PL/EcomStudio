"use client";
import { lazy, Suspense, useEffect, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/provider";
import { notify } from "@/lib/notify";
import { stegaStrip } from "@/lib/ice/stega";
import { iceSetEditAction } from "@/app/actions/ice";
import { useFramed } from "./framed";

/**
 * THE "EDYTUJ STRONĘ" BUTTON — the only part of the visual editor a page loads
 * up front, and only for a verified admin (components/ice/ice-gate.tsx).
 *
 * Deliberately small: inline styles (no class reaches the global stylesheet),
 * one server action, and the editor itself as a separate chunk that is fetched
 * the first time edit mode starts.
 */

const Editor = lazy(() => import("./editor/editor"));

type Session = { nonce: string; path: string };

const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

/** The phone dock, when the page has one and it is showing. */
function dockShowing(): boolean {
  const dock = document.querySelector(".dock");
  return Boolean(dock && dock.getBoundingClientRect().height > 0);
}

export function IceLauncher({ sessions, supported }: { sessions: Session[]; supported: string[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const path = norm(usePathname() ?? "/");
  const session = sessions.find((s) => s.path === path) ?? null;
  const [pending, start] = useTransition();
  const [lift, setLift] = useState(false);
  // In a preview frame (the builder's, the gallery panel's): no button and no
  // editor — the frame shows the page as a visitor sees it.
  const framed = useFramed();

  // Text copied off a page in edit mode never carries the invisible markers.
  useEffect(() => {
    if (sessions.length === 0) return;
    const strip = (e: ClipboardEvent) => {
      const selected = document.getSelection()?.toString() ?? "";
      const clean = stegaStrip(selected);
      if (clean !== selected && e.clipboardData) {
        e.clipboardData.setData("text/plain", clean);
        e.preventDefault();
      }
    };
    document.addEventListener("copy", strip);
    document.addEventListener("cut", strip);
    return () => {
      document.removeEventListener("copy", strip);
      document.removeEventListener("cut", strip);
    };
  }, [sessions.length]);

  useEffect(() => {
    const update = () => setLift(dockShowing());
    update();
    window.addEventListener("resize", update);
    const id = window.setTimeout(update, 400);
    return () => {
      window.removeEventListener("resize", update);
      window.clearTimeout(id);
    };
  }, [path]);

  if (framed) return null;
  if (session) {
    return (
      <Suspense fallback={null}>
        <Editor key={path} session={session} path={path} />
      </Suspense>
    );
  }
  if (!supported.includes(path)) return null;

  const begin = () =>
    start(async () => {
      const res = await iceSetEditAction(true, path);
      if (!res.ok) {
        notify.error(t(res.error === "step_up_required" ? "ice.error.stepUp" : "ice.error.start"));
        return;
      }
      router.refresh();
    });

  return (
    <button
      type="button"
      onClick={begin}
      disabled={pending}
      data-ice-launch=""
      style={{
        position: "fixed",
        right: 16,
        bottom: lift ? "calc(var(--dock-h) + env(safe-area-inset-bottom) + 12px)" : "calc(16px + env(safe-area-inset-bottom))",
        zIndex: 40,
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 16px",
        borderRadius: 999,
        border: "1px solid rgb(255 255 255 / 0.18)",
        background: "rgb(var(--accent))",
        color: "#fff",
        font: "600 14px/1.2 inherit",
        boxShadow: "0 8px 24px rgb(0 0 0 / 0.25)",
        cursor: pending ? "progress" : "pointer",
        opacity: pending ? 0.75 : 1,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
      {pending ? t("ice.launch.opening") : t("ice.launch.edit")}
    </button>
  );
}
