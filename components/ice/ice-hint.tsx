"use client";
import { useEffect } from "react";
import { iceRememberAdminAction } from "@/app/actions/ice";

/**
 * Marks this browser as an admin's, once, so the public and app pages know to
 * look for the visual editor's launcher. Rendered by the admin layout only
 * while the mark is missing; renders nothing.
 */
export function IceHint() {
  useEffect(() => {
    void iceRememberAdminAction();
  }, []);
  return null;
}
