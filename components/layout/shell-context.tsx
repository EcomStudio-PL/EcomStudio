"use client";
import { createContext, useContext, useState } from "react";

/** Shared open/close state for the mobile drawer, so the topbar hamburger,
 *  the avatar and the bottom-bar "More" button all drive ONE drawer. */
const DrawerContext = createContext<{ open: boolean; setOpen: (v: boolean) => void }>({
  open: false,
  setOpen: () => {},
});

export function DrawerProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return <DrawerContext.Provider value={{ open, setOpen }}>{children}</DrawerContext.Provider>;
}

export const useDrawer = () => useContext(DrawerContext);
