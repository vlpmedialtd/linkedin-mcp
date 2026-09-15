# linkedin-mcp

[![CI](https://github.com/vlpmedialtd/linkedin-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/vlpmedialtd/linkedin-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

An open-source [Model Context Protocol](https://modelcontextprotocol.io) server that connects AI assistants such as Claude to the **official LinkedIn API**.

Let your assistant read your profile, publish text, link and image posts, post on behalf of company pages, comment and react — all through LinkedIn's documented OAuth APIs. No scraping, no password sharing, no ToS gray zone.

## What can I do with it?

**Works for your personal profile — no company account needed.** The two products it relies on (*Share on LinkedIn* and *Sign In with LinkedIn using OpenID Connect*) are self-serve and granted instantly for any LinkedIn member.

### With a personal profile (default setup, instant access)

- ✅ **Publish posts** on your own profile — plain text, with a link preview, or with an image (local file or URL)
- ✅ **Real hashtags** — `#AI` in your text becomes a clickable LinkedIn hashtag; special characters are escaped automatically
- ✅ **Choose visibility** — public, connections only, or signed-in members
- ✅ **Comment** on posts and **react** (like, celebrate, support, love, insightful, funny)
- ✅ **Delete** posts you created
- ✅ **Automate posting** — let Claude write and publish on a schedule (see [Automated posting](#automated-posting))
- ❌ **Reading** your posts, feed or post statistics — LinkedIn restricts `r_member_social` to approved partners
- ❌ Messages, connections, search, other people's profiles — not offered by LinkedIn's public API

### With a company page (needs the Community Management API)

- ✅ Everything above **as the page** (`organization_id` parameter)
- ✅ List the pages you administer
- ✅ Read the page's posts and like/comment statistics

LinkedIn reviews Community Management API requests and requires it to be the only product in its app, so use a **separate app** for company pages.

## Tools

| Tool | What it does | Required LinkedIn permission |
| --- | --- | --- |
| `linkedin_get_profile` | Name, email, picture and person URN of the signed-in member | `openid profile email` |
| `linkedin_create_post` | Publish a text post, optionally with a link preview or an image (local file or URL). `#hashtags` become real hashtags. | `w_member_social` (`w_organization_social` for pages) |
| `linkedin_delete_post` | Delete a post you authored | `w_member_social` / `w_organization_social` |
| `linkedin_get_post` | Fetch a post by URN | `r_member_social`\* / `r_organization_social` |
| `linkedin_list_posts` | List recent posts of yourself or a company page | `r_member_social`\* / `r_organization_social` |
| `linkedin_list_organizations` | Company pages you administer | `rw_organization_admin` |
| `linkedin_comment_on_post` | Comment as yourself or as a page | `w_member_social` / `w_organization_social` |
| `linkedin_react_to_post` | Like, celebrate, support, … | `w_member_social` / `w_organization_social` |
| `linkedin_get_post_stats` | Like and comment summary of a post | `r_member_social`\* / `r_organization_social` |

\* `r_member_social` is a restricted permission LinkedIn only grants to approved partners. Organization tools need the **Community Management API** product on your app.

## Quick start

### 1. Create a LinkedIn app

1. **Create a LinkedIn Page (formality only).** LinkedIn requires every developer app to be linked to a Page. If you don't have one, create one in a minute via *For Business → Create a Company Page* — it doesn't need to be a real company and never has to post anything. Your posts will still appear on your **personal** profile.
2. Go to <https://www.linkedin.com/developers/apps> → **Create app** and select that Page.
3. In **Settings**, verify the app with the Page (as the Page admin you can approve it yourself).
4. In **Products**, click *Request access* on exactly these two — both are granted instantly:
   - **Share on LinkedIn** → `w_member_social` (publish, comment, react)
   - **Sign In with LinkedIn using OpenID Connect** → `openid profile email` (identifies you as the post author)

   You don't need Advertising, Lead Sync, Events, Conversions or any other product for personal posting.
5. In **Auth**, add `http://localhost:8787/callback` under *Authorized redirect URLs for your app* and check that the scopes `openid`, `profile`, `email`, `w_member_social` are listed.
6. Copy the **Client ID** and **Primary Client Secret**.

### 2. Get an access token

```bash
LINKEDIN_CLIENT_ID=xxx LINKEDIN_CLIENT_SECRET=yyy npx -y github:vlpmedialtd/linkedin-mcp auth
```

A browser window opens, you approve the app, and the token is stored in `~/.config/linkedin-mcp/token.json` (file mode `600`). LinkedIn tokens are valid for 60 days — just run `auth` again when it expires.

For company pages, request more scopes:

```bash
LINKEDIN_SCOPES="openid profile email w_member_social w_organization_social r_organization_social rw_organization_admin" \
LINKEDIN_CLIENT_ID=xxx LINKEDIN_CLIENT_SECRET=yyy npx -y github:vlpmedialtd/linkedin-mcp auth
```

Already have a token (e.g. from the LinkedIn [OAuth Token Generator](https://www.linkedin.com/developers/tools/oauth/token-generator))? Skip this step and set `LINKEDIN_ACCESS_TOKEN` instead.

### 3. Add it to your MCP client

**Claude Code**

```bash
claude mcp add linkedin -- npx -y github:vlpmedialtd/linkedin-mcp
```

**Claude Desktop / Cursor / any MCP client** (`claude_desktop_config.json`, `.cursor/mcp.json`, …)

```json
{
  "mcpServers": {
    "linkedin": {
      "command": "npx",
      "args": ["-y", "github:vlpmedialtd/linkedin-mcp"],
      "env": {
        "LINKEDIN_ACCESS_TOKEN": "optional — omit when you used `auth`"
      }
    }
  }
}
```

Then ask your assistant things like:

- *"Who am I on LinkedIn?"*
- *"Draft a LinkedIn post about our new release with a link to https://example.com, show it to me, then publish it."*
- *"Post this screenshot `/Users/me/Desktop/chart.png` on our company page with alt text."*
- *"Like and comment 'Congrats!' on urn:li:share:7234…"*

## Automated posting

The MCP server provides the tools; something has to trigger them. Options:

- **Claude scheduled tasks** — e.g. *"Every Tuesday at 9:00, write a short LinkedIn post about this week's topic from my notes and publish it."*
- **n8n, cron or any agent framework** that can run an MCP client.

Keep in mind:

- **Token lifetime:** standard LinkedIn apps get no refresh token, so the access token expires after **60 days**. Run `auth` again before it expires; the server reports a clear error when it has.
- **Confirmation:** the post tool's description asks the model to confirm the text before publishing. In unattended runs, state explicitly in your prompt that publishing without confirmation is intended.
- **Fair use:** posting through the official API is allowed, but LinkedIn's [User Agreement](https://www.linkedin.com/legal/user-agreement) forbids spam and bulk posting — keep the cadence human.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `LINKEDIN_ACCESS_TOKEN` | – | Access token. Takes precedence over the token file. |
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` | – | Needed only for `auth`. |
| `LINKEDIN_REDIRECT_URI` | `http://localhost:8787/callback` | Must match your app settings. |
| `LINKEDIN_SCOPES` | `openid profile email w_member_social` | Scopes requested by `auth`. |
| `LINKEDIN_API_VERSION` | `202608` | Value of the `LinkedIn-Version` header (`YYYYMM`). LinkedIn supports each version for about a year. |
| `LINKEDIN_TOKEN_FILE` | `~/.config/linkedin-mcp/token.json` | Where `auth` stores and the server reads the token. |

## Development

```bash
git clone https://github.com/vlpmedialtd/linkedin-mcp.git
cd linkedin-mcp
npm install
npm test          # builds and runs the test suite (no network, LinkedIn is mocked)
npx @modelcontextprotocol/inspector node dist/index.js   # try the tools interactively
```

Project layout:

```
src/
  index.ts      CLI entry (stdio server + `auth` command)
  server.ts     MCP tool definitions
  linkedin.ts   Thin LinkedIn REST client (Posts, Assets, Organizations, Social Actions, Reactions)
  auth.ts       OAuth 2.0 authorization-code flow with local callback
  config.ts     Token storage / resolution
  text.ts       "little text" escaping + hashtag conversion for post commentary
  test/         node:test suites
```

## Security notes

- The token only grants what you approved in the OAuth screen; revoke it any time at <https://www.linkedin.com/psettings/permitted-services>.
- Tokens are stored locally with `600` permissions and never logged.
- Write tools are annotated as open-world/non-idempotent so MCP clients ask for confirmation; the tool descriptions also instruct the model to confirm text with you before publishing.

## Contributing

Issues and pull requests are welcome! Please run `npm test` before opening a PR.

## License

[MIT](LICENSE) © Andreas Henkel

*This project is not affiliated with, endorsed or sponsored by LinkedIn Corporation. LinkedIn is a trademark of LinkedIn Corporation.*
