"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ReceiptParse } from "../../lib/parse/types";
import { computeSubtotals } from "../../lib/parse/formula";
import ReceiptGrid, { type GridRow } from "./ReceiptGrid";

const makeId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `row-${Math.random().toString(36).slice(2)}`;

const formatMoney = (value?: number | null) =>
  typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(2)}` : "—";

const tokenKey = (id: string) => `receipt-session-token:${id}`;

const readToken = (id: string) => {
  try {
    return window.localStorage.getItem(tokenKey(id));
  } catch {
    return null;
  }
};

const saveToken = (id: string, token: string) => {
  try {
    window.localStorage.setItem(tokenKey(id), token);
  } catch {
    // Private browsing / storage disabled — edit rights just won't persist.
  }
};

type ParseMeta = Pick<ReceiptParse, "merchant" | "location" | "totals" | "warnings" | "model">;

const rowsFromReceipt = (receipt: ReceiptParse): GridRow[] =>
  receipt.items.map((item) => ({
    id: makeId(),
    label: item.upc ? `${item.description} (${item.upc})` : item.description,
    baseCost: item.baseCost,
    discount: item.discount,
    taxed: item.taxed,
    notes: item.notes ?? "",
    partyShare: item.partyShare ?? null,
    formula: item.subtotalFormula ?? null
  }));

const metaFromReceipt = (receipt: ReceiptParse): ParseMeta => ({
  merchant: receipt.merchant,
  location: receipt.location,
  totals: receipt.totals,
  warnings: receipt.warnings,
  model: receipt.model
});

type SaveState = "idle" | "saving" | "saved" | "error";

type Props = {
  /** Present when rendering a shared session at /s/[id]. */
  sessionId?: string;
  initialReceipt?: ReceiptParse | null;
};

export default function ReceiptEditor({ sessionId, initialReceipt }: Props) {
  const router = useRouter();
  const isSession = Boolean(sessionId);

  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<GridRow[]>(() =>
    initialReceipt ? rowsFromReceipt(initialReceipt) : []
  );
  const [partyName, setPartyName] = useState(initialReceipt?.partyName || "Party 1");
  const [meta, setMeta] = useState<ParseMeta | null>(() =>
    initialReceipt ? metaFromReceipt(initialReceipt) : null
  );
  const [status, setStatus] = useState<string>("Ready.");
  const [isParsing, setIsParsing] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // On the home page the sheet is always editable (nothing is persisted yet).
  // On a shared session it depends on holding the edit token.
  const [canEdit, setCanEdit] = useState(!isSession);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [isSharing, setIsSharing] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  // Bumped by every user mutation; drives the debounced autosave.
  const [revision, setRevision] = useState(0);

  const subtotals = useMemo(() => computeSubtotals(rows), [rows]);

  const totals = useMemo(() => {
    const itemTotal = subtotals.reduce<number>((sum, v) => sum + (v ?? 0), 0);
    const partyOwes = rows.reduce<number>(
      (sum, row, idx) => sum + (subtotals[idx] ?? 0) * (row.partyShare ?? 0),
      0
    );
    return { itemTotal, partyOwes };
  }, [rows, subtotals]);

  const buildReceiptPayload = useCallback(
    (): ReceiptParse => ({
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
      totals: meta?.totals,
      warnings: meta?.warnings,
      model: meta?.model
    }),
    [meta, partyName, rows, subtotals]
  );

  // The autosave effect only depends on `revision`, so it needs a live handle
  // on the current sheet rather than a captured one.
  const payloadRef = useRef(buildReceiptPayload);
  payloadRef.current = buildReceiptPayload;

  // Claim edit rights: a token in the URL fragment (from another device) wins,
  // otherwise fall back to one this browser already holds.
  useEffect(() => {
    if (!sessionId) return;

    const fromHash = window.location.hash.match(/[#&]k=([A-Za-z0-9_-]+)/)?.[1];
    if (fromHash) {
      saveToken(sessionId, fromHash);
      // Keep the secret out of the address bar so copying the URL from there
      // shares view access only.
      window.history.replaceState(null, "", window.location.pathname);
    }

    const token = fromHash || readToken(sessionId);
    if (!token) return;

    let cancelled = false;
    void fetch(`/api/sessions/${sessionId}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.canEdit) setCanEdit(true);
      })
      .catch(() => {
        /* stay read-only */
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Debounced autosave.
  useEffect(() => {
    if (!revision || !sessionId || !canEdit) return;

    const timer = setTimeout(async () => {
      const token = readToken(sessionId);
      if (!token) return;

      setSaveState("saving");
      try {
        const res = await fetch(`/api/sessions/${sessionId}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ receipt: payloadRef.current() })
        });
        if (!res.ok) throw new Error("save failed");
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [revision, sessionId, canEdit]);

  const touch = () => setRevision((n) => n + 1);

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
      setRows(rowsFromReceipt(data));
      setMeta(metaFromReceipt(data));
      setStatus(`Parsed ${data.items.length} line items.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong.";
      setStatus(message);
    } finally {
      setIsParsing(false);
    }
  };

  const handleShare = async () => {
    if (!rows.length) return;
    setIsSharing(true);
    setStatus("Creating share link…");

    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receipt: buildReceiptPayload() })
      });

      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || "Failed to create share link.");
      }

      const { id, editToken } = (await res.json()) as { id: string; editToken: string };
      // Stored before navigating, so the creator lands on a clean URL that is
      // already editable in this browser.
      saveToken(id, editToken);
      router.push(`/s/${id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create share link.";
      setStatus(message);
    } finally {
      setIsSharing(false);
    }
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setStatus(text);
    }
  };

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
    touch();
  };

  const handlePartyNameChange = (name: string) => {
    setPartyName(name);
    touch();
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
    touch();
  };

  const handleDeleteRow = (id: string) => {
    setRows((current) => current.filter((row) => row.id !== id));
    touch();
  };

  const saveLabel =
    saveState === "saving"
      ? "Saving…"
      : saveState === "saved"
        ? "All changes saved"
        : saveState === "error"
          ? "Save failed — retry by editing again"
          : "Changes save automatically";

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

        {isSession ? (
          <section className={`share-bar${canEdit ? " editable" : " readonly"}`}>
            <div className="share-status">
              <strong>{canEdit ? "You created this split" : "Shared split — read-only"}</strong>
              <span>
                {canEdit
                  ? saveLabel
                  : "Anyone with this link can view the numbers. Only the creator can change them."}
              </span>
            </div>
            <div className="share-actions">
              <button
                className="secondary"
                onClick={() => copy(window.location.origin + window.location.pathname, "view")}
              >
                {copied === "view" ? "Copied!" : "Copy share link"}
              </button>
              {canEdit && sessionId ? (
                <button
                  className="ghost"
                  title="Opens with edit access on another device — keep it private"
                  onClick={() =>
                    copy(
                      `${window.location.origin}/s/${sessionId}#k=${readToken(sessionId) ?? ""}`,
                      "edit"
                    )
                  }
                >
                  {copied === "edit" ? "Copied!" : "Copy edit link"}
                </button>
              ) : null}
            </div>
          </section>
        ) : null}

        <section className={`card-grid${isSession ? " single" : ""}`}>
          {!isSession ? (
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
          ) : null}

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
                {canEdit ? (
                  <button className="secondary" onClick={handleAddRow}>
                    ＋ Add Row
                  </button>
                ) : null}
                {!isSession ? (
                  <button onClick={handleShare} disabled={isSharing}>
                    {isSharing ? "Creating…" : "🔗 Create share link"}
                  </button>
                ) : null}
                <button className="secondary" onClick={() => handleExport("csv")}>
                  Download CSV
                </button>
                <button className="secondary" onClick={() => handleExport("xlsx")}>
                  Download Excel
                </button>
              </div>
            </div>
            <ReceiptGrid
              rows={rows}
              subtotals={subtotals}
              partyName={partyName}
              readOnly={!canEdit}
              onPartyNameChange={handlePartyNameChange}
              onRowChange={handleRowChange}
              onDeleteRow={handleDeleteRow}
            />
            <div className="sheet-footer">
              <span>
                {canEdit
                  ? "Tip: click a Subtotal cell to view its formula — taxed rows use a 6% rate."
                  : "Read-only view. You can still download the CSV or Excel export."}
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
