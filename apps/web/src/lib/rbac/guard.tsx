"use client";

import type { PermissionKey } from "./matrix";
import { usePermission } from "@/hooks/use-session";
import { PermissionDenied } from "@/components/states";

/** Route-level guard: renders PermissionDenied in place — no redirect loops. */
export function RouteGuard({
  permission,
  children,
}: {
  permission: PermissionKey;
  children: React.ReactNode;
}) {
  const allowed = usePermission(permission);
  if (!allowed) return <PermissionDenied permission={permission} />;
  return <>{children}</>;
}
