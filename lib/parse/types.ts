export type ReceiptItem = {
  description: string;
  upc?: string;
  baseCost: number;
  discount: number;
  taxed: boolean;
  notes?: string;
  // Party share of this line: 1 = yes, 0.5 = split, 0 = no, null/undefined = unset.
  partyShare?: number | null;
  // Custom subtotal formula template ("@" = own row number); undefined = default.
  subtotalFormula?: string;
  subtotalEach: number;
};

export type ReceiptTotals = {
  subtotal?: number;
  tax?: number;
  discounts?: number;
  deposits?: number;
  total?: number;
};

export type ReceiptParse = {
  merchant?: string;
  location?: string;
  currency?: string;
  partyName?: string;
  items: ReceiptItem[];
  totals?: ReceiptTotals;
  warnings?: string[];
  model?: string;
};
