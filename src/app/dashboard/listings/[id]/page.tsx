// src/app/dashboard/listings/[id]/page.tsx
"use client";

import { use } from "react";
import { ListingWizard } from "../_components/ListingWizard";

export default function EditListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ListingWizard draftId={id} />;
}
