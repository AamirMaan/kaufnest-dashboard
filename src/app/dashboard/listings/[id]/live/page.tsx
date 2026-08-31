"use client";

import { use } from "react";
import { EditLiveListing } from "../../_components/EditLiveListing";
import { BusinessEbayGate } from "../../_components/BusinessEbayGate";

export default function LiveListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <BusinessEbayGate>
      <EditLiveListing draftId={id} />
    </BusinessEbayGate>
  );
}
