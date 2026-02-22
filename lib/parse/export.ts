import type { ReceiptParse } from "./types";
import * as XLSX from "xlsx";

const formatMoney = (value: number) => value.toFixed(2);

const escapeCsv = (value: string) => {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
};

export const receiptToCsv = (receipt: ReceiptParse) => {
  const header = [
    "description",
    "sku",
    "quantity",
    "unit_price",
    "line_subtotal",
    "discount",
    "deposit",
    "tax",
    "final_total",
    "notes"
  ];

  const rows = receipt.items.map((item) => [
    escapeCsv(item.description),
    escapeCsv(item.sku ?? ""),
    String(item.quantity),
    formatMoney(item.unitPrice),
    formatMoney(item.lineSubtotal),
    formatMoney(item.discount),
    formatMoney(item.deposit),
    formatMoney(item.tax),
    formatMoney(item.finalTotal),
    escapeCsv(item.notes ?? "")
  ]);

  return [header.join(","), ...rows.map((row) => row.join(","))].join("\n");
};

export const receiptToXlsxBuffer = (receipt: ReceiptParse) => {
  const rows = receipt.items.map((item) => ({
    description: item.description,
    sku: item.sku ?? "",
    quantity: item.quantity,
    unit_price: item.unitPrice,
    line_subtotal: item.lineSubtotal,
    discount: item.discount,
    deposit: item.deposit,
    tax: item.tax,
    final_total: item.finalTotal,
    notes: item.notes ?? ""
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Items");

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
};
