import type { ReceiptParse } from "./types";
import * as XLSX from "xlsx";
import { DEFAULT_SUBTOTAL_TEMPLATE, materializeTemplate } from "./formula";

const CURRENCY_FORMAT = '"$"#,##0.00';

const formatMoney = (value: number) => value.toFixed(2);

const escapeCsv = (value: string) => {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
};

const itemLabel = (description: string, upc?: string) => (upc ? `${description} (${upc})` : description);

const partyLabel = (share: number | null | undefined) => {
  if (share === null || share === undefined) return "";
  if (share === 1) return "Yes";
  if (share === 0.5) return "Split";
  if (share === 0) return "No";
  return String(share);
};

export const receiptToCsv = (receipt: ReceiptParse) => {
  const partyName = receipt.partyName || "Party 1";
  const header = [
    "Costco Charges",
    "Base Cost",
    "Discount?",
    "Tax?",
    "notes",
    partyName,
    "Subtotal Cost ea",
    `${partyName} Owes`
  ];

  const rows = receipt.items.map((item) => [
    escapeCsv(itemLabel(item.description, item.upc)),
    formatMoney(item.baseCost),
    item.discount ? formatMoney(item.discount) : "",
    item.taxed ? "TRUE" : "FALSE",
    escapeCsv(item.notes ?? ""),
    partyLabel(item.partyShare),
    formatMoney(item.subtotalEach),
    formatMoney(item.subtotalEach * (item.partyShare ?? 0))
  ]);

  return [header.join(","), ...rows.map((row) => row.join(","))].join("\n");
};

export const receiptToXlsxBuffer = (receipt: ReceiptParse) => {
  const items = receipt.items;
  const partyName = receipt.partyName || "Party 1";

  const header = [
    "Costco Charges",
    "Base Cost",
    "Discount?",
    "Tax?",
    "notes",
    partyName,
    "Subtotal Cost ea",
    `${partyName} Owes`
  ];

  const worksheet = XLSX.utils.aoa_to_sheet([header]);

  items.forEach((item, index) => {
    const row = index + 2; // header occupies row 1

    XLSX.utils.sheet_add_aoa(worksheet, [[itemLabel(item.description, item.upc)]], {
      origin: `A${row}`
    });
    worksheet[`B${row}`] = { t: "n", v: item.baseCost, z: CURRENCY_FORMAT };
    if (item.discount) {
      worksheet[`C${row}`] = { t: "n", v: item.discount, z: CURRENCY_FORMAT };
    }
    worksheet[`D${row}`] = { t: "b", v: item.taxed, f: item.taxed ? "TRUE()" : "FALSE()" };
    if (item.notes) {
      worksheet[`E${row}`] = { t: "s", v: item.notes };
    }
    if (item.partyShare !== null && item.partyShare !== undefined) {
      worksheet[`F${row}`] = { t: "n", v: item.partyShare };
    }
    worksheet[`G${row}`] = {
      t: "n",
      v: item.subtotalEach,
      f: materializeTemplate(item.subtotalFormula || DEFAULT_SUBTOTAL_TEMPLATE, row),
      z: CURRENCY_FORMAT
    };
    worksheet[`H${row}`] = {
      t: "n",
      v: item.subtotalEach * (item.partyShare ?? 0),
      f: `G${row}*F${row}`,
      z: CURRENCY_FORMAT
    };
  });

  const lastItemRow = items.length + 1;
  const totalsRow = lastItemRow + 1;
  const itemsTotal = items.reduce((sum, item) => sum + item.subtotalEach, 0);
  const owesTotal = items.reduce((sum, item) => sum + item.subtotalEach * (item.partyShare ?? 0), 0);

  worksheet[`G${totalsRow}`] = {
    t: "n",
    v: Math.round(itemsTotal * 100) / 100,
    f: `SUM(G2:G${lastItemRow})`,
    z: CURRENCY_FORMAT
  };
  worksheet[`H${totalsRow}`] = {
    t: "n",
    v: Math.round(owesTotal * 100) / 100,
    f: `SUM(H2:H${lastItemRow})`,
    z: CURRENCY_FORMAT
  };
  worksheet[`I${totalsRow}`] = { t: "s", v: `Total ${partyName} owes` };

  worksheet["!ref"] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: totalsRow - 1, c: 8 }
  });
  worksheet["!cols"] = [
    { wch: 30 },
    { wch: 11 },
    { wch: 11 },
    { wch: 8 },
    { wch: 16 },
    { wch: 12 },
    { wch: 15 },
    { wch: 15 },
    { wch: 22 }
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
};
