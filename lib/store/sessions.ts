import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { ReceiptParse } from "../parse/types";
import { getDriver, isValidKey } from "./driver";

export type SessionRecord = {
  version: 1;
  id: string;
  receipt: ReceiptParse;
  editTokenHash: string;
  createdAt: string;
  updatedAt: string;
};

// What a viewer is allowed to see: everything except the token hash.
export type PublicSession = Omit<SessionRecord, "editTokenHash" | "version">;

const STORE_NAME = "receipt-sessions";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export const isValidSessionId = (id: string) => isValidKey(id);

/** Constant-time compare so a wrong token can't be recovered by timing. */
export const verifyEditToken = (token: string | null, record: SessionRecord) => {
  if (!token) return false;
  const provided = Buffer.from(hashToken(token), "hex");
  const expected = Buffer.from(record.editTokenHash, "hex");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
};

export const toPublicSession = (record: SessionRecord): PublicSession => ({
  id: record.id,
  receipt: record.receipt,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt
});

export const getSession = async (id: string): Promise<SessionRecord | null> => {
  if (!isValidSessionId(id)) return null;
  const driver = await getDriver(STORE_NAME);
  const entry = await driver.read<SessionRecord>(id);
  return entry?.value ?? null;
};

export const createSession = async (receipt: ReceiptParse) => {
  // The id is public and lives in the share URL; the token is the secret and
  // is only ever stored hashed.
  const id = randomBytes(9).toString("base64url");
  const editToken = randomBytes(32).toString("base64url");
  const now = new Date().toISOString();

  const record: SessionRecord = {
    version: 1,
    id,
    receipt,
    editTokenHash: hashToken(editToken),
    createdAt: now,
    updatedAt: now
  };

  const driver = await getDriver(STORE_NAME);
  await driver.write(id, record);
  return { id, editToken, record };
};

export const updateSession = async (record: SessionRecord, receipt: ReceiptParse) => {
  const updated: SessionRecord = {
    ...record,
    receipt,
    updatedAt: new Date().toISOString()
  };
  const driver = await getDriver(STORE_NAME);
  await driver.write(record.id, updated);
  return updated;
};

export const bearerToken = (req: Request) => {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7).trim() || null;
};
