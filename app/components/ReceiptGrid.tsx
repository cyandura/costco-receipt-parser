"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_SUBTOTAL_TEMPLATE,
  materializeTemplate,
  normalizeToTemplate
} from "../../lib/parse/formula";

export type GridRow = {
  id: string;
  label: string;
  baseCost: number;
  discount: number;
  taxed: boolean;
  notes: string;
  partyShare: number | null;
  formula: string | null;
};

type ColId = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";

type Selection = { col: ColId; idx: number } | null;

type Props = {
  rows: GridRow[];
  subtotals: (number | null)[];
  partyName: string;
  onPartyNameChange: (name: string) => void;
  onRowChange: (id: string, patch: Partial<GridRow>) => void;
  onDeleteRow: (id: string) => void;
};

const money = (value: number | null) =>
  value === null ? "#ERR" : `$${value.toFixed(2)}`;

const parseNumber = (text: string) => {
  const parsed = parseFloat(text.replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

const partyClass = (share: number | null) => {
  if (share === 1) return "yes";
  if (share === 0.5) return "split";
  if (share === 0) return "no";
  return "";
};

// Uncontrolled input that commits on blur/Enter; remounts via key when the
// upstream value changes so external edits are reflected.
function CellInput({
  value,
  onCommit,
  numeric,
  placeholder
}: {
  value: string;
  onCommit: (text: string) => void;
  numeric?: boolean;
  placeholder?: string;
}) {
  return (
    <input
      key={value}
      className={`cell-input${numeric ? " num" : ""}`}
      defaultValue={value}
      placeholder={placeholder}
      inputMode={numeric ? "decimal" : undefined}
      onBlur={(event) => {
        if (event.target.value !== value) onCommit(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
        if (event.key === "Escape") {
          (event.target as HTMLInputElement).value = value;
          (event.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export default function ReceiptGrid({
  rows,
  subtotals,
  partyName,
  onPartyNameChange,
  onRowChange,
  onDeleteRow
}: Props) {
  const [selected, setSelected] = useState<Selection>(null);
  const [barDraft, setBarDraft] = useState("");

  const owes = rows.map((row, idx) => {
    const subtotal = subtotals[idx];
    return subtotal === null ? null : subtotal * (row.partyShare ?? 0);
  });

  const sumSubtotal = subtotals.reduce<number>((sum, v) => sum + (v ?? 0), 0);
  const sumOwes = owes.reduce<number>((sum, v) => sum + (v ?? 0), 0);

  const barContent = (sel: Selection): { text: string; editable: boolean } => {
    if (!sel || !rows[sel.idx]) return { text: "", editable: false };
    const row = rows[sel.idx];
    const excelRow = sel.idx + 2;
    switch (sel.col) {
      case "A":
        return { text: row.label, editable: false };
      case "B":
        return { text: String(row.baseCost), editable: false };
      case "C":
        return { text: row.discount ? String(row.discount) : "", editable: false };
      case "D":
        return { text: row.taxed ? "=TRUE()" : "=FALSE()", editable: false };
      case "E":
        return { text: row.notes, editable: false };
      case "F":
        return { text: row.partyShare === null ? "" : String(row.partyShare), editable: false };
      case "G":
        return {
          text: `=${materializeTemplate(row.formula ?? DEFAULT_SUBTOTAL_TEMPLATE, excelRow)}`,
          editable: true
        };
      case "H":
        return { text: `=G${excelRow}*F${excelRow}`, editable: false };
    }
  };

  const current = barContent(selected);

  useEffect(() => {
    setBarDraft(current.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, rows]);

  const commitFormula = () => {
    if (!selected || selected.col !== "G" || !rows[selected.idx]) return;
    const row = rows[selected.idx];
    const text = barDraft.trim().replace(/^=/, "");
    if (!text) {
      onRowChange(row.id, { formula: null });
      return;
    }
    const template = normalizeToTemplate(text, selected.idx + 2);
    onRowChange(row.id, { formula: template === DEFAULT_SUBTOTAL_TEMPLATE ? null : template });
  };

  const select = (col: ColId, idx: number) => setSelected({ col, idx });

  const cellClass = (col: ColId, idx: number, extra = "") =>
    `cell ${extra}${selected?.col === col && selected.idx === idx ? " selected" : ""}`;

  return (
    <>
      <div className="formula-bar">
        <span className="cell-ref">
          {selected ? `${selected.col}${selected.idx + 2}` : "—"}
        </span>
        <span className="fx">fx</span>
        <input
          value={barDraft}
          readOnly={!current.editable}
          placeholder={selected ? "" : "Select a cell to inspect it — Subtotal formulas are editable"}
          onChange={(event) => setBarDraft(event.target.value)}
          onBlur={commitFormula}
          onKeyDown={(event) => {
            if (event.key === "Enter") (event.target as HTMLInputElement).blur();
            if (event.key === "Escape") {
              setBarDraft(current.text);
              (event.target as HTMLInputElement).blur();
            }
          }}
        />
        {selected?.col === "G" && rows[selected.idx]?.formula ? (
          <button
            className="ghost"
            title="Restore the default subtotal formula"
            onClick={() => onRowChange(rows[selected.idx].id, { formula: null })}
          >
            Reset
          </button>
        ) : null}
      </div>

      <div className="sheet-scroll">
        <table className="grid">
          <thead>
            <tr>
              <th className="row-num">#</th>
              <th>Item</th>
              <th style={{ width: 110 }}>Base Cost</th>
              <th style={{ width: 110 }}>Discount</th>
              <th style={{ width: 64 }}>Tax?</th>
              <th>Notes</th>
              <th style={{ width: 118 }}>
                <input
                  className="party-header-input"
                  value={partyName}
                  onChange={(event) => onPartyNameChange(event.target.value)}
                  onBlur={(event) => {
                    if (!event.target.value.trim()) onPartyNameChange("Party 1");
                  }}
                  title="Rename this party"
                />
              </th>
              <th style={{ width: 120 }}>Subtotal ea</th>
              <th style={{ width: 130 }}>{partyName} Owes</th>
              <th className="delete-cell" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={row.id}>
                <td className="row-num">{idx + 2}</td>
                <td className={cellClass("A", idx)} onClick={() => select("A", idx)}>
                  <CellInput
                    value={row.label}
                    placeholder="Item name"
                    onCommit={(text) => onRowChange(row.id, { label: text || "Untitled item" })}
                  />
                </td>
                <td className={cellClass("B", idx)} onClick={() => select("B", idx)}>
                  <div className="money-prefix">
                    <span className="prefix">$</span>
                    <CellInput
                      numeric
                      value={row.baseCost ? String(row.baseCost) : ""}
                      placeholder="0.00"
                      onCommit={(text) => onRowChange(row.id, { baseCost: parseNumber(text) })}
                    />
                  </div>
                </td>
                <td className={cellClass("C", idx)} onClick={() => select("C", idx)}>
                  <div className="money-prefix">
                    <span className="prefix">$</span>
                    <CellInput
                      numeric
                      value={row.discount ? String(row.discount) : ""}
                      placeholder="0.00"
                      onCommit={(text) => {
                        const parsed = parseNumber(text);
                        // Discounts are stored negative, matching the receipt.
                        onRowChange(row.id, { discount: parsed > 0 ? -parsed : parsed });
                      }}
                    />
                  </div>
                </td>
                <td
                  className={cellClass("D", idx, "check-cell ")}
                  onClick={() => select("D", idx)}
                >
                  <input
                    type="checkbox"
                    checked={row.taxed}
                    onChange={(event) => onRowChange(row.id, { taxed: event.target.checked })}
                  />
                </td>
                <td className={cellClass("E", idx)} onClick={() => select("E", idx)}>
                  <CellInput
                    value={row.notes}
                    placeholder=""
                    onCommit={(text) => onRowChange(row.id, { notes: text })}
                  />
                </td>
                <td
                  className={cellClass("F", idx, "party-cell ")}
                  onClick={() => select("F", idx)}
                >
                  <select
                    className={`party-select ${partyClass(row.partyShare)}`}
                    value={row.partyShare === null ? "" : String(row.partyShare)}
                    onChange={(event) => {
                      const value = event.target.value;
                      onRowChange(row.id, {
                        partyShare: value === "" ? null : Number(value)
                      });
                    }}
                  >
                    <option value="">—</option>
                    <option value="1">Yes</option>
                    <option value="0">No</option>
                    <option value="0.5">Split</option>
                  </select>
                </td>
                <td
                  className={cellClass("G", idx, `computed ${subtotals[idx] === null ? "error " : ""}`)}
                  onClick={() => select("G", idx)}
                  title="Click to view or edit this row's formula"
                >
                  {money(subtotals[idx])}
                </td>
                <td
                  className={cellClass("H", idx, `computed ${owes[idx] === null ? "error " : ""}`)}
                  onClick={() => select("H", idx)}
                >
                  {money(owes[idx])}
                </td>
                <td className="delete-cell">
                  <button
                    className="row-delete"
                    title="Delete row"
                    onClick={() => onDeleteRow(row.id)}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={7} className="totals-label">
                Totals
              </td>
              <td className="sum">{`$${sumSubtotal.toFixed(2)}`}</td>
              <td className="sum owes">{`$${sumOwes.toFixed(2)}`}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}
