"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { hasAdvancedInventory } from "@/lib/utils/planGating";
import { advancedInventoryView } from "./_lib/advancedInventory";
import { fetchAdvancedInventory } from "./_store/advancedInventorySlice";
import { ProductsTab } from "./_components/ProductsTab";
import { AdvancedInventoryUpsellCard } from "./_components/AdvancedInventoryUpsellCard";
import { EnableAdvancedCard } from "./_components/EnableAdvancedCard";
import { InventoryTabs, type InventoryTabId } from "./_components/InventoryTabs";
import { LocationsTab } from "./_components/LocationsTab";

export default function InventoryPage() {
  const dispatch = useAppDispatch();
  const plan = useAppSelector((s) => s.currentUser.tenantPlan);
  const advanced = useAppSelector((s) => s.advancedInventory);
  const role = useAppSelector((s) => s.currentUser.profile?.role);
  const isAdmin = role === "admin" || role === "super_admin";
  const [addProductOpen, setAddProductOpen] = useState(false);
  const [tab, setTab] = useState<InventoryTabId>("products");
  const [addLocationOpen, setAddLocationOpen] = useState(false);

  const entitled = !!plan && hasAdvancedInventory(plan);
  const view = advancedInventoryView(plan, advanced);
  const showLocations = view === "active" && tab === "locations";

  useEffect(() => {
    if (entitled && !advanced.loaded && !advanced.loading && !advanced.error) {
      dispatch(fetchAdvancedInventory());
    }
  }, [entitled, advanced.loaded, advanced.loading, advanced.error, dispatch]);

  return (
    <div>
      <PageHeader
        title="Inventory"
        description="Products tracked through linked purchases and sales"
        action={
          showLocations ? (
            isAdmin ? <Button onClick={() => setAddLocationOpen(true)}>+ Add Location</Button> : undefined
          ) : (
            <Button onClick={() => setAddProductOpen(true)}>+ Add Product</Button>
          )
        }
      />

      {view === "upsell" && <AdvancedInventoryUpsellCard />}

      {view === "loading" && (
        <p className="mb-4 flex items-center gap-2 text-sm text-(--color-text-muted)">
          <Loader2 size={16} className="animate-spin" aria-hidden /> Loading batches &amp; locations…
        </p>
      )}

      {view === "error" && (
        <div className="mb-6 flex items-center justify-between gap-3 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-4">
          <p className="text-sm text-(--color-text-muted)">{advanced.error}</p>
          <Button variant="secondary" onClick={() => dispatch(fetchAdvancedInventory())}>
            <RefreshCw size={15} aria-hidden /> Retry
          </Button>
        </div>
      )}

      {view === "enable" && <EnableAdvancedCard isAdmin={isAdmin} />}

      {view === "active" && (
        <InventoryTabs
          tabs={[
            { id: "products", label: "Products" },
            { id: "locations", label: "Locations" },
          ]}
          active={tab}
          onChange={setTab}
        />
      )}

      <div
        id="inventory-panel-products"
        role={view === "active" ? "tabpanel" : undefined}
        aria-labelledby={view === "active" ? "inventory-tab-products" : undefined}
        hidden={view === "active" && tab !== "products"}
      >
        <ProductsTab addOpen={addProductOpen} onAddClose={() => setAddProductOpen(false)} />
      </div>

      {view === "active" && (
        <LocationsTab
          isAdmin={isAdmin}
          addOpen={addLocationOpen}
          onAddClose={() => setAddLocationOpen(false)}
          hidden={tab !== "locations"}
        />
      )}
    </div>
  );
}
