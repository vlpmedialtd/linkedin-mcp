import { readFile } from "node:fs/promises";
import { DEFAULT_API_VERSION } from "./config.js";

const API_BASE = "https://api.linkedin.com";

export type Visibility = "PUBLIC" | "CONNECTIONS" | "LOGGED_IN";
export type ReactionType = "LIKE" | "PRAISE" | "EMPATHY" | "INTEREST" | "APPRECIATION" | "ENTERTAINMENT";

export class LinkedInApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    method: string,
    path: string,
  ) {
    super(`LinkedIn API ${method} ${path} failed with ${status}: ${describe(body)}`);
    this.name = "LinkedInApiError";
  }
}

function describe(body: unknown): string {
  if (body && typeof body === "object" && "message" in body) return String((body as { message: unknown }).message);
  if (typeof body === "string" && body) return body.slice(0, 500);
  return JSON.stringify(body);
}

export interface UserInfo {
  sub: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  email?: string;
  email_verified?: boolean;
  picture?: string;
  locale?: unknown;
}

export interface CreatePostInput {
  author: string;
  commentary: string;
  visibility?: Visibility;
  article?: { source: string; title?: string; description?: string };
  media?: { id: string; altText?: string };
}

export interface ClientOptions {
  getAccessToken: () => Promise<string>;
  apiVersion?: string;
  fetch?: typeof fetch;
}

type Json = Record<string, unknown>;

export class LinkedInClient {
  private readonly getAccessToken: () => Promise<string>;
  private readonly apiVersion: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ClientOptions) {
    this.getAccessToken = options.getAccessToken;
    this.apiVersion = options.apiVersion || DEFAULT_API_VERSION;
    this.fetchImpl = options.fetch ?? fetch;
  }

  private async request(
    method: string,
    path: string,
    { body, versioned = true, headers = {} }: { body?: unknown; versioned?: boolean; headers?: Record<string, string> } = {},
  ): Promise<{ status: number; headers: Headers; data: any }> {
    const token = await this.getAccessToken();
    const allHeaders: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "X-Restli-Protocol-Version": "2.0.0",
      ...headers,
    };
    if (versioned) allHeaders["LinkedIn-Version"] = this.apiVersion;
    if (body !== undefined) allHeaders["Content-Type"] = "application/json";

    const res = await this.fetchImpl(`${API_BASE}${path}`, {
      method,
      headers: allHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await res.text();
    let data: any = text;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      // keep raw text
    }
    if (!res.ok) throw new LinkedInApiError(res.status, data, method, path);
    return { status: res.status, headers: res.headers, data };
  }

  /** OpenID Connect userinfo (scopes: openid profile email). */
  async getUserInfo(): Promise<UserInfo> {
    const { data } = await this.request("GET", "/v2/userinfo", { versioned: false });
    return data as UserInfo;
  }

  private memberUrn?: string;

  async getMemberUrn(): Promise<string> {
    if (!this.memberUrn) {
      const info = await this.getUserInfo();
      this.memberUrn = `urn:li:person:${info.sub}`;
    }
    return this.memberUrn;
  }

  /** Creates a post and returns its URN (e.g. urn:li:share:123 or urn:li:ugcPost:123). */
  async createPost(input: CreatePostInput): Promise<string> {
    const body: Json = {
      author: input.author,
      commentary: input.commentary,
      visibility: input.visibility ?? "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    };
    if (input.article) body.content = { article: input.article };
    else if (input.media) body.content = { media: input.media };

    const res = await this.request("POST", "/rest/posts", { body });
    const id = res.headers.get("x-restli-id") ?? res.headers.get("x-linkedin-id") ?? res.data?.id;
    if (!id) throw new Error("LinkedIn created the post but returned no post id.");
    return id;
  }

  async getPost(postUrn: string): Promise<unknown> {
    const { data } = await this.request("GET", `/rest/posts/${encodeURIComponent(postUrn)}`);
    return data;
  }

  async listPosts(authorUrn: string, count = 10, start = 0): Promise<unknown> {
    const qs = `q=author&author=${encodeURIComponent(authorUrn)}&count=${count}&start=${start}&sortBy=LAST_MODIFIED`;
    const { data } = await this.request("GET", `/rest/posts?${qs}`, {
      headers: { "X-RestLi-Method": "FINDER" },
    });
    return data;
  }

  async deletePost(postUrn: string): Promise<void> {
    await this.request("DELETE", `/rest/posts/${encodeURIComponent(postUrn)}`, {
      headers: { "X-RestLi-Method": "DELETE" },
    });
  }

  /**
   * Uploads an image (local path or http(s) URL) and returns the media URN
   * usable as `media.id` in {@link createPost}.
   */
  async uploadImage(owner: string, source: string): Promise<string> {
    const { bytes, contentType } = await loadBinary(source, this.fetchImpl);

    const { data } = await this.request("POST", "/v2/assets?action=registerUpload", {
      versioned: false,
      body: {
        registerUploadRequest: {
          owner,
          recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
          serviceRelationships: [{ identifier: "urn:li:userGeneratedContent", relationshipType: "OWNER" }],
          supportedUploadMechanism: ["SYNCHRONOUS_SINGLE_UPLOAD"],
        },
      },
    });
    const uploadUrl: string | undefined =
      data?.value?.uploadMechanism?.["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"]?.uploadUrl;
    const asset: string | undefined = data?.value?.asset;
    if (!uploadUrl || !asset) throw new Error("LinkedIn did not return an upload URL for the image.");

    const token = await this.getAccessToken();
    const upload = await this.fetchImpl(uploadUrl, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
      body: new Blob([bytes.slice()]),
    });
    if (!upload.ok) {
      throw new LinkedInApiError(upload.status, await upload.text(), "PUT", "(image upload)");
    }
    return asset;
  }

  /** Organizations where the authenticated member has the given role (Community Management API). */
  async listOrganizations(role = "ADMINISTRATOR"): Promise<Array<{ organization: string; role: string; state: string; name?: string; vanityName?: string }>> {
    const { data } = await this.request(
      "GET",
      `/rest/organizationAcls?q=roleAssignee&role=${encodeURIComponent(role)}&state=APPROVED&count=100`,
    );
    const elements: Array<{ organization: string; role: string; state: string }> = data?.elements ?? [];
    return Promise.all(
      elements.map(async (acl) => {
        const id = acl.organization.split(":").pop()!;
        try {
          const org = await this.request("GET", `/rest/organizations/${encodeURIComponent(id)}`);
          return {
            ...acl,
            name: org.data?.localizedName,
            vanityName: org.data?.vanityName,
          };
        } catch {
          return acl;
        }
      }),
    );
  }

  async commentOnPost(actorUrn: string, postUrn: string, text: string): Promise<unknown> {
    const { data, headers } = await this.request(
      "POST",
      `/rest/socialActions/${encodeURIComponent(postUrn)}/comments`,
      { body: { actor: actorUrn, object: postUrn, message: { text } } },
    );
    return data ?? { id: headers.get("x-restli-id") };
  }

  async reactToPost(actorUrn: string, postUrn: string, reactionType: ReactionType): Promise<void> {
    await this.request("POST", `/rest/reactions?actor=${encodeURIComponent(actorUrn)}`, {
      body: { root: postUrn, reactionType },
    });
  }

  async getSocialActions(postUrn: string): Promise<unknown> {
    const { data } = await this.request("GET", `/rest/socialActions/${encodeURIComponent(postUrn)}`);
    return data;
  }
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

async function loadBinary(source: string, fetchImpl: typeof fetch): Promise<{ bytes: Uint8Array; contentType: string }> {
  const ext = source.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
  if (/^https?:\/\//i.test(source)) {
    const res = await fetchImpl(source);
    if (!res.ok) throw new Error(`Could not download image from ${source}: HTTP ${res.status}`);
    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      contentType: res.headers.get("content-type") ?? MIME_BY_EXT[ext] ?? "application/octet-stream",
    };
  }
  return { bytes: await readFile(source), contentType: MIME_BY_EXT[ext] ?? "application/octet-stream" };
}

export function postUrl(postUrn: string): string {
  return `https://www.linkedin.com/feed/update/${postUrn}/`;
}
