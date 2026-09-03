import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireAiAccess } from "@/lib/ai/authGuard";
import { anthropic, AI_MODEL, AI_EFFORT } from "@/lib/ai/client";
import { DESCRIBE_SYSTEM_PROMPT, buildDescribeUserPrompt, type DescribeInput } from "@/lib/ai/prompts";
import { recordUsage } from "@/lib/ai/quota";
import { aiErrorMessage } from "@/lib/ai/errors";
import { sanitizeListingHtml } from "@/lib/utils/sanitizeListingHtml";

export async function POST(req: NextRequest) {
  const auth = await requireAiAccess();
  if (auth.error) return auth.error;
  const { userId, tenantId } = auth.context;

  const body = (await req.json()) as DescribeInput;
  if (!body.title?.trim()) {
    return NextResponse.json({ error: "A title is required before writing a description." }, { status: 400 });
  }

  try {
    const response = await anthropic.messages.create({
      model: AI_MODEL,
      // Caps thinking tokens AND response text together. This route passes no
      // `thinking`, and on claude-opus-5 that means adaptive thinking is ON by
      // default (it was off by default on Opus 4.8/4.7), so part of this
      // budget goes to reasoning before a word of HTML is written. 4000 is
      // ample for a listing description at `effort: "low"`; the
      // `stop_reason === "max_tokens"` branch below is what makes a truncated
      // response say so honestly rather than returning half a description.
      max_tokens: 4000,
      output_config: { effort: AI_EFFORT },
      system: [
        {
          type: "text",
          text: DESCRIBE_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: buildDescribeUserPrompt(body) }],
    });

    // Tokens are billed whatever the stop reason, including a refusal.
    //
    // Metering failure is logged, never fatal. By this point the Anthropic
    // call has succeeded and already cost money; letting the outer catch turn
    // a metering error into a 502 would bill the tenant and hand them nothing.
    // Same principle as ImageGrid's console.warn on a failed storage cleanup:
    // a bookkeeping failure must not block the user.
    try {
      await recordUsage({
        tenantId,
        userId,
        kind: "describe",
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      });
    } catch (meterError) {
      console.error("Failed to record AI usage for describe", meterError);
    }

    if (response.stop_reason === "refusal") {
      return NextResponse.json(
        { error: "The assistant declined to write this description. Try rephrasing the title." },
        { status: 422 }
      );
    }

    // Truncated: the HTML is real but incomplete, and an unclosed tag would
    // be silently repaired by the sanitizer into a description that just
    // stops mid-sentence. Refuse it and say why.
    if (response.stop_reason === "max_tokens") {
      return NextResponse.json(
        {
          error:
            "The AI response was cut off before it finished. Try a shorter title or fewer item specifics.",
        },
        { status: 502 }
      );
    }

    const html = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    return NextResponse.json({ html: sanitizeListingHtml(html) });
  } catch (err) {
    return NextResponse.json({ error: aiErrorMessage(err) }, { status: 502 });
  }
}
