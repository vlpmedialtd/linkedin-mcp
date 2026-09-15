import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { LinkedInClient } from "../linkedin.js";
import { createServer } from "../server.js";

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };

function mockFetch(calls: Call[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    if (url.endsWith("/v2/userinfo")) {
      return Response.json({ sub: "abc123", name: "Ada Lovelace", email: "ada@example.com" });
    }
    if (url.endsWith("/rest/posts") && init?.method === "POST") {
      return new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:999" } });
    }
    if (url.includes("/rest/posts/") && init?.method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    return Response.json({ message: "Not enough permissions" }, { status: 403 });
  }) as typeof fetch;
}

async function connect(calls: Call[]) {
  const linkedin = new LinkedInClient({ getAccessToken: async () => "test-token", fetch: mockFetch(calls) });
  const server = createServer(linkedin);
  const client = new Client({ name: "test", version: "0.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const text = (result: any) => result.content[0].text as string;

test("lists all tools", async () => {
  const client = await connect([]);
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    [
      "linkedin_comment_on_post",
      "linkedin_create_post",
      "linkedin_delete_post",
      "linkedin_get_post",
      "linkedin_get_post_stats",
      "linkedin_get_profile",
      "linkedin_list_organizations",
      "linkedin_list_posts",
      "linkedin_react_to_post",
    ],
  );
});

test("get_profile returns urn", async () => {
  const client = await connect([]);
  const result = await client.callTool({ name: "linkedin_get_profile", arguments: {} });
  assert.equal(JSON.parse(text(result)).urn, "urn:li:person:abc123");
});

test("create_post sends a correct Posts API request", async () => {
  const calls: Call[] = [];
  const client = await connect(calls);
  const result = await client.callTool({
    name: "linkedin_create_post",
    arguments: { text: "Hello (world) #MCP", link_url: "https://example.com", link_title: "Example" },
  });
  assert.ok(!result.isError, text(result));
  assert.deepEqual(JSON.parse(text(result)), {
    id: "urn:li:share:999",
    url: "https://www.linkedin.com/feed/update/urn:li:share:999/",
    author: "urn:li:person:abc123",
  });

  const post = calls.find((c) => c.url.endsWith("/rest/posts"))!;
  assert.equal(post.headers.Authorization, "Bearer test-token");
  assert.match(post.headers["LinkedIn-Version"], /^\d{6}$/);
  const body = JSON.parse(post.body!);
  assert.equal(body.author, "urn:li:person:abc123");
  assert.equal(body.commentary, "Hello \\(world\\) {hashtag|\\#|MCP}");
  assert.equal(body.visibility, "PUBLIC");
  assert.deepEqual(body.content, { article: { source: "https://example.com", title: "Example" } });
});

test("create_post as organization uses organization urn", async () => {
  const calls: Call[] = [];
  const client = await connect(calls);
  await client.callTool({ name: "linkedin_create_post", arguments: { text: "Hi", organization_id: "42" } });
  const body = JSON.parse(calls.find((c) => c.url.endsWith("/rest/posts"))!.body!);
  assert.equal(body.author, "urn:li:organization:42");
  assert.ok(!calls.some((c) => c.url.endsWith("/v2/userinfo")));
});

test("delete_post encodes the urn", async () => {
  const calls: Call[] = [];
  const client = await connect(calls);
  const result = await client.callTool({ name: "linkedin_delete_post", arguments: { post_urn: "urn:li:share:999" } });
  assert.ok(!result.isError);
  assert.ok(calls[0].url.endsWith("/rest/posts/urn%3Ali%3Ashare%3A999"));
});

test("API errors are returned as tool errors", async () => {
  const client = await connect([]);
  const result = await client.callTool({ name: "linkedin_get_post", arguments: { post_urn: "urn:li:share:1" } });
  assert.equal(result.isError, true);
  assert.match(text(result), /403: Not enough permissions/);
});
