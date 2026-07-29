import { z } from "zod";

const numberLike = z.preprocess((value) => {
  if (typeof value === "string" && value.trim() !== "") {
    const normalized = value.replace(/[$,]/g, "");
    const asNum = Number(normalized);
    return Number.isFinite(asNum) ? asNum : value;
  }
  return value;
}, z.number());

const optionalString = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => (value == null ? undefined : value));

export const receiptItemSchema = z.object({
  description: z.string().min(1),
  upc: optionalString,
  baseCost: numberLike.default(0),
  discount: numberLike.default(0),
  taxed: z.boolean().default(false),
  notes: optionalString,
  partyShare: z.union([numberLike, z.null()]).optional(),
  subtotalFormula: optionalString,
  subtotalEach: numberLike.optional()
});

export const receiptSchema = z.object({
  merchant: z.string().optional(),
  location: z.string().optional(),
  currency: z.string().optional(),
  partyName: z.string().optional(),
  items: z.array(receiptItemSchema),
  totals: z
    .object({
      subtotal: numberLike.optional(),
      tax: numberLike.optional(),
      discounts: numberLike.optional(),
      deposits: numberLike.optional(),
      total: numberLike.optional()
    })
    .optional(),
  warnings: z.array(z.string()).optional(),
  model: z.string().optional()
});

export type ReceiptSchema = z.infer<typeof receiptSchema>;
