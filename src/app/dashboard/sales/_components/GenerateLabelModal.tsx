"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Row } from "@/components/ui/FormFields";
import { formatCurrency } from "@/lib/utils/currency";
import type { Sale, Shipment, Currency } from "@/types";
import type { EasyPostRate } from "@/lib/shipping/easypost";

interface Props {
  sale: Sale | null; // non-null = modal open
  onClose: () => void;
  onSuccess: (shipment: Shipment) => void;
}

type Step = "form" | "rates";

export function GenerateLabelModal({ sale, onClose, onSuccess }: Props) {
  const [step, setStep] = useState<Step>("form");
  const [weightOz, setWeightOz] = useState("");
  const [lengthIn, setLengthIn] = useState("");
  const [widthIn, setWidthIn] = useState("");
  const [heightIn, setHeightIn] = useState("");
  const [easypostShipmentId, setEasypostShipmentId] = useState<string | null>(null);
  const [rates, setRates] = useState<EasyPostRate[]>([]);
  const [selectedRateId, setSelectedRateId] = useState<string | null>(null);
  const [loadingRates, setLoadingRates] = useState(false);
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const weight = parseFloat(weightOz);
  const isWeightValid = !isNaN(weight) && weight > 0;

  function reset() {
    setStep("form");
    setWeightOz("");
    setLengthIn("");
    setWidthIn("");
    setHeightIn("");
    setEasypostShipmentId(null);
    setRates([]);
    setSelectedRateId(null);
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleGetRates(e: React.FormEvent) {
    e.preventDefault();
    if (!sale || !isWeightValid) return;
    setError(null);
    setLoadingRates(true);

    try {
      const res = await fetch("/api/shipping/rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          saleId: sale.id,
          weightOz: weight,
          lengthIn: lengthIn ? parseFloat(lengthIn) : undefined,
          widthIn: widthIn ? parseFloat(widthIn) : undefined,
          heightIn: heightIn ? parseFloat(heightIn) : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Failed to fetch shipping rates.");
        return;
      }
      setEasypostShipmentId(json.easypostShipmentId);
      setRates(json.rates);
      setStep("rates");
    } catch {
      setError("Failed to fetch shipping rates. Check your connection and try again.");
    } finally {
      setLoadingRates(false);
    }
  }

  async function handleBuy() {
    if (!sale || !easypostShipmentId || !selectedRateId) return;
    const rate = rates.find((r) => r.id === selectedRateId);
    if (!rate) return;

    setError(null);
    setBuying(true);

    try {
      const res = await fetch("/api/shipping/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          saleId: sale.id,
          easypostShipmentId,
          rateId: rate.id,
          weightOz: weight,
          carrier: rate.carrier,
          service: rate.service,
          cost: rate.rate ? parseFloat(rate.rate) : null,
          costCurrency: rate.currency ?? null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Failed to purchase the shipping label.");
        return;
      }
      onSuccess(json as Shipment);
      reset();
    } catch {
      setError("Failed to purchase the shipping label. Check your connection and try again.");
    } finally {
      setBuying(false);
    }
  }

  return (
    <Modal
      title="Generate Shipping Label"
      open={!!sale}
      onClose={handleClose}
      footer={
        step === "form" ? (
          <>
            <Button variant="secondary" type="button" onClick={handleClose} disabled={loadingRates}>
              Cancel
            </Button>
            <Button type="submit" form="generate-label-form" disabled={loadingRates || !isWeightValid}>
              {loadingRates ? "Fetching rates…" : "Get Rates"}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" type="button" onClick={handleClose} disabled={buying}>
              Cancel
            </Button>
            <Button type="button" onClick={handleBuy} disabled={buying || !selectedRateId}>
              {buying ? "Buying…" : "Buy Label"}
            </Button>
          </>
        )
      }
    >
      {error && (
        <div className="mb-4 rounded-[var(--radius-btn)] bg-[var(--color-danger-bg)] border border-red-200 px-4 py-3 text-sm text-[var(--color-danger-text)]">
          {error}
        </div>
      )}

      {step === "form" && (
        <form id="generate-label-form" onSubmit={handleGetRates} className="space-y-4">
          <Field label="Weight (oz)" required>
            <Input
              type="number"
              min="0.1"
              step="0.1"
              value={weightOz}
              onChange={(e) => setWeightOz(e.target.value)}
              required
            />
          </Field>
          <Row>
            <Field label="Length (in)">
              <Input
                type="number"
                min="0"
                step="0.1"
                value={lengthIn}
                onChange={(e) => setLengthIn(e.target.value)}
              />
            </Field>
            <Field label="Width (in)">
              <Input
                type="number"
                min="0"
                step="0.1"
                value={widthIn}
                onChange={(e) => setWidthIn(e.target.value)}
              />
            </Field>
          </Row>
          <Field label="Height (in)">
            <Input
              type="number"
              min="0"
              step="0.1"
              value={heightIn}
              onChange={(e) => setHeightIn(e.target.value)}
            />
          </Field>
        </form>
      )}

      {step === "rates" && (
        <div className="space-y-2">
          {rates.length === 0 && (
            <p className="text-sm text-[var(--color-text-muted)]">
              No rates were returned for this package.
            </p>
          )}
          {rates.map((rate) => (
            <label
              key={rate.id}
              className="flex items-center justify-between gap-3 rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm cursor-pointer has-[:checked]:border-[var(--color-primary)]"
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="rate"
                  value={rate.id}
                  checked={selectedRateId === rate.id}
                  onChange={() => setSelectedRateId(rate.id)}
                />
                {rate.carrier} — {rate.service}
                {rate.deliveryDays != null ? ` (${rate.deliveryDays}d)` : ""}
              </span>
              <span className="font-semibold">
                {formatCurrency(parseFloat(rate.rate), rate.currency as Currency)}
              </span>
            </label>
          ))}
        </div>
      )}
    </Modal>
  );
}
