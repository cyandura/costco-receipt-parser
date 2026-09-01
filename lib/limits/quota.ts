import { createHash } from "node:crypto";
import { getDriver } from "../store/driver";

const STORE_NAME = "receipt-quota";
const MAX_CAS_ATTEMPTS = 5;

type Counter = { day: string; count: number };

const parseLimit = (raw: string | undefined, fallback: number) => {
  const value = raw?.trim();
  if (!value) return fallback;
  if (value.toLowerCase() === "off") return Number.POSITIVE_INFINITY;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

/** Parses one visitor may run per UTC day. `PARSE_LIMIT_PER_IP=off` disables. */
export const perIpDailyLimit = () => parseLimit(process.env.PARSE_LIMIT_PER_IP, 2);

/**
 * Hard ceiling on parses across all visitors per UTC day — the limit that
 * actually bounds the API bill, since a determined caller can rotate IPs.
 */
export const globalDailyLimit = () => parseLimit(process.env.PARSE_LIMIT_GLOBAL, 50);

const utcDay = (now: Date) => now.toISOString().slice(0, 10);

const secondsUntilUtcMidnight = (now: Date) => {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((midnight - now.getTime()) / 1000));
};

/**
 * Netlify's edge sets `x-nf-client-connection-ip` and a client cannot forge it.
 * `x-forwarded-for` is a local-dev fallback only — it is caller-supplied and
 * must never be trusted on its own in production.
 */
export const clientIp = (req: Request) => {
  const direct = req.headers.get("x-nf-client-connection-ip")?.trim();
  if (direct) return direct;
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown";
};

// Hashed so raw visitor IPs are never written to storage.
const ipKey = (ip: string) => `ip-${createHash("sha256").update(ip).digest("hex").slice(0, 32)}`;

const readCount = async (key: string, day: string) => {
  const driver = await getDriver(STORE_NAME);
  const entry = await driver.read<Counter>(key);
  return !entry || entry.value.day !== day ? 0 : entry.value.count;
};

type ConsumeResult =
  | { ok: true; remaining: number }
  | { ok: false; reason: "limit" | "contention" };

/**
 * Increments a daily counter under compare-and-swap. Concurrent callers that
 * lose the swap retry against fresh state, so the limit can never be exceeded
 * by interleaving.
 */
const consume = async (key: string, limit: number, day: string): Promise<ConsumeResult> => {
  if (limit === Number.POSITIVE_INFINITY) return { ok: true, remaining: Number.POSITIVE_INFINITY };

  const driver = await getDriver(STORE_NAME);

  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const entry = await driver.read<Counter>(key);
    const current = !entry || entry.value.day !== day ? 0 : entry.value.count;
    if (current >= limit) return { ok: false, reason: "limit" };

    const next: Counter = { day, count: current + 1 };
    const condition = !entry
      ? ({ mode: "ifAbsent" } as const)
      : entry.etag
        ? ({ mode: "ifMatch", etag: entry.etag } as const)
        : ({ mode: "unconditional" } as const);

    if (await driver.write(key, next, condition)) {
      return { ok: true, remaining: limit - next.count };
    }
  }

  // Never fall through to the paid call when we could not settle the count.
  return { ok: false, reason: "contention" };
};

export type QuotaVerdict =
  | { allowed: true; remaining: number; limit: number }
  | { allowed: false; message: string; retryAfterSeconds: number };

export const consumeParseQuota = async (req: Request): Promise<QuotaVerdict> => {
  const now = new Date();
  const day = utcDay(now);
  const retryAfterSeconds = secondsUntilUtcMidnight(now);

  const perIp = perIpDailyLimit();
  const global = globalDailyLimit();

  // Check the shared ceiling before spending one of this visitor's parses, so
  // a globally-capped day doesn't also burn their personal allowance.
  if (global !== Number.POSITIVE_INFINITY && (await readCount("global", day)) >= global) {
    return {
      allowed: false,
      message: "This site has reached its shared daily limit for receipt parsing. Please try again tomorrow.",
      retryAfterSeconds
    };
  }

  const ip = await consume(ipKey(clientIp(req)), perIp, day);
  if (!ip.ok) {
    return {
      allowed: false,
      message:
        ip.reason === "limit"
          ? `You've used your ${perIp} receipt ${perIp === 1 ? "parse" : "parses"} for today. The limit resets at midnight UTC.`
          : "Too many requests at once. Please try again in a moment.",
      retryAfterSeconds: ip.reason === "limit" ? retryAfterSeconds : 5
    };
  }

  const shared = await consume("global", global, day);
  if (!shared.ok) {
    return {
      allowed: false,
      message:
        shared.reason === "limit"
          ? "This site has reached its shared daily limit for receipt parsing. Please try again tomorrow."
          : "Too many requests at once. Please try again in a moment.",
      retryAfterSeconds: shared.reason === "limit" ? retryAfterSeconds : 5
    };
  }

  return { allowed: true, remaining: ip.remaining, limit: perIp };
};
