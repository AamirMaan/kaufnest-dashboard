import type { SourcePlatform } from "@/types";

export function detectPlatform(url: string): SourcePlatform | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }
  if (hostname.includes("amazon")) return "amazon";
  if (hostname.includes("aliexpress")) return "aliexpress";
  return null;
}
