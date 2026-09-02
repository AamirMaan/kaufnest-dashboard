// src/app/dashboard/listings/_components/CategoryStep.tsx
"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { Field, Input } from "@/components/ui/FormFields";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import type { DraftFormState } from "../_lib/wizardValidation";

interface CategorySuggestion {
  id: string;
  name: string;
}

interface Props {
  draft: DraftFormState;
  setDraft: (patch: Partial<DraftFormState>) => void;
}

export function CategoryStep({ draft, setDraft }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CategorySuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch() {
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(`/api/listings/ebay/categories?q=${encodeURIComponent(query.trim())}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Category search failed");
      setResults(json.categories);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Category search failed");
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Required-marked because a category IS required, but the control is a
        * search box, not the stored value — it is intentionally left without a
        * `required` attribute (it is empty again once a suggestion is picked).
        * `validateCategoryStep` gates Publish on `category_id` instead. */}
      <Field label="Search eBay categories" required>
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              // This input now lives inside ListingForm's `<form>`; without
              // preventDefault, Enter would trigger implicit submission
              // (i.e. Publish) instead of a category search.
              e.preventDefault();
              handleSearch();
            }}
            placeholder="e.g. wireless mouse"
          />
          <Button type="button" variant="secondary" onClick={handleSearch} disabled={searching}>
            <Search size={14} />
            {searching ? "Searching…" : "Search"}
          </Button>
        </div>
      </Field>

      {error && <p className="text-sm text-(--color-danger-text)">{error}</p>}

      {draft.category_id && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-(--color-text-muted)">Selected:</span>
          <Badge label={draft.category_name || draft.category_id} variant="success" />
        </div>
      )}

      {results.length > 0 && (
        <ul className="divide-y divide-(--color-border) rounded-(--radius-card) border border-(--color-border)">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setDraft({ category_id: r.id, category_name: r.name })}
                className="w-full px-4 py-2 text-left text-sm hover:bg-(--color-surface-subtle) transition-colors"
              >
                {r.name} <span className="text-(--color-text-faint)">({r.id})</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
