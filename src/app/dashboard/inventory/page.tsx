"use client";

import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { useAppSelector } from "@/store/hooks";
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
  const role = useAppSelector((s) => s.currentUser.profile?.role);
  const isAdmin = role === "admin" || role === "super_admin";
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
            isAdmin ? <Button onClick={() => setAddLocationOpen(true)}>+ Add Location</Button> : undefined
          ) : showTransfers ? (
            isAdmin ? <Button onClick={() => setTransferOpen(true)}>+ Transfer Stock</Button> : undefined
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
          isAdmin={isAdmin}
          addOpen={addLocationOpen}
          onAddClose={() => setAddLocationOpen(false)}
          hidden={tab !== "locations"}
          stockVersion={stockVersion}
        />
      )}

      {view === "active" && (
        <TransfersTab
          isAdmin={isAdmin}
          addOpen={transferOpen}
          onAddClose={() => setTransferOpen(false)}
          hidden={tab !== "transfers"}
          onStockChanged={bumpStock}
        />
      )}
    </div>
  );
}
