"use client";

import { createContext, useContext, useState } from "react";
import { useStore } from "zustand";
import { createAppStore, type AppState, type AppStore } from "./index";

export const StoreContext = createContext<AppStore | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  // Lazy useState initializer: the store is created exactly once per tree,
  // surviving StrictMode double-render without double-seeding.
  const [store] = useState(() => createAppStore());
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useAppStore<T>(selector: (state: AppState) => T): T {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useAppStore must be used within StoreProvider");
  return useStore(store, selector);
}
