// Run with: node --test scripts/aliexpress/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseAmount,
  detectCurrency,
  parsePriceString,
  parseStock,
  isAliExpressSku,
  resolveSupplierUrl,
} from "./parsePrice.mjs";

test("parseAmount handles EU/US groupings and junk", () => {
  assert.equal(parseAmount("2,85"), 2.85); // EU decimal comma
  assert.equal(parseAmount("1.234,56"), 1234.56); // EU grouped
  assert.equal(parseAmount("1,234.56"), 1234.56); // US grouped
  assert.equal(parseAmount("3.20"), 3.2); // US decimal dot
  assert.equal(parseAmount("1,234"), 1234); // lone comma-3 = thousands
  assert.equal(parseAmount("1.234"), 1234); // lone dot-3 = thousands
  assert.equal(parseAmount("12.99"), 12.99); // lone dot-2 = decimal
  assert.equal(parseAmount("€ 2,85"), 2.85); // strips currency/space
  assert.equal(parseAmount("US $3.20"), 3.2);
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount(null), null);
  assert.equal(parseAmount("free"), null);
  assert.equal(parseAmount("0"), null); // non-positive rejected
});

test("detectCurrency prefers ISO, then symbol, then fallback", () => {
  assert.equal(detectCurrency("EUR 2,85"), "EUR");
  assert.equal(detectCurrency("3.20 USD"), "USD");
  assert.equal(detectCurrency("€2,85"), "EUR");
  assert.equal(detectCurrency("$3.20"), "USD");
  assert.equal(detectCurrency("£4.00"), "GBP");
  assert.equal(detectCurrency("2,85"), "EUR");
  assert.equal(detectCurrency("2,85", "USD"), "USD");
});

test("parsePriceString combines price + currency", () => {
  assert.deepEqual(parsePriceString("€2,85"), { price: 2.85, currency: "EUR" });
  assert.deepEqual(parsePriceString("US $3.20"), { price: 3.2, currency: "USD" });
  assert.equal(parsePriceString("Preis nicht verfügbar"), null);
  assert.equal(parsePriceString(null), null);
});

test("parseStock reads EN/DE availability phrasings", () => {
  assert.equal(parseStock("1000+ available"), 1000);
  assert.equal(parseStock("only 3 left"), 3);
  assert.equal(parseStock("5 verfügbar"), 5);
  assert.equal(parseStock("Nur noch 3 Stück übrig"), 3);
  assert.equal(parseStock("1.000 verfügbar"), 1000);
  assert.equal(parseStock("Kostenloser Versand"), null);
  assert.equal(parseStock(null), null);
});

test("isAliExpressSku matches 6–20 digit ids only", () => {
  assert.equal(isAliExpressSku("1005006994518770"), true);
  assert.equal(isAliExpressSku("12345"), false);
  assert.equal(isAliExpressSku("ABC123456"), false);
  assert.equal(isAliExpressSku(null), false);
});

test("resolveSupplierUrl: explicit link wins, else derive from SKU", () => {
  assert.equal(
    resolveSupplierUrl("https://de.aliexpress.com/item/x.html", "aliexpress", "999"),
    "https://de.aliexpress.com/item/x.html"
  );
  assert.equal(
    resolveSupplierUrl(null, null, "1005006994518770"),
    "https://de.aliexpress.com/item/1005006994518770.html"
  );
  assert.equal(resolveSupplierUrl(null, null, "CUSTOM"), null);
  assert.equal(resolveSupplierUrl("https://www.amazon.de/dp/x", "amazon", null), null);
});
