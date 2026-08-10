"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface ChartCardProps {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** All Recharts usage lives inside components/charts — client-only, fixed heights. */
export function ChartCard({ title, subtitle, right, children, className }: ChartCardProps) {
  return (
    <Card className={cn("gap-3", className)}>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {right}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** Same shell as ChartCard; charts are fixed-height so the swap is zero-CLS. */
export function ChartCardSkeleton({ height = 256, className }: { height?: number; className?: string }) {
  return (
    <Card className={cn("gap-3", className)} role="status" aria-label="Loading chart">
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div className="space-y-1.5">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
      </CardHeader>
      <CardContent>
        <Skeleton style={{ height }} className="w-full rounded-md" />
      </CardContent>
    </Card>
  );
}
