import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { LinkedInClient, postUrl } from "./linkedin.js";
import { formatCommentary } from "./text.js";

export const VERSION = "0.1.0";

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function ok(value: unknown): ToolResult {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    return { content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }], isError: true };
  }
}

const urn = (kind: string) =>
  z.string().regex(/^urn:li:[A-Za-z]+:.+$/, `Expected a LinkedIn URN such as ${kind}`);

const organizationId = z
  .string()
  .optional()
  .describe(
    "Post/act as this organization instead of yourself. Accepts a numeric id or urn:li:organization:<id>. Requires the Community Management API product.",
  );

function toOrganizationUrn(id: string): string {
  return id.startsWith("urn:li:") ? id : `urn:li:organization:${id}`;
}

export function createServer(client: LinkedInClient): McpServer {
  const server = new McpServer({ name: "linkedin-mcp", version: VERSION });

  let memberUrn: string | undefined;
  const actor = async (organization?: string) => {
    if (organization) return toOrganizationUrn(organization);
    return (memberUrn ??= await client.getMemberUrn());
  };

  server.registerTool(
    "linkedin_get_profile",
    {
      title: "Get my LinkedIn profile",
      description:
        "Returns the authenticated member's basic profile (name, email, picture) and their person URN. Use this to verify the connection.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    () =>
      run(async () => {
        const info = await client.getUserInfo();
        memberUrn = `urn:li:person:${info.sub}`;
        return { urn: memberUrn, ...info };
      }),
  );

  server.registerTool(
    "linkedin_create_post",
    {
      title: "Publish a LinkedIn post",
      description:
        "Publishes a post on LinkedIn as the authenticated member (or an organization). Supports plain text, a link preview (article) or a single image. " +
        "#hashtags in the text become real hashtags; all other special characters are escaped automatically. " +
        "This publishes publicly and immediately — confirm the final text with the user before calling.",
      inputSchema: {
        text: z.string().min(1).max(3000).describe("Post text (max 3000 characters)."),
        visibility: z
          .enum(["PUBLIC", "CONNECTIONS", "LOGGED_IN"])
          .default("PUBLIC")
          .describe("PUBLIC (anyone), CONNECTIONS (members only, not for organizations), LOGGED_IN (signed-in members)."),
        link_url: z.string().url().optional().describe("Attach a link preview to this URL."),
        link_title: z.string().optional().describe("Title for the link preview."),
        link_description: z.string().optional().describe("Description for the link preview."),
        image: z
          .string()
          .optional()
          .describe("Attach an image: absolute local file path or http(s) URL (JPG, PNG, GIF). Cannot be combined with link_url."),
        image_alt_text: z.string().max(4086).optional().describe("Alt text for the image."),
        organization_id: organizationId,
        convert_hashtags: z.boolean().default(true).describe("Convert #words into LinkedIn hashtags."),
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (args) =>
      run(async () => {
        if (args.link_url && args.image) throw new Error("Use either link_url or image, not both.");
        const author = await actor(args.organization_id);
        const media = args.image
          ? { id: await client.uploadImage(author, args.image), altText: args.image_alt_text }
          : undefined;
        const id = await client.createPost({
          author,
          commentary: formatCommentary(args.text, { hashtags: args.convert_hashtags }),
          visibility: args.visibility,
          article: args.link_url
            ? { source: args.link_url, title: args.link_title, description: args.link_description }
            : undefined,
          media,
        });
        return { id, url: postUrl(id), author };
      }),
  );

  server.registerTool(
    "linkedin_delete_post",
    {
      title: "Delete a LinkedIn post",
      description: "Deletes a post you (or your organization) authored. Irreversible — confirm with the user first.",
      inputSchema: {
        post_urn: urn("urn:li:share:123").describe("URN of the post, e.g. urn:li:share:123 or urn:li:ugcPost:123."),
      },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    (args) =>
      run(async () => {
        await client.deletePost(args.post_urn);
        return { deleted: args.post_urn };
      }),
  );

  server.registerTool(
    "linkedin_get_post",
    {
      title: "Get a LinkedIn post",
      description:
        "Fetches a single post by URN. Reading member posts requires the r_member_social permission (restricted); organization posts require r_organization_social.",
      inputSchema: { post_urn: urn("urn:li:share:123") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => run(() => client.getPost(args.post_urn)),
  );

  server.registerTool(
    "linkedin_list_posts",
    {
      title: "List LinkedIn posts",
      description:
        "Lists recent posts by an author (default: yourself). Requires r_member_social (restricted) for members or r_organization_social for organizations.",
      inputSchema: {
        organization_id: organizationId,
        count: z.number().int().min(1).max(100).default(10),
        start: z.number().int().min(0).default(0),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => run(async () => client.listPosts(await actor(args.organization_id), args.count, args.start)),
  );

  server.registerTool(
    "linkedin_list_organizations",
    {
      title: "List my LinkedIn organizations",
      description:
        "Lists LinkedIn company pages the authenticated member administers (Community Management API, scope rw_organization_admin).",
      inputSchema: {
        role: z
          .enum(["ADMINISTRATOR", "DIRECT_SPONSORED_CONTENT_POSTER", "RECRUITING_POSTER", "LEAD_GEN_FORMS_MANAGER", "ANALYST", "CURATOR", "CONTENT_ADMINISTRATOR"])
          .default("ADMINISTRATOR"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => run(() => client.listOrganizations(args.role)),
  );

  server.registerTool(
    "linkedin_comment_on_post",
    {
      title: "Comment on a LinkedIn post",
      description: "Adds a comment to a post as yourself or an organization. Publishes immediately — confirm with the user first.",
      inputSchema: {
        post_urn: urn("urn:li:share:123"),
        text: z.string().min(1).max(1250),
        organization_id: organizationId,
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (args) => run(async () => client.commentOnPost(await actor(args.organization_id), args.post_urn, args.text)),
  );

  server.registerTool(
    "linkedin_react_to_post",
    {
      title: "React to a LinkedIn post",
      description: "Adds a reaction (like, celebrate, support, …) to a post as yourself or an organization.",
      inputSchema: {
        post_urn: urn("urn:li:share:123"),
        reaction: z
          .enum(["LIKE", "PRAISE", "EMPATHY", "INTEREST", "APPRECIATION", "ENTERTAINMENT"])
          .default("LIKE")
          .describe("LIKE=Like, PRAISE=Celebrate, EMPATHY=Love, INTEREST=Insightful, APPRECIATION=Support, ENTERTAINMENT=Funny."),
        organization_id: organizationId,
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    (args) =>
      run(async () => {
        await client.reactToPost(await actor(args.organization_id), args.post_urn, args.reaction);
        return { reacted: args.reaction, post: args.post_urn };
      }),
  );

  server.registerTool(
    "linkedin_get_post_stats",
    {
      title: "Get likes/comments summary of a post",
      description: "Returns the like and comment summary of a post (socialActions).",
      inputSchema: { post_urn: urn("urn:li:share:123") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => run(() => client.getSocialActions(args.post_urn)),
  );

  return server;
}
