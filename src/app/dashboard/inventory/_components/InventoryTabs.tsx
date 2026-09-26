"use client";

export type InventoryTabId = "products" | "locations";

interface Props {
  tabs: { id: InventoryTabId; label: string }[];
  active: InventoryTabId;
  onChange: (id: InventoryTabId) => void;
}

export function InventoryTabs({ tabs, active, onChange }: Props) {
  return (
    <div role="tablist" aria-label="Inventory sections" className="mb-4 flex gap-1 border-b border-(--color-border)">
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`inventory-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`inventory-panel-${tab.id}`}
            onClick={() => onChange(tab.id)}
            className={
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors " +
              (selected
                ? "border-(--color-primary) text-(--color-text-strong)"
                : "border-transparent text-(--color-text-muted) hover:text-(--color-text-base)")
            }
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
