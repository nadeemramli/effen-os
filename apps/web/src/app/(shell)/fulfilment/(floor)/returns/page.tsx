"use client";

import { PageBody } from "@/components/shell/page-header";
import { FloorFrame } from "../_components/floor-frame";
import { FloorPageHeader } from "../_components/floor-header";
import { ReturnsCard } from "../_components/returns-card";

export default function FulfilmentReturnsPage() {
  return (
    <PageBody className="max-w-none">
      <FloorPageHeader
        title="Returns"
        description="Parcels returned to sender by Ninja Van — why they came back and which orders they belong to."
      />
      <FloorFrame>
        <ReturnsCard />
      </FloorFrame>
    </PageBody>
  );
}
