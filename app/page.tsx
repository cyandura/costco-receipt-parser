"use client";

import { useMemo, useRef, useState } from "react";
import type { ReceiptParse } from "../lib/parse/types";
import { computeSubtotals } from "../lib/parse/formula";
import ReceiptGrid, { type GridRow } from "./components/ReceiptGrid";

const makeId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `row-${Math.random().toString(36).slice(2)}`;

const formatMoney = (value?: number | null) =>
  typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(2)}` : "—";

type ParseMeta = Pick<ReceiptParse, "merchant" | "location" | "totals" | "warnings" | "model">;

export default function HomePage() {
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<GridRow[]>([]);
  const [partyName, setPartyName] = useState("Party 1");
  const [meta, setMeta] = useState<ParseMeta | null>(null);
  const [status, setStatus] = useState<string>("Ready.");
  const [isParsing, setIsParsing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const subtotals = useMemo(() => computeSubtotals(rows), [rows]);

  const totals = useMemo(() => {
    const itemTotal = subtotals.reduce<number>((sum, v) => sum + (v ?? 0), 0);
    const partyOwes = rows.reduce<number>(
      (sum, row, idx) => sum + (subtotals[idx] ?? 0) * (row.partyShare ?? 0),
      0
    );
    return { itemTotal, partyOwes };
  }, [rows, subtotals]);

  const acceptFile = (candidate: File | null | undefined) => {
    if (candidate && candidate.type.startsWith("image/")) {
      setFile(candidate);
    }
  };

  const handleParse = async () => {
    if (!file) return;
    setIsParsing(true);
    setStatus("Parsing receipt…");

    try {
      const form = new FormData();
      form.append("file", file);

      const res = await fetch("/api/parse", { method: "POST", body: form });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || "Failed to parse receipt.");
      }

      const data = (await res.json()) as ReceiptParse;
      setRows(
        data.items.map((item) => ({
          id: makeId(),
          label: item.upc ? `${item.description} (${item.upc})` : item.description,
          baseCost: item.baseCost,
          discount: item.discount,
          taxed: item.taxed,
          notes: item.notes ?? "",
          partyShare: item.partyShare ?? null,
          formula: item.subtotalFormula ?? null
        }))
      );
      setMeta({
        merchant: data.merchant,
        location: data.location,
        totals: data.totals,
        warnings: data.warnings,
        model: data.model
      });
      setStatus(`Parsed ${data.items.length} line items.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong.";
      setStatus(message);
    } finally {
      setIsParsing(false);
    }
  };

  const buildReceiptPayload = (): ReceiptParse => ({
    merchant: meta?.merchant,
    location: meta?.location,
    partyName,
    items: rows.map((row, idx) => ({
      description: row.label || "Untitled item",
      baseCost: row.baseCost,
      discount: row.discount,
      taxed: row.taxed,
      notes: row.notes || undefined,
      partyShare: row.partyShare,
      subtotalFormula: row.formula ?? undefined,
      subtotalEach: subtotals[idx] ?? 0
    })),
    totals: meta?.totals
  });

  const handleExport = async (format: "csv" | "xlsx") => {
    if (!rows.length) return;
    setStatus(`Generating ${format.toUpperCase()}…`);

    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, receipt: buildReceiptPayload() })
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

  const handleRowChange = (id: string, patch: Partial<GridRow>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const handleAddRow = () => {
    setRows((current) => [
      ...current,
      {
        id: makeId(),
        label: "New item",
        baseCost: 0,
        discount: 0,
        taxed: false,
        notes: "",
        partyShare: null,
        formula: null
      }
    ]);
  };

  const handleDeleteRow = (id: string) => {
    setRows((current) => current.filter((row) => row.id !== id));
  };

  return (
    <main>
      <div className="shell">
        <section className="hero">
          <span className="pill">AI receipt parsing · Cost splitting</span>
          <h1>Costco Receipt Parser</h1>
          <p>
            Upload a Costco receipt and get an editable, formula-aware sheet. Mark which items
            belong to your shopping partner — yes, no, or split — and the amount they owe you is
            calculated live and preserved in the Excel export.
          </p>
        </section>

        <section className="card-grid">
          <div className="card uploader">
            <h2>Upload &amp; Parse</h2>
            <div
              className={`dropzone${dragOver ? " drag-over" : ""}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragOver(false);
                acceptFile(event.dataTransfer.files?.[0]);
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={(event) => acceptFile(event.target.files?.[0])}
              />
              <span className="drop-title">
                {file ? file.name : "Drop a receipt image here"}
              </span>
              <span className="drop-hint">
                {file ? "Ready to parse." : "or click to browse — JPG, PNG, WebP up to 12MB"}
              </span>
            </div>
            <div className="actions">
              <button onClick={handleParse} disabled={!file || isParsing}>
                {isParsing ? "Parsing…" : "Parse Receipt"}
              </button>
            </div>
            <p className="status">{status}</p>
          </div>

          <div className="card">
            <h2>Summary</h2>
            {rows.length ? (
              <div className="totals">
                <div className="stat">
                  <span className="label">Merchant</span>
                  <span className="value">{meta?.merchant ?? "Costco"}</span>
                </div>
                <div className="stat">
                  <span className="label">Location</span>
                  <span className="value">{meta?.location ?? "Unknown"}</span>
                </div>
                <div className="stat">
                  <span className="label">Line items</span>
                  <span className="value">{rows.length}</span>
                </div>
                <div className="stat">
                  <span className="label">Sheet total</span>
                  <span className="value">{formatMoney(totals.itemTotal)}</span>
                </div>
                <div className="stat">
                  <span className="label">Receipt total</span>
                  <span className="value">{formatMoney(meta?.totals?.total)}</span>
                </div>
                <div className="stat emphasis">
                  <span className="label">{partyName} owes</span>
                  <span className="value">{formatMoney(totals.partyOwes)}</span>
                </div>
              </div>
            ) : (
              <p className="status">Upload a receipt to see totals here.</p>
            )}
            {meta?.warnings?.length ? (
              <div className="warnings">
                {meta.warnings.map((warning, idx) => (
                  <span key={idx}>{warning}</span>
                ))}
              </div>
            ) : null}
          </div>
        </section>

        {rows.length ? (
          <section className="card sheet-card">
            <div className="sheet-toolbar">
              <h2>Itemized Sheet</h2>
              <div className="toolbar-actions">
                <button className="secondary" onClick={handleAddRow}>
                  ＋ Add Row
                </button>
                <button className="secondary" onClick={() => handleExport("csv")}>
                  Download CSV
                </button>
                <button onClick={() => handleExport("xlsx")}>Download Excel</button>
              </div>
            </div>
            <ReceiptGrid
              rows={rows}
              subtotals={subtotals}
              partyName={partyName}
              onPartyNameChange={setPartyName}
              onRowChange={handleRowChange}
              onDeleteRow={handleDeleteRow}
            />
            <div className="sheet-footer">
              <span>
                Tip: click a Subtotal cell to view its formula — taxed rows use a 6% rate.
              </span>
              <span className="owes-banner">
                {partyName} owes <span className="amount">{`$${totals.partyOwes.toFixed(2)}`}</span>
              </span>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
