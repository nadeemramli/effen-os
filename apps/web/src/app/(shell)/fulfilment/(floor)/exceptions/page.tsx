"use client";

import { PageBody } from "@/components/shell/page-header";
import { FloorFrame } from "../_components/floor-frame";
import { FloorPageHeader } from "../_components/floor-header";
import { ExceptionsList } from "../_components/exceptions-list";

export default function FulfilmentExceptionsPage() {
  return (
    <PageBody className="max-w-none">
      <FloorPageHeader
        title="Exceptions"
        description="Everything that stops an order moving: payment holds, pipeline holds awaiting release, and courier-reported parcel exceptions."
      />
      <FloorFrame>
        <ExceptionsList />
      </FloorFrame>
    </PageBody>
  );
}
