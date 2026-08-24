"use client";

import { PageBody } from "@/components/shell/page-header";
import { FloorFrame, QueueCardSkeleton } from "./_components/floor-frame";
import { FloorPageHeader, ManifestButtons, ReadinessStrip } from "./_components/floor-header";
import { PipelineCard } from "./_components/pipeline-card";
import { QueuesGrid } from "./_components/queues-grid";

export default function FulfilmentOverviewPage() {
  return (
    <PageBody className="max-w-none">
      <FloorPageHeader
        title="Fulfilment"
        description="Pick → pack → handover for the KL fulfilment centre. Every move lands on the order's evidence timeline."
      >
        <ManifestButtons />
      </FloorPageHeader>
      <ReadinessStrip />
      <FloorFrame
        skeleton={
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <QueueCardSkeleton key={i} />
            ))}
          </div>
        }
      >
        <PipelineCard />
        <QueuesGrid />
      </FloorFrame>
    </PageBody>
  );
}
