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
  sku: optionalString,
  quantity: numberLike.default(1),
  unitPrice: numberLike.default(0),
  lineSubtotal: numberLike.default(0),
  discount: numberLike.default(0),
  deposit: numberLike.default(0),
  tax: numberLike.default(0),
  finalTotal: numberLike.default(0),
  notes: optionalString
});

export const receiptSchema = z.object({
  merchant: z.string().optional(),
  location: z.string().optional(),
  currency: z.string().optional(),
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
