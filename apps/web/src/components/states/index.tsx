"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Inbox, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MetricCardSkeleton } from "@/components/metrics/metric-card";
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

const CELL_WIDTHS = ["w-3/4", "w-1/2", "w-full"];

/** Matches DataTable geometry: h-9 header row, dense body rows, framed border. */
export function SkeletonTable({
  rows = 8,
  cols = 6,
  framed = true,
  className,
}: {
  rows?: number;
  cols?: number;
  framed?: boolean;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn(framed && "overflow-hidden rounded-lg border", className)}
    >
      <div className="flex h-9 items-center gap-3 border-b px-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3.5 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className={cn("flex h-[33px] items-center gap-3 px-3", r > 0 && "border-t")}>
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className="flex-1">
              <Skeleton className={cn("h-4", CELL_WIDTHS[(r + c) % CELL_WIDTHS.length])} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonCards({
  count = 4,
  className,
  hint = true,
}: {
  count?: number;
  className?: string;
  hint?: boolean;
}) {
  return (
    <div
      className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)}
      role="status"
      aria-label="Loading"
    >
      {Array.from({ length: count }).map((_, i) => (
        <MetricCardSkeleton key={i} hint={hint} />
      ))}
    </div>
  );
}

/* ---------- inline loading ---------- */

/**
 * A number interpolated into a sentence or button label. Pass null while the
 * value is still loading and a small inline bar renders instead — never "0".
 */
export function InlineCount({
  value,
  width = "w-10",
}: {
  value: number | string | null;
  width?: string;
}) {
  if (value !== null) return <>{typeof value === "number" ? value.toLocaleString() : value}</>;
  return (
    <Skeleton
      className={cn("inline-block h-3.5 translate-y-[2px] rounded", width)}
      aria-label="loading"
    />
  );
}

/** Refetch-in-progress affordance shown next to data that stays visible. */
export function RefreshChip({ label = "Updating…", className }: { label?: string; className?: string }) {
  return (
    <span
      role="status"
      className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)}
    >
      <Loader2 className="size-3 animate-spin" aria-hidden />
      {label}
    </span>
  );
}
