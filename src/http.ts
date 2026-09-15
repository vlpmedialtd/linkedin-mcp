import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { LinkedInClient } from "./linkedin.js";
import { createServer } from "./server.js";

export interface HttpServerOptions {
  port: number;
  host: string;
  /** Secret required as `/mcp/<token>` path segment or `Authorization: Bearer <token>` header. */
  authToken: string;
}

export interface RunningHttpServer {
  /** Base URL, e.g. http://127.0.0.1:3000 */
  url: string;
  close: () => Promise<void>;
}

function sameSecret(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function isAuthorized(req: IncomingMessage, pathname: string, secret: string): boolean {
  const candidates: string[] = [];
  const header = req.headers.authorization;
  if (header?.toLowerCase().startsWith("bearer ")) candidates.push(header.slice(7).trim());
  const fromPath = pathname.match(/^\/mcp\/([^/]+)\/?$/);
  if (fromPath) candidates.push(decodeURIComponent(fromPath[1]));
  return candidates.some((candidate) => sameSecret(candidate, secret));
}

/**
 * Serves the MCP server over Streamable HTTP (stateless), e.g. for ChatGPT developer-mode apps.
 * Endpoints: `GET /health`, `/mcp/<token>` and `/mcp` (with bearer token).
 */
export async function startHttpServer(client: LinkedInClient, options: HttpServerOptions): Promise<RunningHttpServer> {
  const http = createHttpServer(async (req, res) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");

    if (pathname === "/health") return sendJson(res, 200, { status: "ok" });
    if (pathname !== "/mcp" && !pathname.startsWith("/mcp/")) return sendJson(res, 404, { error: "not_found" });
    if (!isAuthorized(req, pathname, options.authToken)) return sendJson(res, 401, { error: "unauthorized" });

    try {
      const server = createServer(client);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      // Never log req.url: it contains the secret.
      console.error("MCP request failed:", err instanceof Error ? err.message : err);
      if (!res.headersSent) sendJson(res, 500, { error: "internal_error" });
    }
  });

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(options.port, options.host, () => resolve());
  });

  const { port } = http.address() as AddressInfo;
  const host = options.host === "0.0.0.0" || options.host === "::" ? "localhost" : options.host;
  return {
    url: `http://${host}:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        http.closeAllConnections();
        http.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
