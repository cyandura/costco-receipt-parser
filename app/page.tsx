"use client";

import { useMemo, useState } from "react";
import type { ReceiptParse } from "../lib/parse/types";

const formatMoney = (value?: number) =>
  typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "-";

export default function HomePage() {
  const [file, setFile] = useState<File | null>(null);
  const [receipt, setReceipt] = useState<ReceiptParse | null>(null);
  const [status, setStatus] = useState<string>("Ready.");
  const [isParsing, setIsParsing] = useState(false);

  const totals = useMemo(() => {
    if (!receipt) return null;
    const itemTotal = receipt.items.reduce((sum, item) => sum + item.finalTotal, 0);
    return {
      itemTotal,
      ...receipt.totals
    };
  }, [receipt]);

  const handleParse = async () => {
    if (!file) return;
    setIsParsing(true);
    setStatus("Parsing receipt...");

    try {
      const form = new FormData();
      form.append("file", file);

      const res = await fetch("/api/parse", { method: "POST", body: form });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || "Failed to parse receipt.");
      }

      const data = (await res.json()) as ReceiptParse;
      setReceipt(data);
      setStatus("Parsed successfully.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong.";
      setStatus(message);
    } finally {
      setIsParsing(false);
    }
  };

  const handleExport = async (format: "csv" | "xlsx") => {
    if (!receipt) return;
    setStatus(`Generating ${format.toUpperCase()}...`);

    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, receipt })
      });

      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || "Failed to export.");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = format === "csv" ? "costco-receipt.csv" : "costco-receipt.xlsx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setStatus("Export ready.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Export failed.";
      setStatus(message);
    }
  };

  return (
    <main>
      <div className="shell">
        <section className="hero">
          <span className="pill">Modular AI receipt parsing</span>
          <h1>Costco Receipt Parser</h1>
          <p>
            Upload a Costco receipt image. The parser reads every line, applies discounts,
            bottle deposits, and state taxes, then lets you export itemized CSV or Excel.
          </p>
        </section>

        <section className="card-grid">
          <div className="card uploader">
            <h2>Upload & Parse</h2>
            <div className="dropzone">
              <input
                type="file"
                accept="image/*"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              <p className="status">{file ? file.name : "Choose a receipt image."}</p>
            </div>
            <div className="actions">
              <button onClick={handleParse} disabled={!file || isParsing}>
                {isParsing ? "Parsing..." : "Parse Receipt"}
              </button>
              <button
                className="secondary"
                onClick={() => handleExport("csv")}
                disabled={!receipt}
              >
                Download CSV
              </button>
              <button
                className="secondary"
                onClick={() => handleExport("xlsx")}
                disabled={!receipt}
              >
                Download Excel
              </button>
            </div>
            <p className="status">{status}</p>
          </div>

          <div className="card">
            <h2>Summary</h2>
            {receipt ? (
              <div className="totals">
                <div>
                  <strong>Merchant:</strong> {receipt.merchant ?? "Costco"}
                </div>
                <div>
                  <strong>Location:</strong> {receipt.location ?? "Unknown"}
                </div>
                <div>
                  <strong>Items:</strong> {receipt.items.length}
                </div>
                <div>
                  <strong>Item Total:</strong> ${formatMoney(totals?.itemTotal)}
                </div>
                <div>
                  <strong>Receipt Total:</strong> ${formatMoney(totals?.total)}
                </div>
                <div>
                  <strong>Tax:</strong> ${formatMoney(totals?.tax)}
                </div>
                <div>
                  <strong>Discounts:</strong> ${formatMoney(totals?.discounts)}
                </div>
                <div>
                  <strong>Deposits:</strong> ${formatMoney(totals?.deposits)}
                </div>
                {receipt.warnings?.length ? (
                  <div>
                    <strong>Warnings:</strong> {receipt.warnings.join(" ")}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="status">Upload a receipt to see totals here.</p>
            )}
          </div>
        </section>

        {receipt ? (
          <section className="card">
            <h2>Parsed Items</h2>
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th>Qty</th>
                    <th>Unit</th>
                    <th>Subtotal</th>
                    <th>Discount</th>
                    <th>Deposit</th>
                    <th>Tax</th>
                    <th>Final</th>
                  </tr>
                </thead>
                <tbody>
                  {receipt.items.map((item, idx) => (
                    <tr key={`${item.description}-${idx}`}>
                      <td>{item.description}</td>
                      <td>{item.quantity}</td>
                      <td>${formatMoney(item.unitPrice)}</td>
                      <td>${formatMoney(item.lineSubtotal)}</td>
                      <td>${formatMoney(item.discount)}</td>
                      <td>${formatMoney(item.deposit)}</td>
                      <td>${formatMoney(item.tax)}</td>
                      <td>${formatMoney(item.finalTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
