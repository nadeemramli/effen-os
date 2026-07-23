"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Inbox, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PERMISSION_EXPLAINERS, ROLE_LABELS, type PermissionKey } from "@/lib/rbac/matrix";
import { useSession } from "@/hooks/use-session";
import { cn } from "@/lib/utils";

/* ---------- empty ---------- */

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: { label: string; href?: string; onClick?: () => void };
  className?: string;
}

export function EmptyState({ icon: Icon = Inbox, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-12 text-center", className)}>
      <Icon className="mb-3 size-8 text-muted-foreground/60" aria-hidden />
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      {action &&
        (action.href ? (
          <Button asChild size="sm" className="mt-4">
            <Link href={action.href}>{action.label}</Link>
          </Button>
        ) : (
          <Button size="sm" className="mt-4" onClick={action.onClick}>
            {action.label}
          </Button>
        ))}
    </div>
  );
}

/* ---------- error ---------- */

export function ErrorState({ title, description, retry }: { title: string; description: string; retry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-destructive/25 bg-destructive/5 px-6 py-12 text-center">
      <AlertTriangle className="mb-3 size-8 text-destructive" aria-hidden />
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      {retry && (
        <Button size="sm" variant="outline" className="mt-4" onClick={retry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/* ---------- permission denied ---------- */

export function PermissionDenied({ permission }: { permission: PermissionKey }) {
  const { role } = useSession();
  return (
    <div className="flex h-full min-h-96 flex-col items-center justify-center px-6 py-16 text-center">
      <Lock className="mb-3 size-8 text-muted-foreground/60" aria-hidden />
      <h2 className="text-base font-medium">Not available to {ROLE_LABELS[role]}</h2>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
        {PERMISSION_EXPLAINERS[permission] ??
          "Your current demo role does not include this area."}{" "}
        Use the role switcher in the top-right menu to view as another role.
      </p>
    </div>
  );
}

/* ---------- skeletons ---------- */

export function SkeletonTable({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="Loading">
      <div className="flex gap-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-8 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" role="status" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-24 rounded-lg" />
      ))}
    </div>
  );
}
