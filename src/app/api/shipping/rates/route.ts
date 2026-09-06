import { NextRequest, NextResponse } from "next/server";
import { requireIntegrationAdmin } from "@/lib/integrations/authGuard";
import { getRates } from "@/lib/shipping/easypost";
import { addressFromCompanyProfile, addressFromSale } from "@/lib/shipping/addressMappers";
import type { CompanyProfile, Sale } from "@/types";

interface RatesRequestBody {
  saleId: string;
  weightOz: number;
  lengthIn?: number;
  widthIn?: number;
  heightIn?: number;
}

export async function POST(req: NextRequest) {
  const auth = await requireIntegrationAdmin();
  if (auth.error) return auth.error;
  const { client } = auth.context;

  const body = (await req.json()) as Partial<RatesRequestBody>;
  if (!body.saleId || typeof body.weightOz !== "number" || body.weightOz <= 0) {
    return NextResponse.json(
      { error: "saleId and a positive weightOz are required." },
      { status: 400 }
    );
  }

  const { data: sale, error: saleError } = await client
    .from("sales")
    .select("*")
    .eq("id", body.saleId)
    .single<Sale>();

  if (saleError || !sale) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  const { data: companyProfile, error: profileError } = await client
    .from("company_profile")
    .select("*")
    .single<CompanyProfile>();

  if (profileError || !companyProfile) {
    return NextResponse.json({ error: "Company profile not found." }, { status: 404 });
  }

  try {
    const fromAddress = addressFromCompanyProfile(companyProfile);
    const toAddress = addressFromSale(sale);

    const { easypostShipmentId, rates } = await getRates(fromAddress, toAddress, {
      weightOz: body.weightOz,
      lengthIn: body.lengthIn,
      widthIn: body.widthIn,
      heightIn: body.heightIn,
    });

    return NextResponse.json({ easypostShipmentId, rates });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch shipping rates.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
