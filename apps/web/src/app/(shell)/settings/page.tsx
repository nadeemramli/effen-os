"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { visibleSettingsRoutes } from "@/lib/nav/routes";
import { useSession } from "@/hooks/use-session";
import { PermissionDenied } from "@/components/states";

/**
 * /settings has no content of its own — it forwards to the first surface the
 * role can actually reach. Which one that is depends on the role: an HQ admin
 * lands on General, Operations lands on Automations.
 */
export default function SettingsIndexPage() {
  const router = useRouter();
  const { role } = useSession();
  const first = visibleSettingsRoutes(role)[0];

  useEffect(() => {
    if (first) router.replace(first.path);
  }, [first, router]);

  if (!first) return <PermissionDenied permission="settings.manage" />;
  return null;
}
