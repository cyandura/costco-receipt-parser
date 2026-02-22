import type { ReceiptParse } from "../parse/types";

export type ReceiptParserProvider = {
  name: string;
  parseReceipt: (input: { imageDataUrl: string }) => Promise<ReceiptParse>;
};
