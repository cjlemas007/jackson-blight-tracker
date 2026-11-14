import "server-only";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Photo storage. Keys starting "originals/" are private (never served publicly); keys starting
 * "processed/" are the EXIF-stripped, blurred copies. Local disk in development; Supabase
 * Storage when SUPABASE_URL is set (two buckets: photos-private, photos-public).
 */
export interface UploadTarget {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
}

export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  exists(key: string): Promise<boolean>;
  /** Where the browser should upload a file directly (keeps big photos out of function payloads). */
  uploadTarget(key: string, contentType: string): Promise<UploadTarget>;
}

export function isPrivateKey(key: string) {
  return key.startsWith("originals/") || key.startsWith("docs/private/");
}

function assertSafeKey(key: string) {
  const photo = /^(originals|processed)\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/;
  const doc = /^docs\/(public|private)\/[0-9a-f-]{36}\.(pdf|csv|jpg|png)$/;
  if (!photo.test(key) && !doc.test(key)) throw new Error(`unsafe storage key: ${key}`);
}

class LocalStorage implements Storage {
  constructor(private root: string) {}
  private file(key: string) {
    assertSafeKey(key);
    return path.join(this.root, key);
  }
  async put(key: string, body: Buffer) {
    const f = this.file(key);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, body);
  }
  async get(key: string) {
    try {
      return await readFile(this.file(key));
    } catch {
      return null;
    }
  }
  async exists(key: string) {
    try {
      return (await stat(this.file(key))).isFile();
    } catch {
      return false;
    }
  }
  async uploadTarget(key: string, contentType: string): Promise<UploadTarget> {
    assertSafeKey(key);
    // Dev upload route checks the session and that this key belongs to the caller's draft.
    return { url: `/api/uploads/${key}`, method: "PUT", headers: { "Content-Type": contentType } };
  }
}

/** Supabase Storage over its REST API. Not exercised until a Supabase project exists. */
class SupabaseStorage implements Storage {
  constructor(
    private baseUrl: string,
    private serviceKey: string,
  ) {}
  private loc(key: string) {
    assertSafeKey(key);
    return { bucket: isPrivateKey(key) ? "photos-private" : "photos-public", key };
  }
  private auth() {
    return { Authorization: `Bearer ${this.serviceKey}`, apikey: this.serviceKey };
  }
  async put(key: string, body: Buffer, contentType: string) {
    const { bucket } = this.loc(key);
    const res = await fetch(`${this.baseUrl}/storage/v1/object/${bucket}/${key}`, {
      method: "POST",
      headers: { ...this.auth(), "Content-Type": contentType, "x-upsert": "true" },
      body: new Uint8Array(body),
    });
    if (!res.ok) throw new Error(`storage put ${res.status}: ${await res.text()}`);
  }
  async get(key: string) {
    const { bucket } = this.loc(key);
    const res = await fetch(`${this.baseUrl}/storage/v1/object/${bucket}/${key}`, { headers: this.auth() });
    if (res.status === 400 || res.status === 404) return null;
    if (!res.ok) throw new Error(`storage get ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  async exists(key: string) {
    return (await this.get(key)) !== null;
  }
  async uploadTarget(key: string, contentType: string): Promise<UploadTarget> {
    const { bucket } = this.loc(key);
    const res = await fetch(`${this.baseUrl}/storage/v1/object/upload/sign/${bucket}/${key}`, {
      method: "POST",
      headers: this.auth(),
    });
    if (!res.ok) throw new Error(`signed upload url ${res.status}: ${await res.text()}`);
    const { url } = (await res.json()) as { url: string };
    return { url: `${this.baseUrl}/storage/v1${url}`, method: "PUT", headers: { "Content-Type": contentType } };
  }
}

let instance: Storage | null = null;
export function storage(): Storage {
  if (!instance) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    instance = url && key ? new SupabaseStorage(url, key) : new LocalStorage(path.resolve(/*turbopackIgnore: true*/ process.env.LOCAL_STORAGE_DIR ?? "storage")) // dev only;
  }
  return instance;
}

/** Test hook. */
export function setStorage(s: Storage | null) {
  instance = s;
}
