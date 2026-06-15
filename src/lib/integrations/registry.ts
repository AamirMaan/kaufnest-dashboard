import type { IntegrationPlatform } from "@/types";
import { amazonAdapter } from "./amazon";
import { ebayAdapter } from "./ebay";
import type { PlatformAdapter } from "./types";

const ADAPTERS: Record<IntegrationPlatform, PlatformAdapter> = {
  ebay: ebayAdapter,
  amazon: amazonAdapter,
};

export function isIntegrationPlatform(value: string): value is IntegrationPlatform {
  return value === "ebay" || value === "amazon";
}

export function getAdapter(platform: IntegrationPlatform): PlatformAdapter {
  return ADAPTERS[platform];
}
