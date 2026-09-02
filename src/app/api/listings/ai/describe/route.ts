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
    await recordUsage({
      tenantId,
      userId,
      kind: "describe",
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });

    if (response.stop_reason === "refusal") {
      return NextResponse.json(
        { error: "The assistant declined to write this description. Try rephrasing the title." },
        { status: 422 }
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
