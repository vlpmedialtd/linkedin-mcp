import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";

export const DEFAULT_API_VERSION = "202608";

export interface StoredToken {
  access_token: string;
  expires_at?: number;
  refresh_token?: string;
  refresh_token_expires_at?: number;
  scope?: string;
}

export function tokenFilePath(): string {
  return (
    process.env.LINKEDIN_TOKEN_FILE ||
    join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "linkedin-mcp", "token.json")
  );
}

export async function loadStoredToken(): Promise<StoredToken | undefined> {
  try {
    return JSON.parse(await readFile(tokenFilePath(), "utf8")) as StoredToken;
  } catch {
    return undefined;
  }
}

export async function saveStoredToken(token: StoredToken): Promise<string> {
  const file = tokenFilePath();
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, JSON.stringify(token, null, 2), { mode: 0o600 });
  await chmod(file, 0o600);
  return file;
}

export function httpTokenFilePath(): string {
  return join(dirname(tokenFilePath()), "http-token");
}

/**
 * Secret protecting the HTTP endpoint: MCP_AUTH_TOKEN, else a random token persisted next to
 * the LinkedIn token so the connector URL stays stable across restarts.
 */
export async function loadOrCreateHttpToken({ rotate = false } = {}): Promise<string> {
  const fromEnv = process.env.MCP_AUTH_TOKEN?.trim();
  if (fromEnv) return fromEnv;

  const file = httpTokenFilePath();
  if (!rotate) {
    try {
      const existing = (await readFile(file, "utf8")).trim();
      if (existing) return existing;
    } catch {
      // create below
    }
  }
  const token = randomBytes(24).toString("base64url");
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, token, { mode: 0o600 });
  await chmod(file, 0o600);
  return token;
}

/** Resolves the access token: env var first, then the token file written by `linkedin-mcp auth`. */
export async function resolveAccessToken(): Promise<string> {
  const fromEnv = process.env.LINKEDIN_ACCESS_TOKEN?.trim();
  if (fromEnv) return fromEnv;

  const stored = await loadStoredToken();
  if (!stored?.access_token) {
    throw new Error(
      "No LinkedIn access token found. Set LINKEDIN_ACCESS_TOKEN or run `npx linkedin-mcp auth` once.",
    );
  }
  if (stored.expires_at && stored.expires_at < Date.now()) {
    throw new Error(
      `The stored LinkedIn access token expired on ${new Date(stored.expires_at).toISOString()}. Run \`npx linkedin-mcp auth\` again.`,
    );
  }
  return stored.access_token;
}
