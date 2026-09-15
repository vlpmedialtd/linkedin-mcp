#!/usr/bin/env node
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadOrCreateHttpToken, resolveAccessToken } from "./config.js";
import { LinkedInClient } from "./linkedin.js";
import { createServer, VERSION } from "./server.js";
import { runAuthFlow } from "./auth.js";
import { startHttpServer } from "./http.js";

const HELP = `linkedin-mcp ${VERSION} — MCP server for the official LinkedIn API

Usage:
  linkedin-mcp                 Start the MCP server on stdio (Claude Code, Claude Desktop, Cursor, …)
  linkedin-mcp auth            Sign in with LinkedIn and store an access token
  linkedin-mcp http [options]  Start a Streamable HTTP server (ChatGPT, remote clients)
      --port <port>            Default 3000 (or $PORT)
      --host <host>            Default 127.0.0.1 (or $HOST); use 0.0.0.0 in containers
      --new-token              Generate a new secret (invalidates the old connector URL)
  linkedin-mcp --help          Show this help

Environment:
  LINKEDIN_ACCESS_TOKEN   Access token (alternative to \`auth\`)
  LINKEDIN_CLIENT_ID      App client id (for \`auth\`, otherwise prompted)
  LINKEDIN_CLIENT_SECRET  App client secret (for \`auth\`, otherwise prompted)
  LINKEDIN_REDIRECT_URI   Default http://localhost:8787/callback
  LINKEDIN_SCOPES         Default "openid profile email w_member_social"
  LINKEDIN_API_VERSION    LinkedIn-Version header (YYYYMM)
  LINKEDIN_TOKEN_FILE     Default ~/.config/linkedin-mcp/token.json
  MCP_AUTH_TOKEN          Secret for the HTTP endpoint (default: generated and stored)
`;

function createClient(): LinkedInClient {
  return new LinkedInClient({
    getAccessToken: resolveAccessToken,
    apiVersion: process.env.LINKEDIN_API_VERSION,
  });
}

async function runHttp(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      port: { type: "string" },
      host: { type: "string" },
      "new-token": { type: "boolean", default: false },
    },
  });
  const port = Number(values.port ?? process.env.PORT ?? 3000);
  const host = values.host ?? process.env.HOST ?? "127.0.0.1";
  const authToken = await loadOrCreateHttpToken({ rotate: values["new-token"] });

  const running = await startHttpServer(createClient(), { port, host, authToken });
  console.error(`linkedin-mcp ${VERSION} HTTP server running on ${running.url}

  MCP endpoint (keep this URL secret — it allows posting as you):
    ${running.url}/mcp/${authToken}

  ChatGPT needs a public HTTPS URL. In a second terminal run for example:
    cloudflared tunnel --url http://localhost:${port}
  and use  https://<your-tunnel-host>/mcp/${authToken}  as the app's MCP server URL.
`);

  const shutdown = () => void running.close().finally(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(HELP);
    return;
  }
  if (command === "--version" || command === "-v") {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (command === "auth") {
    await runAuthFlow();
    return;
  }
  if (command === "http") {
    await runHttp(rest);
    return;
  }

  const server = createServer(createClient());
  await server.connect(new StdioServerTransport());
  console.error(`linkedin-mcp ${VERSION} running on stdio`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
