#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveAccessToken } from "./config.js";
import { LinkedInClient } from "./linkedin.js";
import { createServer, VERSION } from "./server.js";
import { runAuthFlow } from "./auth.js";

const HELP = `linkedin-mcp ${VERSION} — MCP server for the official LinkedIn API

Usage:
  linkedin-mcp          Start the MCP server on stdio
  linkedin-mcp auth     Run the OAuth flow and store an access token
  linkedin-mcp --help   Show this help

Environment:
  LINKEDIN_ACCESS_TOKEN   Access token (alternative to \`auth\`)
  LINKEDIN_CLIENT_ID      App client id (for \`auth\`)
  LINKEDIN_CLIENT_SECRET  App client secret (for \`auth\`)
  LINKEDIN_REDIRECT_URI   Default http://localhost:8787/callback
  LINKEDIN_SCOPES         Default "openid profile email w_member_social"
  LINKEDIN_API_VERSION    LinkedIn-Version header (YYYYMM)
  LINKEDIN_TOKEN_FILE     Default ~/.config/linkedin-mcp/token.json
`;

async function main(): Promise<void> {
  const command = process.argv[2];
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

  const client = new LinkedInClient({
    getAccessToken: resolveAccessToken,
    apiVersion: process.env.LINKEDIN_API_VERSION,
  });
  const server = createServer(client);
  await server.connect(new StdioServerTransport());
  console.error(`linkedin-mcp ${VERSION} running on stdio`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
