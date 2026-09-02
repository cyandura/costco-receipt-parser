import type { ReceiptParserProvider } from "./types";
import Anthropic from "@anthropic-ai/sdk";

const model = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

const getApiKey = () => {
  return process.env.CLAUDE_API_KEY || "";
};

const basePrompt = `
You are reading a Costco receipt image so it can be turned into an Excel file that
follows an exact existing spreadsheet format. Return only JSON, no markdown.

How to read the receipt:
- Create ONE row per unit printed on the receipt. If the same item appears on
  multiple lines (bought more than once), output a separate row for each line
  exactly as printed — do not aggregate quantities into a single row.
- For each item line, capture its description and its UPC/item number (the
  number printed next to or below the description).
- "baseCost" is the item's printed price for that line, before any discount and
  before tax, as a plain number (no $).
- Whenever you see an "A" printed to the right of an item's price, that item is
  taxed — set "taxed": true. Otherwise "taxed": false.
- A line that contains a "/" followed by a UPC number, with a minus "-" sign to
  the right of a dollar amount, is a discount adjustment — NOT its own item row.
  It applies to the item whose UPC matches the number after the "/" (this is
  usually the item printed directly above it). Put that amount as a negative
  number in the "discount" field of the matching item's row, and do not create a
  separate row for the discount line itself.
- Treat bottle deposits as their own item row (their own line, description as
  printed, e.g. "BOTTLE DEPOSIT"), with "taxed": false and no discount. Treat
  bottle deposit returns/refunds the same way but with a negative baseCost.
- If an item was voided (a line marked VOID reversing a prior line), exclude
  both the original line and the void line entirely.
- Do not create rows for the receipt's subtotal, tax, or total lines — only
  product, deposit lines become item rows.
- Do not include a Mikay/Peters split field — that is left blank for the user to
  fill in later and is not part of what you extract.
- Output monetary values as numbers (no $).
- Keep the JSON as short as you can: omit any item field that would be empty,
  zero, or false. Leave out "discount" when there is no discount, "taxed" when
  the item is not taxed, and "notes" and "upc" when you have nothing to put in
  them. Only "description" and "baseCost" appear on every row.

Schema (the second item shows the short form for an ordinary row):
{
  "merchant": "Costco",
  "location": "City, State",
  "items": [
    {
      "description": "Item name as printed",
      "upc": "1234567",
      "baseCost": 19.99,
      "discount": -3.00,
      "taxed": true,
      "notes": "Optional notes"
    },
    { "description": "ORGANIC BANANAS", "upc": "7654321", "baseCost": 4.99 }
  ],
  "totals": {
    "subtotal": 0,
    "tax": 0,
    "discounts": 0,
    "deposits": 0,
    "total": 0
  }
}
`.trim();

const extractJson = (input: string) => {
  const start = input.indexOf("{");
  const end = input.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Model response did not include JSON.");
  }
  return input.slice(start, end + 1);
};

const parseDataUrl = (dataUrl: string) => {
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid image data URL.");
  }
  return { mimeType: match[1] as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: match[2] };
};

export const claudeProvider: ReceiptParserProvider = {
  name: "claude",
  async parseReceipt({ imageDataUrl }) {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error("CLAUDE_API_KEY is not set.");
    }

    const { mimeType, data } = parseDataUrl(imageDataUrl);

    const client = new Anthropic({ apiKey });

    const resp = await client.messages.create({
      model,
      // Shared budget for thinking plus the JSON, so it needs headroom for a
      // long receipt — at 4096 a 60-item parse could truncate mid-object.
      max_tokens: 8000,
      // Opus 5 thinks by default. Keeping it adaptive but at medium effort
      // preserves the cross-referencing that discount attribution and VOID
      // pairing rely on, while spending far fewer tokens than the default high.
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mimeType,
                data,
              },
            },
            {
              type: "text",
              text: `${basePrompt}\n\nProvide only the JSON described in the schema.`,
            },
          ],
        },
      ],
    });

    const textBlock = resp.content.find((block: { type: string }) => block.type === "text");
    const text = textBlock && "text" in textBlock ? textBlock.text : "";
    if (!text) {
      throw new Error("Claude response did not include any text content.");
    }

    const jsonText = extractJson(text);
    const parsed = JSON.parse(jsonText);

    return {
      ...parsed,
      model,
    };
  },
};
