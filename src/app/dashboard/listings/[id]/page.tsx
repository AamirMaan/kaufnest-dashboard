// src/app/dashboard/listings/[id]/page.tsx
"use client";

import { use } from "react";
import { ListingForm } from "../_components/ListingForm";
import { BusinessEbayGate } from "../_components/BusinessEbayGate";

export default function EditListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <BusinessEbayGate>
      <ListingForm draftId={id} />
    </BusinessEbayGate>
  );
}
