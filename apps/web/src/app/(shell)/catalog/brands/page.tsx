"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Legacy route — brands live inside the consolidated catalog page now. */
export default function LegacyBrandsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace(`/catalog${window.location.search}`);
  }, [router]);
  return null;
}
