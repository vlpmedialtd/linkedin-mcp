import { test, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LinkedInClient } from "../linkedin.js";
import { startHttpServer } from "../http.js";

const SECRET = "s3cret-token";

const linkedin = new LinkedInClient({
  getAccessToken: async () => "test-token",
  fetch: (async () => Response.json({ sub: "abc123", name: "Ada Lovelace" })) as typeof fetch,
});
const running = await startHttpServer(linkedin, { port: 0, host: "127.0.0.1", authToken: SECRET });
const clients: Client[] = [];

after(async () => {
  await Promise.all(clients.map((c) => c.close()));
  await running.close();
});

async function connect(url: string, headers?: Record<string, string>) {
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }));
  clients.push(client);
  return client;
}

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "curl", version: "0" } },
};

async function post(path: string, headers: Record<string, string> = {}) {
  return fetch(`${running.url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify(initialize),
  });
}

test("health endpoint is public", async () => {
  const res = await fetch(`${running.url}/health`);
  assert.equal(res.status, 200);
});

test("rejects requests without or with a wrong token", async () => {
  assert.equal((await post("/mcp")).status, 401);
  assert.equal((await post("/mcp/wrong")).status, 401);
  assert.equal((await post("/mcp", { Authorization: "Bearer wrong" })).status, 401);
  assert.equal((await post("/other")).status, 404);
});

test("secret URL path works (ChatGPT style)", async () => {
  const client = await connect(`${running.url}/mcp/${SECRET}`);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 9);
  const result: any = await client.callTool({ name: "linkedin_get_profile", arguments: {} });
  assert.equal(JSON.parse(result.content[0].text).urn, "urn:li:person:abc123");
});

test("bearer header works", async () => {
  const client = await connect(`${running.url}/mcp`, { Authorization: `Bearer ${SECRET}` });
  const { tools } = await client.listTools();
  assert.ok(tools.some((t) => t.name === "linkedin_create_post"));
});
