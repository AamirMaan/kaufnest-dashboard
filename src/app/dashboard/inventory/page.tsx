"use client";

import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { useAppSelector } from "@/store/hooks";
import { useAccess } from "@/store/useAccess";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { useAdvancedInventory } from "./_store/useAdvancedInventory";
import { ProductsTab } from "./_components/ProductsTab";
import { AdvancedInventoryUpsellCard } from "./_components/AdvancedInventoryUpsellCard";
import { EnableAdvancedCard } from "./_components/EnableAdvancedCard";
import { InventoryTabs, type InventoryTabId } from "./_components/InventoryTabs";
import { LocationsTab } from "./_components/LocationsTab";
import { TransfersTab } from "./_components/TransfersTab";

export default function InventoryPage() {
  const advanced = useAdvancedInventory();
  const { can } = useAccess();
  // Enabling advanced inventory itself stays role-gated (not a grid action).
  const role = useAppSelector((s) => s.currentUser.profile?.role);
  const isAdmin = role === "admin" || role === "super_admin";
  // Stock locations + platform defaults need inventory >= 3 (RLS: 055);
  // transfers and products only need inventory >= 2.
  const canManageLocations = can("inventory", 3);
  const canManageTransfers = can("inventory", 2);
  const canManageProducts = can("inventory", 2);
  const [addProductOpen, setAddProductOpen] = useState(false);
  const [tab, setTab] = useState<InventoryTabId>("products");
  const [addLocationOpen, setAddLocationOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [stockVersion, setStockVersion] = useState(0);

  const view = advanced.view;
  const showLocations = view === "active" && tab === "locations";
  const showTransfers = view === "active" && tab === "transfers";
  const bumpStock = () => setStockVersion((n) => n + 1);

  return (
    <div>
      <PageHeader
        title="Inventory"
        description="Products tracked through linked purchases and sales"
        action={
          showLocations ? (
            canManageLocations ? <Button onClick={() => setAddLocationOpen(true)}>+ Add Location</Button> : undefined
          ) : showTransfers ? (
            canManageTransfers ? <Button onClick={() => setTransferOpen(true)}>+ Transfer Stock</Button> : undefined
          ) : (
            canManageProducts ? <Button onClick={() => setAddProductOpen(true)}>+ Add Product</Button> : undefined
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
          <Button variant="secondary" onClick={advanced.reload}>
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
            { id: "transfers", label: "Transfers" },
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
        <ProductsTab addOpen={addProductOpen} onAddClose={() => setAddProductOpen(false)} stockVersion={stockVersion} />
      </div>

      {view === "active" && (
        <LocationsTab
          isAdmin={canManageLocations}
          addOpen={addLocationOpen}
          onAddClose={() => setAddLocationOpen(false)}
          hidden={tab !== "locations"}
          stockVersion={stockVersion}
        />
      )}

      {view === "active" && (
        <TransfersTab
          isAdmin={canManageTransfers}
          addOpen={transferOpen}
          onAddClose={() => setTransferOpen(false)}
          hidden={tab !== "transfers"}
          onStockChanged={bumpStock}
        />
      )}
    </div>
  );
}
