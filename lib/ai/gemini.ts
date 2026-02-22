import { GoogleGenAI } from "@google/genai";
import type { ReceiptParserProvider } from "./types";

const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const getApiKey = () => {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
};

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

const parseDataUrl = (dataUrl: string) => {
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid image data URL.");
  }
  return { mimeType: match[1], data: match[2] };
};

const extractResponseText = (response: unknown) => {
  const directText =
    typeof response === "object" && response !== null && "text" in response
      ? (response as { text?: string }).text
      : undefined;
  if (directText) {
    return directText;
  }

  const candidates =
    typeof response === "object" && response !== null && "candidates" in response
      ? (response as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
          .candidates
      : undefined;

  if (candidates?.length) {
    const parts = candidates[0]?.content?.parts ?? [];
    const joined = parts.map((part) => part.text ?? "").join("");
    if (joined) {
      return joined;
    }
  }

  return "";
};

const summarizeResponse = (response: unknown) => {
  if (typeof response !== "object" || response === null) {
    return { kind: typeof response };
  }

  const candidates = "candidates" in response ? (response as { candidates?: unknown[] }).candidates : undefined;
  const hasText = "text" in response;

  return {
    hasText,
    candidateCount: Array.isArray(candidates) ? candidates.length : 0,
    keys: Object.keys(response)
  };
};

export const geminiProvider: ReceiptParserProvider = {
  name: "gemini",
  async parseReceipt({ imageDataUrl }) {
    console.log("inside gemini parse method");
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY (or GOOGLE_API_KEY) is not set.");
    }

    const ai = new GoogleGenAI({ apiKey });
    console.log("before parse data url method");
    const { mimeType, data } = parseDataUrl(imageDataUrl);
    console.log("after parse data url method, before calling ai models generate content");
    const response = await ai.models.generateContent({
      model,
      contents: [
        { text: basePrompt },
        {
          inlineData: {
            mimeType,
            data
          }
        }
      ],
      config: {
        temperature: 0.2
      }
    });
    console.log("after calling ai models generate content");
    console.log("before extracting response text");
    const text = extractResponseText(response);
    console.log("before extracting response text");
    if (!text) {
      console.warn("Gemini response had no text content.", summarizeResponse(response));
      throw new Error("Gemini response did not include any text content.");
    }

    const jsonText = extractJson(text);
    const parsed = JSON.parse(jsonText);

    return {
      ...parsed,
      model
    };
  }
};
