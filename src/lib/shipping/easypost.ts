/**
 * Thin, server-only wrapper over EasyPost's REST API
 * (https://api.easypost.com/v2). Auth is HTTP Basic with EASYPOST_API_KEY
 * as the username and an empty password — EasyPost's own convention, not
 * this app's. Never import this from a Client Component (same rule as
 * everything under src/lib/integrations/).
 */

const EASYPOST_API_BASE = "https://api.easypost.com/v2";

export interface EasyPostAddress {
  name: string | null;
  street1: string;
  street2: string | null;
  city: string;
  state: string | null;
  zip: string;
  country: string;
  phone: string | null;
  email: string | null;
}

export interface EasyPostParcel {
  weightOz: number;
  lengthIn?: number;
  widthIn?: number;
  heightIn?: number;
}

export interface EasyPostRate {
  id: string;
  carrier: string;
  service: string;
  /** EasyPost returns this as a decimal string, e.g. "7.50" — not a number. */
  rate: string;
  currency: string;
  deliveryDays: number | null;
}

export interface EasyPostRatesResult {
  easypostShipmentId: string;
  rates: EasyPostRate[];
}

export interface EasyPostLabel {
  trackingNumber: string;
  labelUrl: string;
  labelFormat: string;
}

function authHeader(): string {
  const apiKey = process.env.EASYPOST_API_KEY;
  if (!apiKey) {
    throw new Error("EASYPOST_API_KEY is not configured.");
  }
  return "Basic " + Buffer.from(`${apiKey}:`).toString("base64");
}

async function easypostFetch(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${EASYPOST_API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = (await res.json()) as Record<string, unknown>;

  if (!res.ok) {
    const errorField = json.error as { message?: string } | undefined;
    const message = errorField?.message ?? `EasyPost request failed with status ${res.status}`;
    throw new Error(message);
  }

  return json;
}

function toEasyPostAddressPayload(address: EasyPostAddress) {
  return {
    name: address.name,
    street1: address.street1,
    street2: address.street2,
    city: address.city,
    state: address.state,
    zip: address.zip,
    country: address.country,
    phone: address.phone,
    email: address.email,
  };
}

/**
 * Fetches live carrier rates for a shipment. Returns the EasyPost shipment
 * id (needed by `buyLabel`) alongside the array of rates EasyPost returned.
 */
export async function getRates(
  fromAddress: EasyPostAddress,
  toAddress: EasyPostAddress,
  parcel: EasyPostParcel
): Promise<EasyPostRatesResult> {
  const json = await easypostFetch("/shipments", {
    shipment: {
      from_address: toEasyPostAddressPayload(fromAddress),
      to_address: toEasyPostAddressPayload(toAddress),
      parcel: {
        weight: parcel.weightOz,
        length: parcel.lengthIn,
        width: parcel.widthIn,
        height: parcel.heightIn,
      },
    },
  });

  const rawRates = (json.rates as Array<Record<string, unknown>> | undefined) ?? [];

  return {
    easypostShipmentId: json.id as string,
    rates: rawRates.map((r) => ({
      id: r.id as string,
      carrier: r.carrier as string,
      service: r.service as string,
      rate: r.rate as string,
      currency: r.currency as string,
      deliveryDays: (r.delivery_days as number | null | undefined) ?? null,
    })),
  };
}

/**
 * Purchases a label for the given EasyPost shipment + chosen rate.
 */
export async function buyLabel(shipmentId: string, rateId: string): Promise<EasyPostLabel> {
  const json = await easypostFetch(`/shipments/${shipmentId}/buy`, {
    rate: { id: rateId },
  });

  const postageLabel = json.postage_label as Record<string, unknown> | undefined;

  return {
    trackingNumber: json.tracking_code as string,
    labelUrl: postageLabel?.label_url as string,
    labelFormat: (postageLabel?.label_file_type as string | undefined) ?? "PDF",
  };
}
