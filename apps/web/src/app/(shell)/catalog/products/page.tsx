"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Legacy route — the catalog is one page now. Keeps old deep links (?sku=, ?q=) working. */
export default function LegacyProductsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace(`/catalog${window.location.search}`);
  }, [router]);
  return null;
}
