import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { ReceiptParse } from "../parse/types";

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
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

type Driver = {
  kind: "netlify" | "filesystem";
  read: (id: string) => Promise<SessionRecord | null>;
  write: (id: string, record: SessionRecord) => Promise<void>;
};

const netlifyDriver = async (): Promise<Driver | null> => {
  try {
    const { getStore } = await import("@netlify/blobs");
    // Strong consistency: a viewer opening the link seconds after the creator
    // saves must not get a stale copy.
    const store = getStore({ name: STORE_NAME, consistency: "strong" });
    return {
      kind: "netlify",
      read: (id) => store.get(id, { type: "json" }) as Promise<SessionRecord | null>,
      write: async (id, record) => {
        await store.setJSON(id, record);
      }
    };
  } catch {
    // Blobs is unconfigured — running under plain `next dev` rather than
    // `netlify dev`. Fall through to the filesystem driver.
    return null;
  }
};

const filesystemDriver = async (): Promise<Driver> => {
  const { mkdir, readFile, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const dir = join(process.cwd(), ".sessions");

  return {
    kind: "filesystem",
    read: async (id) => {
      try {
        return JSON.parse(await readFile(join(dir, `${id}.json`), "utf8")) as SessionRecord;
      } catch {
        return null;
      }
    },
    write: async (id, record) => {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${id}.json`), JSON.stringify(record, null, 2), "utf8");
    }
  };
};

let driverPromise: Promise<Driver> | null = null;

const getDriver = (): Promise<Driver> => {
  if (!driverPromise) {
    driverPromise = (async () => {
      const driver = (await netlifyDriver()) ?? (await filesystemDriver());
      console.log(`[sessions] storage driver: ${driver.kind}`);
      return driver;
    })();
  }
  return driverPromise;
};

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export const isValidSessionId = (id: string) => ID_PATTERN.test(id);

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
  const driver = await getDriver();
  return driver.read(id);
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

  const driver = await getDriver();
  await driver.write(id, record);
  return { id, editToken, record };
};

export const updateSession = async (record: SessionRecord, receipt: ReceiptParse) => {
  const updated: SessionRecord = {
    ...record,
    receipt,
    updatedAt: new Date().toISOString()
  };
  const driver = await getDriver();
  await driver.write(record.id, updated);
  return updated;
};

export const bearerToken = (req: Request) => {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7).trim() || null;
};
