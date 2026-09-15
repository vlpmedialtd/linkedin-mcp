import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { saveStoredToken, type StoredToken } from "./config.js";

const AUTHORIZE_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";

/** Reads a value from the environment or asks for it interactively (hidden input for secrets). */
async function required(name: string, label: string, hidden = false): Promise<string> {
  const fromEnv = process.env[name]?.trim();
  if (fromEnv) return fromEnv;
  if (!process.stdin.isTTY) {
    console.error(`Missing environment variable ${name}. See README.md → "Create a LinkedIn app".`);
    process.exit(1);
  }

  // Echo goes through this stream so it can be muted after the prompt is shown.
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stderr.write(chunk);
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  rl.on("SIGINT", () => {
    process.stderr.write("\n");
    process.exit(130);
  });
  const pending = rl.question(`${label}: `);
  muted = hidden;
  const answer = await pending;
  rl.close();
  if (hidden) process.stderr.write("\n");

  // Strip bracketed-paste markers and other control characters some terminals add when pasting.
  const value = answer
    .replace(/\x1b\[20[01]~/g, "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim();
  if (!value) {
    console.error(`${label} must not be empty.`);
    process.exit(1);
  }
  if (hidden) console.error(`  (received ${value.length} characters)`);
  return value;
}

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {
    // user can open the printed URL manually
  }
}

/** Interactive OAuth 2.0 authorization-code flow. Stores the token for the MCP server. */
export async function runAuthFlow(): Promise<void> {
  const clientId = await required("LINKEDIN_CLIENT_ID", "LinkedIn Client ID");
  const clientSecret = await required("LINKEDIN_CLIENT_SECRET", "LinkedIn Client Secret (hidden)", true);
  const redirectUri = process.env.LINKEDIN_REDIRECT_URI || "http://localhost:8787/callback";
  const scopes = process.env.LINKEDIN_SCOPES || "openid profile email w_member_social";
  const redirect = new URL(redirectUri);
  if (!["localhost", "127.0.0.1"].includes(redirect.hostname)) {
    console.error("LINKEDIN_REDIRECT_URI must point to localhost for the interactive auth flow.");
    process.exit(1);
  }
  const state = randomBytes(16).toString("hex");

  const authUrl = new URL(AUTHORIZE_URL);
  authUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: scopes,
  }).toString();

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", redirectUri);
      if (url.pathname !== redirect.pathname) {
        res.writeHead(404).end();
        return;
      }
      const finish = (status: number, message: string) => {
        res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!doctype html><title>linkedin-mcp</title><body style="font-family:system-ui;padding:2rem"><h1>${message}</h1><p>You can close this window.</p>`);
        server.close();
      };
      const error = url.searchParams.get("error");
      if (error) {
        finish(400, "Authorization failed");
        reject(new Error(`${error}: ${url.searchParams.get("error_description") ?? ""}`));
      } else if (url.searchParams.get("state") !== state) {
        finish(400, "State mismatch");
        reject(new Error("OAuth state mismatch, aborting."));
      } else {
        finish(200, "linkedin-mcp is authorized ✔");
        resolve(url.searchParams.get("code") ?? "");
      }
    });
    server.on("error", reject);
    server.listen(Number(redirect.port || 80), redirect.hostname, () => {
      console.error(`Open this URL to authorize linkedin-mcp:\n\n  ${authUrl}\n`);
      openBrowser(authUrl.toString());
    });
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const data = (await res.json()) as Record<string, any>;
  if (!res.ok || !data.access_token) {
    const hint =
      data.error === "invalid_client"
        ? "\nHint: the Client Secret does not match this Client ID. Copy the \"Primary Client Secret\" from the Auth tab of your app (or generate a new one) and try again."
        : "";
    throw new Error(`Token exchange failed (${res.status}): ${JSON.stringify(data)}${hint}`);
  }

  const now = Date.now();
  const token: StoredToken = {
    access_token: data.access_token,
    expires_at: data.expires_in ? now + data.expires_in * 1000 : undefined,
    refresh_token: data.refresh_token,
    refresh_token_expires_at: data.refresh_token_expires_in ? now + data.refresh_token_expires_in * 1000 : undefined,
    scope: data.scope,
  };
  const file = await saveStoredToken(token);
  console.error(`✔ Token saved to ${file}`);
  if (token.expires_at) console.error(`  Expires: ${new Date(token.expires_at).toISOString()}`);
  if (token.scope) console.error(`  Scopes:  ${token.scope}`);
}
