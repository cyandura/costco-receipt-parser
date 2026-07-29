import type { ReceiptItem, ReceiptParse } from "./types";
import { computeSubtotals } from "./formula";

const round2 = (value: number) => Math.round(value * 100) / 100;

type ReceiptItemInput = Omit<ReceiptItem, "subtotalEach"> & { subtotalEach?: number };
type ReceiptParseInput = Omit<ReceiptParse, "items"> & { items: ReceiptItemInput[] };

export const normalizeReceipt = (input: ReceiptParseInput): ReceiptParse => {
  const warnings = [...(input.warnings || [])];

  const subtotals = computeSubtotals(
    input.items.map((item) => ({
      baseCost: item.baseCost || 0,
      discount: item.discount || 0,
      taxed: Boolean(item.taxed),
      partyShare: item.partyShare,
      formula: item.subtotalFormula
    }))
  );

  const items: ReceiptItem[] = input.items.map((item, idx) => {
    if (subtotals[idx] === null) {
      warnings.push(`Row ${idx + 2} has a formula error; its subtotal was set to 0.`);
    }
    return {
      ...item,
      baseCost: round2(item.baseCost || 0),
      discount: round2(item.discount || 0),
      taxed: Boolean(item.taxed),
      subtotalEach: round2(subtotals[idx] ?? 0)
    };
  });

  const itemsTotal = items.reduce((sum, item) => sum + item.subtotalEach, 0);
  if (input.totals?.total && Math.abs(input.totals.total - itemsTotal) > 1) {
    warnings.push(
      `Item totals (${round2(itemsTotal)}) differ from receipt total (${round2(input.totals.total)}).`
    );
  }

  return {
    ...input,
    items,
    warnings
  };
};
