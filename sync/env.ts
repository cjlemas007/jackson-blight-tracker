import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Minimal .env.local / .env loader for CLI scripts (Next.js loads these itself). */
export function loadEnv(cwd = process.cwd()): void {
  for (const name of [".env.local", ".env"]) {
    const file = path.join(cwd, name);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

/**
 * A GOOGLE_APPLICATION_CREDENTIALS that points at a missing file makes every Google client
 * fail, even when `gcloud auth application-default login` credentials exist. Drop it.
 */
export function sanitizeGoogleCredentials(): void {
  const f = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (f && !existsSync(f)) {
    console.warn(`GOOGLE_APPLICATION_CREDENTIALS points at a missing file (${f}); using application default credentials instead`);
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }
}
