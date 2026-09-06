import { NextRequest, NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { buyLabel } from "@/lib/shipping/easypost";
import { writeAuditLog } from "@/lib/utils/audit";
import type { Profile, Shipment } from "@/types";

interface BuyRequestBody {
  saleId: string;
  easypostShipmentId: string;
  rateId: string;
  weightOz: number;
  carrier: string;
  service: string;
  cost: number | null;
  costCurrency: string | null;
}

export async function POST(req: NextRequest) {
  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { client, userId } = auth.context;

  const body = (await req.json()) as Partial<BuyRequestBody>;
  if (
    !body.saleId ||
    !body.easypostShipmentId ||
    !body.rateId ||
    typeof body.weightOz !== "number" ||
    !body.carrier ||
    !body.service
  ) {
    return NextResponse.json(
      {
        error:
          "saleId, easypostShipmentId, rateId, weightOz, carrier and service are required.",
      },
      { status: 400 }
    );
  }

  // Buy the label first. cost/costCurrency/carrier/service are trusted from
  // the client here because they only affect what's DISPLAYED — rateId
  // alone determines what EasyPost actually charges, and rateId was already
  // shown to and chosen by the user against the route's own /rates
  // response in the previous step. The route is not re-fetching rates here
  // on purpose: the rate was already validated once.
  let label;
  try {
    label = await buyLabel(body.easypostShipmentId, body.rateId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to purchase the shipping label.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const { data: shipment, error: insertError } = await client
    .from("shipments")
    .insert({
      sale_id: body.saleId,
      carrier: body.carrier,
      service: body.service,
      tracking_number: label.trackingNumber,
      label_url: label.labelUrl,
      label_format: label.labelFormat,
      cost: body.cost ?? null,
      cost_currency: body.costCurrency ?? null,
      weight_oz: body.weightOz,
      easypost_shipment_id: body.easypostShipmentId,
      created_by: userId,
    })
    .select()
    .single<Shipment>();

  if (insertError || !shipment) {
    // The label WAS purchased at this point — a failure here is our own bug
    // (a 500), not a rejection from EasyPost. Surface the tracking number so
    // the seller isn't left with a paid label the app has no record of.
    console.error("[shipping/buy] label purchased but could not be saved:", insertError);
    return NextResponse.json(
      {
        error: `Label was purchased (tracking number ${label.trackingNumber}) but could not be saved. Contact support with this tracking number.`,
      },
      { status: 500 }
    );
  }

  const { data: profile } = await client
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .single<Pick<Profile, "email">>();

  await writeAuditLog(client, {
    userId,
    userEmail: profile?.email ?? "",
    action: "create",
    entityType: "shipment",
    entityId: shipment.id,
    metadata: {
      sale_id: body.saleId,
      carrier: shipment.carrier,
      service: shipment.service,
      tracking_number: shipment.tracking_number,
      cost: shipment.cost,
      cost_currency: shipment.cost_currency,
    },
  });

  return NextResponse.json(shipment);
}
