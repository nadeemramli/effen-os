"use client";

import { PageBody } from "@/components/shell/page-header";
import { FloorFrame, QueueCardSkeleton } from "../_components/floor-frame";
import { FloorPageHeader } from "../_components/floor-header";
import { ReadinessLanes } from "../_components/readiness-lanes";

export default function ShipReadinessPage() {
  return (
    <PageBody className="max-w-none">
      <FloorPageHeader
        title="Ship-readiness"
        description="Address validation on pre-ship orders (14d). Blocked orders never reach a courier; bounce risks ship with a warning. AI fixes are suggest-only."
      />
      <FloorFrame
        skeleton={
          <>
            <QueueCardSkeleton rows={3} />
            <QueueCardSkeleton rows={3} />
          </>
        }
      >
        <ReadinessLanes />
      </FloorFrame>
    </PageBody>
  );
}
