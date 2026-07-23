"use client";

import { NextModulePage } from "@/components/states/next-module-page";
import { RouteGuard } from "@/lib/rbac/guard";

export default function Page() {
  return (
    <RouteGuard permission="orders.view">
      <NextModulePage routeKey="fulfilment" />
    </RouteGuard>
  );
}
