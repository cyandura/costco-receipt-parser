import { claudeProvider } from "./claude";
import type { ReceiptParserProvider } from "./types";

export const getReceiptParserProvider = (): ReceiptParserProvider => claudeProvider;
