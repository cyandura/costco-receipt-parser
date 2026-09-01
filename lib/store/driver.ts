import { createHash } from "node:crypto";

export type StoredEntry<T> = { value: T; etag?: string };

// `ifMatch` / `ifAbsent` give us compare-and-swap, which the quota counters
// need: a plain read-then-write lets two concurrent requests both read the
// same count and both write count+1, so one call escapes the limit.
export type WriteCondition =
  | { mode: "unconditional" }
  | { mode: "ifAbsent" }
  | { mode: "ifMatch"; etag: string };

export type StoreDriver = {
  kind: "netlify" | "filesystem";
  read: <T>(key: string) => Promise<StoredEntry<T> | null>;
  /** Resolves true when the write landed, false when the condition rejected it. */
  write: <T>(key: string, value: T, condition?: WriteCondition) => Promise<boolean>;
};

const KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export const isValidKey = (key: string) => KEY_PATTERN.test(key);

const hash = (raw: string) => createHash("sha256").update(raw).digest("hex");

const netlifyDriver = async (storeName: string): Promise<StoreDriver | null> => {
  try {
    const { getStore } = await import("@netlify/blobs");
    // Strong consistency: a stale read would let a viewer see an old receipt,
    // and would let a rate-limited caller slip past a spent quota.
    const store = getStore({ name: storeName, consistency: "strong" });

    return {
      kind: "netlify",
      read: async (key) => {
        const result = await store.getWithMetadata(key, { type: "json" });
        return result ? { value: result.data, etag: result.etag } : null;
      },
      write: async (key, value, condition = { mode: "unconditional" }) => {
        if (condition.mode === "ifAbsent") {
          return (await store.setJSON(key, value, { onlyIfNew: true })).modified;
        }
        if (condition.mode === "ifMatch") {
          return (await store.setJSON(key, value, { onlyIfMatch: condition.etag })).modified;
        }
        await store.setJSON(key, value);
        return true;
      }
    };
  } catch {
    // Blobs is unconfigured — running under plain `next dev` rather than
    // `netlify dev`. Fall through to the filesystem driver.
    return null;
  }
};

const filesystemDriver = async (storeName: string): Promise<StoreDriver> => {
  const { mkdir, readFile, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const dir = join(process.cwd(), ".local-store", storeName);

  const loadRaw = async (key: string) => {
    try {
      return await readFile(join(dir, `${key}.json`), "utf8");
    } catch {
      return null;
    }
  };

  return {
    kind: "filesystem",
    read: async (key) => {
      const raw = await loadRaw(key);
      return raw === null ? null : { value: JSON.parse(raw), etag: hash(raw) };
    },
    // Local-dev only, so the check and the write are not a single atomic
    // operation the way the Blobs conditional write is. Good enough for one
    // dev server; it is not what runs in production.
    write: async (key, value, condition = { mode: "unconditional" }) => {
      const raw = await loadRaw(key);
      if (condition.mode === "ifAbsent" && raw !== null) return false;
      if (condition.mode === "ifMatch" && (raw === null || hash(raw) !== condition.etag)) {
        return false;
      }
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${key}.json`), JSON.stringify(value, null, 2), "utf8");
      return true;
    }
  };
};

const drivers = new Map<string, Promise<StoreDriver>>();

export const getDriver = (storeName: string): Promise<StoreDriver> => {
  let driver = drivers.get(storeName);
  if (!driver) {
    driver = (async () => {
      const resolved = (await netlifyDriver(storeName)) ?? (await filesystemDriver(storeName));
      console.log(`[store:${storeName}] driver: ${resolved.kind}`);
      return resolved;
    })();
    drivers.set(storeName, driver);
  }
  return driver;
};
