// src/app/dashboard/listings/new/page.tsx
"use client";

import { ListingWizard } from "../_components/ListingWizard";
import { BusinessEbayGate } from "../_components/BusinessEbayGate";

export default function NewListingPage() {
  return (
    <BusinessEbayGate>
      <ListingWizard draftId={null} />
    </BusinessEbayGate>
  );
}
