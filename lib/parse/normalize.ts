import type { ReceiptItem, ReceiptParse } from "./types";

const round2 = (value: number) => Math.round(value * 100) / 100;

const computeItem = (item: ReceiptItem): ReceiptItem => {
  const quantity = item.quantity || 1;
  const unitPrice = item.unitPrice || 0;
  const lineSubtotal =
    item.lineSubtotal && item.lineSubtotal > 0 ? item.lineSubtotal : unitPrice * quantity;
  const discount = item.discount || 0;
  const deposit = item.deposit || 0;
  const tax = item.tax || 0;
  const finalTotal =
    item.finalTotal && item.finalTotal !== 0
      ? item.finalTotal
      : lineSubtotal - discount + deposit + tax;

  return {
    ...item,
    quantity,
    unitPrice: round2(unitPrice),
    lineSubtotal: round2(lineSubtotal),
    discount: round2(discount),
    deposit: round2(deposit),
    tax: round2(tax),
    finalTotal: round2(finalTotal)
  };
};

const allocateTotals = (items: ReceiptItem[], totals?: ReceiptParse["totals"]) => {
  if (!totals) return items;
  const baseTotal = items.reduce((sum, item) => sum + (item.lineSubtotal || 0), 0);
  if (baseTotal <= 0) return items;

  const hasAnyTax = items.some((item) => (item.tax || 0) > 0);
  const hasAnyDiscount = items.some((item) => (item.discount || 0) > 0);
  const hasAnyDeposit = items.some((item) => (item.deposit || 0) > 0);

  return items.map((item) => {
    const share = (item.lineSubtotal || 0) / baseTotal;
    const tax = hasAnyTax ? item.tax : (totals.tax || 0) * share;
    const discount = hasAnyDiscount ? item.discount : (totals.discounts || 0) * share;
    const deposit = hasAnyDeposit ? item.deposit : (totals.deposits || 0) * share;

    const finalTotal = item.finalTotal || item.lineSubtotal - discount + deposit + tax;

    return computeItem({
      ...item,
      tax,
      discount,
      deposit,
      finalTotal
    });
  });
};

export const normalizeReceipt = (input: ReceiptParse): ReceiptParse => {
  const items = input.items.map(computeItem);
  const allocated = allocateTotals(items, input.totals);
  const warnings = [...(input.warnings || [])];

  const totalItems = allocated.reduce((sum, item) => sum + item.finalTotal, 0);
  if (input.totals?.total && Math.abs(input.totals.total - totalItems) > 1) {
    warnings.push(
      `Item totals (${round2(totalItems)}) differ from receipt total (${round2(
        input.totals.total
      )}).`
    );
  }

  return {
    ...input,
    items: allocated,
    warnings
  };
};
