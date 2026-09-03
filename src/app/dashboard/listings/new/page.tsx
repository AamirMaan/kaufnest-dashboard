// src/app/dashboard/listings/new/page.tsx
"use client";

import { ListingForm } from "../_components/ListingForm";
import { BusinessEbayGate } from "../_components/BusinessEbayGate";

export default function NewListingPage() {
  return (
    <BusinessEbayGate>
      <ListingForm draftId={null} />
    </BusinessEbayGate>
  );
}
