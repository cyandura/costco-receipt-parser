import OpenAI from "openai";
import type { ReceiptParserProvider } from "./types";

const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const basePrompt = `
You are extracting a Costco receipt into structured JSON.
Return only JSON, no markdown. 
Rules:
- Include every line item, including discounts, deposits, and taxes.
- Output monetary values as numbers (no $).
- If an adjustment is tied to a specific item, put it on that item.
- If adjustments are only totals, allocate them proportionally by line_subtotal.

Schema:
{
  "merchant": "Costco",
  "location": "City, State",
  "currency": "USD",
  "items": [
    {
      "description": "Item name",
      "sku": "Optional SKU",
      "quantity": 1,
      "unitPrice": 0,
      "lineSubtotal": 0,
      "discount": 0,
      "deposit": 0,
      "tax": 0,
      "finalTotal": 0,
      "notes": "Optional notes"
    }
  ],
  "totals": {
    "subtotal": 0,
    "tax": 0,
    "discounts": 0,
    "deposits": 0,
    "total": 0
  },
  "warnings": []
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

export const openAIProvider: ReceiptParserProvider = {
  name: "openai",
  async parseReceipt({ imageDataUrl }) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not set.");
    }

    const response = await client.responses.create({
      model,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: basePrompt },
            { type: "input_image", image_url: imageDataUrl, detail: "auto" }
          ]
        }
      ],
      temperature: 0.2
    });

    const text = response.output_text ?? "";
    const jsonText = extractJson(text);
    const parsed = JSON.parse(jsonText);

    return {
      ...parsed,
      model
    };
  }
};
