import type { CompanyProfile, Sale } from "@/types";
import type { EasyPostAddress } from "./easypost";

/**
 * Maps the tenant's ship-from address (CompanyProfile.ship_from_*) to an
 * EasyPost address. Throws a descriptive error naming the missing field
 * when a required one is null — this is the "sender address not
 * configured" guard the two shipping API routes rely on. The UI
 * additionally hides the "Generate Shipping Label" button when this would
 * throw (checked client-side from already-loaded state) so a seller
 * doesn't click a button guaranteed to fail — both checks guard the same
 * thing on purpose, belt and suspenders.
 */
export function addressFromCompanyProfile(profile: CompanyProfile): EasyPostAddress {
  if (!profile.ship_from_street1) {
    throw new Error("Sender address is missing a street address — add one in Settings.");
  }
  if (!profile.ship_from_city) {
    throw new Error("Sender address is missing a city — add one in Settings.");
  }
  if (!profile.ship_from_postal_code) {
    throw new Error("Sender address is missing a postal code — add one in Settings.");
  }
  if (!profile.ship_from_country) {
    throw new Error("Sender address is missing a country — add one in Settings.");
  }

  return {
    name: profile.name || null,
    street1: profile.ship_from_street1,
    street2: profile.ship_from_street2,
    city: profile.ship_from_city,
    state: profile.ship_from_state,
    zip: profile.ship_from_postal_code,
    country: profile.ship_from_country,
    phone: profile.phone,
    email: profile.email,
  };
}

/**
 * Maps a sale's buyer shipping address (Sale.shipping_* / buyer_*) to an
 * EasyPost address. Throws a descriptive error naming the missing field
 * when a required one is null — the "buyer address not captured" guard.
 */
export function addressFromSale(sale: Sale): EasyPostAddress {
  if (!sale.shipping_address_line1) {
    throw new Error("Buyer address is missing a street address.");
  }
  if (!sale.shipping_city) {
    throw new Error("Buyer address is missing a city.");
  }
  if (!sale.shipping_postal_code) {
    throw new Error("Buyer address is missing a postal code.");
  }
  if (!sale.shipping_country) {
    throw new Error("Buyer address is missing a country.");
  }

  return {
    name: sale.buyer_name,
    street1: sale.shipping_address_line1,
    street2: sale.shipping_address_line2,
    city: sale.shipping_city,
    state: sale.shipping_state,
    zip: sale.shipping_postal_code,
    country: sale.shipping_country,
    phone: sale.buyer_phone,
    email: sale.buyer_email,
  };
}
