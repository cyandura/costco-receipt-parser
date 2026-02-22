import { geminiProvider } from "./gemini";
import { openAIProvider } from "./openai";
import type { ReceiptParserProvider } from "./types";

const providers: Record<string, ReceiptParserProvider> = {
  gemini: geminiProvider,
  openai: openAIProvider
};

export const getReceiptParserProvider = () => {
  const providerKey = (process.env.AI_PROVIDER || "openai").toLowerCase();
  const provider = providers[providerKey];
  if (!provider) {
    throw new Error(`Unsupported AI_PROVIDER "${providerKey}".`);
  }
  return provider;
};
