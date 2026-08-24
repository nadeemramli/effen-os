"use client";

import { useCallback, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "@/hooks/use-session";
import { sectionForPath, type NavSection } from "@/lib/nav/routes";

/**
 * Primary-sidebar width state.
 *
 * Auto mode: the rail collapses whenever the current route belongs to a
 * section with children (Orders, Customers, Fulfilment, Settings) so the
 * secondary sidebar has room, and re-expands on leaf routes. A pin overrides
 * auto in either direction and persists per browser.
 *
 * This is the first persisted UI preference in the app. It is a
 * useSyncExternalStore-backed module store rather than a Zustand slice so the
 * server snapshot is always `null` (auto) — no hydration mismatch, no
 * setState-in-effect — and every storage access is guarded: private mode or
 * a blocked storage API just means the pin never sticks.
 */
export type SidebarPin = "expanded" | "collapsed" | null;

const KEY = "fk.sidebar.pin";
const listeners = new Set<() => void>();

function read(): SidebarPin {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "expanded" || v === "collapsed" ? v : null;
  } catch {
    return null;
  }
}

function write(v: SidebarPin) {
  try {
    if (v) window.localStorage.setItem(KEY, v);
    else window.localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable — the in-memory notify below still updates this tab.
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  window.addEventListener("storage", l);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", l);
  };
}

const serverSnapshot = (): SidebarPin => null;

export function useSidebarState(): {
  section: NavSection | null;
  collapsed: boolean;
  pinned: SidebarPin;
  setPin: (v: SidebarPin) => void;
  togglePin: () => void;
} {
  const pathname = usePathname();
  const { role } = useSession();
  const pinned = useSyncExternalStore(subscribe, read, serverSnapshot);
  const section = sectionForPath(pathname, role);
  const collapsed = pinned === null ? section !== null : pinned === "collapsed";
  const setPin = useCallback((v: SidebarPin) => write(v), []);
  // Toggle relative to what the user sees, then persist that explicit choice.
  const togglePin = useCallback(() => write(collapsed ? "expanded" : "collapsed"), [collapsed]);
  return { section, collapsed, pinned, setPin, togglePin };
}

/** True once the component has mounted on the client — false during SSR/hydration. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}
