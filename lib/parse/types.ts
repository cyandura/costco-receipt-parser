export type ReceiptItem = {
  description: string;
  sku?: string;
  quantity: number;
  unitPrice: number;
  lineSubtotal: number;
  discount: number;
  deposit: number;
  tax: number;
  finalTotal: number;
  notes?: string;
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
  items: ReceiptItem[];
  totals?: ReceiptTotals;
  warnings?: string[];
  model?: string;
};
