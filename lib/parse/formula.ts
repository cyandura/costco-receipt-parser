// Minimal spreadsheet formula engine shared by the editable grid (client) and
// normalization/export (server). Supports numbers, cell refs (B2), ranges in
// SUM/MIN/MAX, arithmetic, comparisons, and IF/AND/OR/NOT/TRUE/FALSE/ROUND/ABS.
//
// Row formulas are stored as templates where "@" stands for the row's own
// row number (e.g. "IF(D@, (B@+C@) * 1.06, B@+C@)") so rows can be added,
// removed, or reordered without breaking same-row references.

export type CellScalar = number | boolean;
export type CellResolver = (col: string, row: number) => CellScalar;

export const DEFAULT_SUBTOTAL_TEMPLATE = "IF(D@, (B@+C@) * 1.06, B@+C@)";

export const materializeTemplate = (template: string, row: number) =>
  template.replace(/@/g, String(row));

export const normalizeToTemplate = (formula: string, ownRow: number) =>
  formula.replace(new RegExp(`([A-Za-z])${ownRow}(?![0-9])`, "g"), (_m, col: string) => `${col.toUpperCase()}@`);

type Token =
  | { type: "num"; value: number }
  | { type: "ident"; value: string }
  | { type: "op"; value: string };

const OPS = ["<=", ">=", "<>", "=", "<", ">", "+", "-", "*", "/", "(", ")", ",", ":"];

const tokenize = (input: string): Token[] => {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const match = input.slice(i).match(/^[0-9]*\.?[0-9]+/);
      if (!match) throw new Error(`Bad number at position ${i}`);
      tokens.push({ type: "num", value: Number(match[0]) });
      i += match[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const match = input.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
      if (!match) throw new Error(`Bad identifier at position ${i}`);
      tokens.push({ type: "ident", value: match[0] });
      i += match[0].length;
      continue;
    }
    const op = OPS.find((candidate) => input.startsWith(candidate, i));
    if (!op) throw new Error(`Unexpected character "${ch}" in formula`);
    tokens.push({ type: "op", value: op });
    i += op.length;
  }
  return tokens;
};

type Range = { col: string; from: number; to: number };
type Value = CellScalar | Range;

const isRange = (value: Value): value is Range => typeof value === "object";

const toNumber = (value: Value): number => {
  if (isRange(value)) throw new Error("Range used where a single value was expected");
  return typeof value === "boolean" ? (value ? 1 : 0) : value;
};

const toBool = (value: Value): boolean => {
  if (isRange(value)) throw new Error("Range used where a single value was expected");
  return typeof value === "boolean" ? value : value !== 0;
};

const REF_PATTERN = /^([A-Za-z]{1,2})([0-9]+)$/;

class Evaluator {
  private tokens: Token[];
  private pos = 0;
  private resolver: CellResolver;

  constructor(formula: string, resolver: CellResolver) {
    this.resolver = resolver;
    this.tokens = tokenize(formula.replace(/^=/, ""));
  }

  run(): number {
    const value = this.comparison();
    if (this.pos !== this.tokens.length) throw new Error("Unexpected trailing input in formula");
    return toNumber(value);
  }

  private peek() {
    return this.tokens[this.pos];
  }

  private takeOp(...values: string[]) {
    const token = this.peek();
    if (token?.type === "op" && values.includes(token.value)) {
      this.pos += 1;
      return token.value;
    }
    return null;
  }

  private expectOp(value: string) {
    if (!this.takeOp(value)) throw new Error(`Expected "${value}" in formula`);
  }

  private comparison(): Value {
    const left = this.additive();
    const op = this.takeOp("=", "<>", "<=", ">=", "<", ">");
    if (!op) return left;
    const right = this.additive();
    const a = toNumber(left);
    const b = toNumber(right);
    switch (op) {
      case "=":
        return a === b;
      case "<>":
        return a !== b;
      case "<":
        return a < b;
      case ">":
        return a > b;
      case "<=":
        return a <= b;
      default:
        return a >= b;
    }
  }

  private additive(): Value {
    let value = this.multiplicative();
    let op = this.takeOp("+", "-");
    while (op) {
      const right = this.multiplicative();
      value = op === "+" ? toNumber(value) + toNumber(right) : toNumber(value) - toNumber(right);
      op = this.takeOp("+", "-");
    }
    return value;
  }

  private multiplicative(): Value {
    let value = this.unary();
    let op = this.takeOp("*", "/");
    while (op) {
      const right = this.unary();
      value = op === "*" ? toNumber(value) * toNumber(right) : toNumber(value) / toNumber(right);
      op = this.takeOp("*", "/");
    }
    return value;
  }

  private unary(): Value {
    if (this.takeOp("-")) return -toNumber(this.unary());
    if (this.takeOp("+")) return toNumber(this.unary());
    return this.primary();
  }

  private primary(): Value {
    const token = this.peek();
    if (!token) throw new Error("Formula ended unexpectedly");

    if (token.type === "num") {
      this.pos += 1;
      return token.value;
    }

    if (token.type === "op" && token.value === "(") {
      this.pos += 1;
      const value = this.comparison();
      this.expectOp(")");
      return value;
    }

    if (token.type === "ident") {
      this.pos += 1;
      const refMatch = token.value.match(REF_PATTERN);
      const next = this.peek();

      if (next?.type === "op" && next.value === "(") {
        return this.call(token.value.toUpperCase());
      }

      if (refMatch) {
        const col = refMatch[1].toUpperCase();
        const row = Number(refMatch[2]);
        if (this.takeOp(":")) {
          const endToken = this.peek();
          if (endToken?.type !== "ident") throw new Error("Expected cell reference after \":\"");
          const endMatch = endToken.value.match(REF_PATTERN);
          if (!endMatch || endMatch[1].toUpperCase() !== col) {
            throw new Error("Ranges must stay within a single column");
          }
          this.pos += 1;
          return { col, from: row, to: Number(endMatch[2]) };
        }
        return this.resolver(col, row);
      }

      throw new Error(`Unknown identifier "${token.value}"`);
    }

    throw new Error("Unexpected token in formula");
  }

  private call(name: string): Value {
    this.expectOp("(");
    const args: Value[] = [];
    if (!this.takeOp(")")) {
      args.push(this.comparison());
      while (this.takeOp(",")) args.push(this.comparison());
      this.expectOp(")");
    }

    const flat = (): number[] =>
      args.flatMap((arg) => {
        if (!isRange(arg)) return [toNumber(arg)];
        const lo = Math.min(arg.from, arg.to);
        const hi = Math.max(arg.from, arg.to);
        const out: number[] = [];
        for (let row = lo; row <= hi; row += 1) {
          out.push(toNumber(this.resolver(arg.col, row)));
        }
        return out;
      });

    switch (name) {
      case "TRUE":
        return true;
      case "FALSE":
        return false;
      case "IF":
        if (args.length < 2 || args.length > 3) throw new Error("IF takes 2 or 3 arguments");
        return toBool(args[0]) ? args[1] : (args[2] ?? 0);
      case "NOT":
        return !toBool(args[0]);
      case "AND":
        return args.every(toBool);
      case "OR":
        return args.some(toBool);
      case "SUM":
        return flat().reduce((sum, v) => sum + v, 0);
      case "MIN":
        return Math.min(...flat());
      case "MAX":
        return Math.max(...flat());
      case "ABS":
        return Math.abs(toNumber(args[0]));
      case "ROUND": {
        const digits = args.length > 1 ? toNumber(args[1]) : 0;
        const factor = 10 ** digits;
        return Math.round(toNumber(args[0]) * factor) / factor;
      }
      default:
        throw new Error(`Unsupported function "${name}"`);
    }
  }
}

export const evaluateFormula = (formula: string, resolver: CellResolver): number =>
  new Evaluator(formula, resolver).run();

export type SubtotalRow = {
  baseCost: number;
  discount: number;
  taxed: boolean;
  partyShare?: number | null;
  formula?: string | null;
};

// Evaluates every row's subtotal formula against the sheet. Returns null for
// rows whose formula fails (bad syntax, circular reference, out-of-range ref).
export const computeSubtotals = (rows: SubtotalRow[]): (number | null)[] => {
  const memo = new Map<number, number | null>();
  const visiting = new Set<number>();

  const resolver: CellResolver = (col, row) => {
    const idx = row - 2;
    if (idx < 0 || idx >= rows.length) throw new Error(`Reference ${col}${row} is outside the table`);
    const r = rows[idx];
    switch (col) {
      case "B":
        return r.baseCost || 0;
      case "C":
        return r.discount || 0;
      case "D":
        return Boolean(r.taxed);
      case "F":
        return r.partyShare ?? 0;
      case "G": {
        const value = getSubtotal(idx);
        if (value === null) throw new Error(`G${row} has a formula error`);
        return value;
      }
      case "H": {
        const value = getSubtotal(idx);
        return (value ?? 0) * (r.partyShare ?? 0);
      }
      default:
        throw new Error(`Column ${col} cannot be referenced in formulas`);
    }
  };

  const getSubtotal = (idx: number): number | null => {
    if (memo.has(idx)) return memo.get(idx)!;
    if (visiting.has(idx)) {
      memo.set(idx, null);
      return null;
    }
    visiting.add(idx);
    let result: number | null;
    try {
      const template = rows[idx].formula || DEFAULT_SUBTOTAL_TEMPLATE;
      result = evaluateFormula(materializeTemplate(template, idx + 2), resolver);
      if (!Number.isFinite(result)) result = null;
    } catch {
      result = null;
    }
    visiting.delete(idx);
    memo.set(idx, result);
    return result;
  };

  return rows.map((_, idx) => getSubtotal(idx));
};
