import { getReceiptParserProvider } from "../ai";
import { receiptSchema } from "./schema";
import { normalizeReceipt } from "./normalize";
import type { ReceiptParse } from "./types";

export const parseReceiptFromImage = async (imageDataUrl: string): Promise<ReceiptParse> => {
  const provider = getReceiptParserProvider();
  const raw = await provider.parseReceipt({ imageDataUrl });
  const parsed = receiptSchema.parse(raw);
  return normalizeReceipt(parsed);
};
