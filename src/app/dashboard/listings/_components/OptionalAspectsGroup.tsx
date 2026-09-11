"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Field, Input, Select } from "@/components/ui/FormFields";
import { countFilled, optionalAspectControl, type OptionalAspect } from "../_lib/aspectFields";

interface Props {
  aspects: OptionalAspect[];
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
}

/** eBay's "Other (optional)" item specifics — collapsed by default so the
 *  required fields stay the focus. Nothing here is `required`. */
export function OptionalAspectsGroup({ aspects, values, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const filled = countFilled(values, aspects.map((a) => a.name));

  return (
    <div className="rounded-(--radius-card) border border-(--color-border)">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-(--color-text-strong)">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          Other item specifics (optional)
        </span>
        <span className="text-xs text-(--color-text-muted)">
          {filled} of {aspects.length} filled
        </span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-(--color-border) p-4">
          <p className="text-sm text-(--color-text-muted)">
            Buyers also filter by these details.
          </p>
          {aspects.map((aspect, index) => {
            const value = values[aspect.name] ?? "";
            const label = aspect.recommended ? `${aspect.name} (recommended)` : aspect.name;
            const control = optionalAspectControl(aspect);

            if (control === "select") {
              return (
                <Field key={aspect.name} label={label}>
                  <Select value={value} onChange={(e) => onChange(aspect.name, e.target.value)}>
                    <option value="">—</option>
                    {aspect.values.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </Select>
                </Field>
              );
            }

            const listId = control === "combobox" ? `optional-aspect-values-${index}` : undefined;
            return (
              <Field key={aspect.name} label={label}>
                <Input
                  list={listId}
                  value={value}
                  onChange={(e) => onChange(aspect.name, e.target.value)}
                />
                {listId && (
                  <datalist id={listId}>
                    {aspect.values.map((v) => (
                      <option key={v} value={v} />
                    ))}
                  </datalist>
                )}
              </Field>
            );
          })}
        </div>
      )}
    </div>
  );
}
