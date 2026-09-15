import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { LinkedInClient } from "../linkedin.js";
import { createServer } from "../server.js";

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };

function mockFetch(calls: Call[], { imagesApi = true } = {}): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    if (url === "https://img.example/pic.png") {
      return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } });
    }
    if (url.endsWith("/rest/images?action=initializeUpload") && imagesApi) {
      return Response.json({ value: { uploadUrl: "https://upload.example/img", image: "urn:li:image:IMG1" } });
    }
    if (url.endsWith("/v2/assets?action=registerUpload")) {
      return Response.json({
        value: {
          asset: "urn:li:digitalmediaAsset:ASSET1",
          uploadMechanism: {
            "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest": { uploadUrl: "https://upload.example/asset" },
          },
        },
      });
    }
    if (url.startsWith("https://upload.example/") && init?.method === "PUT") {
      return new Response(null, { status: 201 });
    }
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

async function connect(calls: Call[], options?: { imagesApi?: boolean }) {
  const linkedin = new LinkedInClient({ getAccessToken: async () => "test-token", fetch: mockFetch(calls, options) });
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

test("image post uses the Images API and never SYNCHRONOUS_SINGLE_UPLOAD", async () => {
  const calls: Call[] = [];
  const client = await connect(calls);
  const result = await client.callTool({
    name: "linkedin_create_post",
    arguments: { text: "Pic", image: "https://img.example/pic.png", image_alt_text: "A chart" },
  });
  assert.ok(!result.isError, text(result));

  const put = calls.find((c) => c.method === "PUT")!;
  assert.equal(put.url, "https://upload.example/img");
  assert.equal(put.headers["Content-Type"], "image/png");
  const body = JSON.parse(calls.find((c) => c.url.endsWith("/rest/posts"))!.body!);
  assert.deepEqual(body.content, { media: { id: "urn:li:image:IMG1", altText: "A chart" } });
  assert.ok(!calls.some((c) => c.body?.includes("SYNCHRONOUS_SINGLE_UPLOAD")));
});

test("image upload falls back to the Assets API", async () => {
  const calls: Call[] = [];
  const client = await connect(calls, { imagesApi: false });
  const result = await client.callTool({
    name: "linkedin_create_post",
    arguments: { text: "Pic", image: "https://img.example/pic.png" },
  });
  assert.ok(!result.isError, text(result));
  const register = JSON.parse(calls.find((c) => c.url.includes("registerUpload"))!.body!);
  assert.equal(register.registerUploadRequest.supportedUploadMechanism, undefined);
  const body = JSON.parse(calls.find((c) => c.url.endsWith("/rest/posts"))!.body!);
  assert.equal(body.content.media.id, "urn:li:digitalmediaAsset:ASSET1");
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
