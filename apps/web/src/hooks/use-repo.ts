"use client";

import { useContext, useMemo } from "react";
import { getRepository, type Repository } from "@/lib/repo";
import { StoreContext } from "@/lib/store/provider";

export function useRepo(): Repository {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useRepo must be used within StoreProvider");
  return useMemo(() => getRepository(store), [store]);
}
