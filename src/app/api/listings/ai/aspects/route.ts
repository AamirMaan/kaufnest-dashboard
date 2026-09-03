import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireAiAccess } from "@/lib/ai/authGuard";
import { anthropic, AI_MODEL, AI_EFFORT } from "@/lib/ai/client";
import { ASPECTS_SYSTEM_PROMPT, buildAspectSchema } from "@/lib/ai/prompts";
import { recordUsage } from "@/lib/ai/quota";
import { aiErrorMessage } from "@/lib/ai/errors";

interface AspectsInput {
  requiredAspectNames: string[];
  title: string;
  description: string;
  imageUrls: string[];
}

export async function POST(req: NextRequest) {
  const auth = await requireAiAccess();
  if (auth.error) return auth.error;
  const { userId, tenantId } = auth.context;

  const body = (await req.json()) as AspectsInput;

  // No aspects to fill in — skip the API call and the quota spend entirely.
  if (!body.requiredAspectNames?.length) {
    return NextResponse.json({ aspects: {} });
  }

  try {
    const images = body.imageUrls.slice(0, 4).map((url) => ({
      type: "image" as const,
      source: { type: "url" as const, url },
    }));

    const response = await anthropic.messages.create({
      model: AI_MODEL,
      // 4000, matching describe/route.ts. `max_tokens` caps thinking tokens
      // AND response text together, and neither route passes `thinking` —
      // on claude-opus-5 that means adaptive thinking is ON by default (it
      // was off by default on Opus 4.8/4.7), so it takes a share of this
      // budget before the JSON object is written. The old 1000 was tight for
      // a JSON object derived from up to 4 images and truncated into an
      // opaque parse failure. Do not lower it without also setting
      // `thinking: { type: "disabled" }` — which is only legal at effort
      // `high` or below, and this route runs at `low`.
      max_tokens: 4000,
      output_config: {
        effort: AI_EFFORT,
        format: {
          type: "json_schema" as const,
          // buildAspectSchema (src/lib/ai/prompts.ts) returns `object`; the
          // SDK's JSONOutputFormat.schema wants an indexable record. The
          // function's own shape (a plain JSON Schema object) is unaffected.
          schema: buildAspectSchema(body.requiredAspectNames) as { [key: string]: unknown },
        },
      },
      system: [
        { type: "text", text: ASPECTS_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      ],
      messages: [
        {
          role: "user",
          content: [
            ...images,
            {
              type: "text",
              text: `Title: ${body.title}\n\nDescription:\n${body.description}\n\nExtract these item specifics: ${body.requiredAspectNames.join(", ")}`,
            },
          ],
        },
      ],
    });

    // Tokens are billed whatever the stop reason, including a refusal.
    //
    // Metering failure is logged, never fatal — see the same block in
    // `../describe/route.ts`. The Anthropic call has already succeeded and
    // cost money; a 502 from the outer catch would bill the tenant and throw
    // the extracted aspects away.
    try {
      await recordUsage({
        tenantId,
        userId,
        kind: "aspects",
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      });
    } catch (meterError) {
      console.error("Failed to record AI usage for aspects", meterError);
    }

    if (response.stop_reason === "refusal") {
      return NextResponse.json(
        { error: "The assistant declined to extract item specifics for this listing." },
        { status: 422 }
      );
    }

    // A truncated response is not a malformed one — say so, instead of
    // letting a half-written JSON object fall through to the generic
    // "unexpected response" parse failure below, which gives the seller
    // nothing to act on.
    if (response.stop_reason === "max_tokens") {
      return NextResponse.json(
        { error: "The AI response was cut off. Try a shorter title or fewer images." },
        { status: 502 }
      );
    }

    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === "text"
    );
    if (!textBlock) {
      return NextResponse.json(
        { error: "The AI service returned an unexpected response. Try again." },
        { status: 502 }
      );
    }

    // JSON.parse, never string matching — escaping varies.
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(textBlock.text) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: "The AI service returned an unexpected response. Try again." },
        { status: 502 }
      );
    }

    // Belt-and-braces on top of the schema's additionalProperties: false —
    // drop any key that isn't one of the requested aspects.
    const allowed = new Set(body.requiredAspectNames);
    const aspects: Record<string, string> = {};
    for (const [name, value] of Object.entries(parsed)) {
      if (allowed.has(name) && typeof value === "string") {
        aspects[name] = value;
      }
    }

    return NextResponse.json({ aspects });
  } catch (err) {
    return NextResponse.json({ error: aiErrorMessage(err) }, { status: 502 });
  }
}
