# linkedin-mcp

[![CI](https://github.com/vlpmedialtd/linkedin-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/vlpmedialtd/linkedin-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Post to LinkedIn from Claude, ChatGPT, Cursor or any AI assistant — on your personal profile, through the official LinkedIn API.**

`linkedin-mcp` is an open-source [Model Context Protocol](https://modelcontextprotocol.io) server. You sign in once with your own LinkedIn developer app, and your assistant can publish text, link and image posts, comment and react. No scraping, no password sharing, no browser automation.

> **No company account needed.** It works with a normal personal LinkedIn profile. LinkedIn only asks you to link your developer app to a Page, and you can create one yourself in a minute (see [step 1](#1-create-a-linkedin-app-5-minutes)).

---

## Contents

- [What can I do with it?](#what-can-i-do-with-it)
- [Setup](#setup)
  - [1. Create a LinkedIn app](#1-create-a-linkedin-app-5-minutes)
  - [2. Sign in](#2-sign-in)
  - [3a. Use with Claude Code / Claude Desktop / Cursor](#3a-use-with-claude-code--claude-desktop--cursor)
  - [3b. Use with ChatGPT](#3b-use-with-chatgpt)
  - [3c. Self-hosting (always on)](#3c-self-hosting-always-on): for Claude routines, claude.ai and scheduled tasks
- [Example prompts](#example-prompts)
- [Automated posting](#automated-posting)
- [Troubleshooting](#troubleshooting)
- [Tools reference](#tools-reference)
- [Configuration](#configuration)
- [Company pages](#company-pages)
- [Security](#security)
- [Development](#development)

---

## What can I do with it?

With a personal profile and the default setup (access is granted instantly):

| | |
| --- | --- |
| ✅ Publish posts | Plain text, with a link preview, or with an image (local file or URL) |
| ✅ Real hashtags | `#AI` becomes a clickable hashtag; special characters are escaped automatically |
| ✅ Visibility | Public, connections only, or signed-in members |
| ✅ Engage | Comment on posts and react (like, celebrate, support, love, insightful, funny) |
| ✅ Delete | Remove posts you created |
| ✅ Automate | Let your assistant write and publish on a schedule |
| ❌ Read your feed, posts or engagement statistics (likes, comments, impressions) | LinkedIn restricts `r_member_social` to approved partners; no app setting enables it |
| ❌ Messages, connections, search, other profiles | Not offered by LinkedIn's public API |

Company pages are supported as well, but need extra approval from LinkedIn (see [Company pages](#company-pages)).

---

## Setup

You need **Node.js 22+** (`node -v`) and a LinkedIn account.

### 1. Create a LinkedIn app (5 minutes)

1. **Create a LinkedIn Page, if you don't have one.** LinkedIn requires every developer app to be linked to a Page. This is only a formality: go to *For Business → Create a Company Page*, pick any name (e.g. "Jane Doe Tools"). It never has to post anything. Your posts still appear on your **personal** profile.
2. Open <https://www.linkedin.com/developers/apps> → **Create app**, pick that Page, upload any logo.
3. **Settings** tab → **Verify** the app with the Page. As the Page admin you approve it yourself.
4. **Products** tab → click **Request access** on exactly these two (both are granted instantly):
   - **Share on LinkedIn**: publish, comment, react (`w_member_social`)
   - **Sign In with LinkedIn using OpenID Connect**: identifies you as the author (`openid profile email`)

   Don't request the other products (Advertising, Lead Sync, Events, Community Management, …). You don't need them for personal posting.
5. **Auth** tab → *Authorized redirect URLs for your app* → pencil icon → **Add redirect URL** → paste exactly

   ```
   http://localhost:8787/callback
   ```

   and click **Update**. It must be `http` (not https), `localhost` (not 127.0.0.1), with no trailing slash.
6. Still in **Auth**: check that *OAuth 2.0 scopes* lists `openid`, `profile`, `email`, `w_member_social`. Keep this tab open, you'll need the **Client ID** and **Primary Client Secret**.

### 2. Sign in

Run this in your terminal. It's the only command you need, and it asks for everything:

```bash
npx -y github:vlpmedialtd/linkedin-mcp auth
```

1. `LinkedIn Client ID:` → paste the Client ID, press Enter
2. `LinkedIn Client Secret (hidden):` → click the **copy icon** next to *Primary Client Secret*, paste, press Enter. Nothing is shown while you paste; that's intentional. You'll see `(received NN characters)`: the secret is much longer than the 14-character Client ID.
3. Your browser opens → click **Allow**
4. Wait until the terminal shows **`✔ Token saved to ~/.config/linkedin-mcp/token.json`**. Only then are you done.

The token is valid for **60 days**. Run the same command again when it expires.

> Paste values **at the prompts**, not behind the command. If your terminal shows `dquote>`, press `Ctrl+C` and start again.

### 3a. Use with Claude Code / Claude Desktop / Cursor

These clients start the server locally on your computer.

**Claude Code**

```bash
claude mcp add -s user linkedin -- npx -y github:vlpmedialtd/linkedin-mcp
```

Check with `claude mcp list` (should show `linkedin … ✓ Connected`), then start a new session.

**Claude Desktop / Cursor / Windsurf / any stdio MCP client**: add to `claude_desktop_config.json`, `.cursor/mcp.json`, …

```json
{
  "mcpServers": {
    "linkedin": {
      "command": "npx",
      "args": ["-y", "github:vlpmedialtd/linkedin-mcp"]
    }
  }
}
```

Restart the app. Test it by asking *"Who am I on LinkedIn?"*. This only reads your profile; nothing is posted.

> **Claude Desktop (macOS):** the config file is `~/Library/Application Support/Claude/claude_desktop_config.json`. Desktop apps don't inherit your shell's `PATH`, so if Node is installed via nvm, Homebrew or in `~/.local/bin`, use the absolute path from `which npx` and pass a `PATH`:
>
> ```json
> {
>   "mcpServers": {
>     "linkedin": {
>       "command": "/Users/you/.local/bin/npx",
>       "args": ["-y", "github:vlpmedialtd/linkedin-mcp"],
>       "env": { "PATH": "/Users/you/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" }
>     }
>   }
> }
> ```
>
> Quit Claude completely (`Cmd+Q`) and reopen it. `claude mcp add` only configures **Claude Code**, not the Claude Desktop chat.

**claude.ai in the browser / Claude mobile**: these need a remote server. Start the [HTTP mode with a tunnel](#3b-use-with-chatgpt) (steps 1 and 2), then go to **Settings → Connectors → Add custom connector** and paste `https://<tunnel>/mcp/<secret>`.

### 3b. Use with ChatGPT

ChatGPT can't start programs on your computer. It connects to MCP servers over **public HTTPS** instead. `linkedin-mcp` has an HTTP mode for this, and you make it reachable through a tunnel.

**Requirements:** a ChatGPT plan with *Developer mode* (Plus, Pro, Business, Enterprise or Education, on the web), and steps 1 and 2 above completed.

**1. Start the HTTP server** (terminal 1, keep it running)

```bash
npx -y github:vlpmedialtd/linkedin-mcp http
```

It prints your secret endpoint, for example `http://127.0.0.1:3000/mcp/Xy7…`. The part after `/mcp/` is a random secret stored in `~/.config/linkedin-mcp/http-token`, so it stays the same across restarts.

**2. Open an HTTPS tunnel** (terminal 2, keep it running)

```bash
brew install cloudflared
```

```bash
cloudflared tunnel --url http://localhost:3000
```

Copy the `https://….trycloudflare.com` address it prints. [ngrok](https://ngrok.com) (`ngrok http 3000`) works the same way.

**3. Add the app in ChatGPT**

1. ChatGPT → **Settings → Security and login** → turn on **Developer mode**.
2. Go to **Plugins** (apps) → **+** to create a developer-mode app for a remote MCP server.
3. **MCP server URL**: your tunnel address + `/mcp/` + your secret, e.g.
   `https://blue-sky-1234.trycloudflare.com/mcp/Xy7…`
4. **Authentication**: **No authentication**. The secret in the URL protects the server.
5. Confirm that you trust the app and create it.

**4. Use it**: in a chat, open the **+** menu → **Developer mode** → enable your LinkedIn app, then ask *"Who am I on LinkedIn?"*. ChatGPT asks for confirmation before write actions such as publishing a post.

Good to know:

- **Both terminals must keep running** and your computer must stay awake while ChatGPT uses the app.
- **Quick tunnels get a new address on every start.** Update the app's URL in ChatGPT afterwards, or use a [named Cloudflare tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) or an ngrok static domain for a permanent address.
- **Images:** ChatGPT can't hand files from the chat to the server. Use an image URL, or a file path on the computer running the server.
- **Always-on hosting:** run `linkedin-mcp http --host 0.0.0.0` on any Node host (VPS, Railway, Render, Fly.io …) with `LINKEDIN_ACCESS_TOKEN` and `MCP_AUTH_TOKEN` set as environment variables, behind HTTPS.
- Menu names in ChatGPT change from time to time. See OpenAI's [Developer mode guide](https://developers.openai.com/api/docs/guides/developer-mode) for the current steps.

### 3c. Self-hosting (always on)

Cloud features such as **Claude routines**, **claude.ai connectors** and **ChatGPT scheduled tasks** run on the provider's servers and can't reach your laptop. For them, run `linkedin-mcp` permanently on a small Linux server. Tested on Ubuntu with Caddy for automatic HTTPS; the files are in [`deploy/`](deploy).

**Requirements:** a server with a public IP, SSH as root, and a (sub)domain whose DNS **A record** points to the server (e.g. `mcp.example.com`).

**1. Install** (on the server)

```bash
apt-get update && apt-get install -y git caddy nodejs npm
```

```bash
useradd --system --home /var/lib/linkedin-mcp --create-home --shell /usr/sbin/nologin linkedin-mcp
```

```bash
git clone https://github.com/vlpmedialtd/linkedin-mcp.git /opt/linkedin-mcp && cd /opt/linkedin-mcp && npm ci && npm run build
```

Node must be 22 or newer (`node -v`). Otherwise install it from [NodeSource](https://github.com/nodesource/distributions).

**2. Copy your LinkedIn token** (run `auth` on your computer first, then from your computer)

```bash
scp ~/.config/linkedin-mcp/token.json root@SERVER:/root/token.json
```

On the server:

```bash
install -d -m 700 -o linkedin-mcp -g linkedin-mcp /etc/linkedin-mcp && install -m 600 -o linkedin-mcp -g linkedin-mcp /root/token.json /etc/linkedin-mcp/token.json && rm /root/token.json
```

**3. Service, HTTPS and firewall**

```bash
cp /opt/linkedin-mcp/deploy/linkedin-mcp.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now linkedin-mcp
```

```bash
cp /opt/linkedin-mcp/deploy/Caddyfile /etc/caddy/Caddyfile && sed -i 's/mcp.example.com/YOUR.DOMAIN/' /etc/caddy/Caddyfile && systemctl reload caddy
```

```bash
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
```

**4. Get your connector URL**

```bash
echo "https://YOUR.DOMAIN/linkedin/mcp/$(cat /etc/linkedin-mcp/http-token)"
```

Check `https://YOUR.DOMAIN/linkedin/health` → `{"status":"ok"}`.

**5. Add it as a connector**

- **claude.ai** (also used by Claude routines, the desktop and mobile apps): **Settings → Connectors → Add custom connector** → name `LinkedIn`, paste the URL, no OAuth needed.
- **ChatGPT**: see [3b](#3b-use-with-chatgpt), step 3, with this URL instead of the tunnel.

**Maintenance**

| Task | Command (on the server) |
| --- | --- |
| Renew LinkedIn token (every 60 days) | run `auth` locally, then repeat step 2 and `systemctl restart linkedin-mcp` |
| Update to the latest version | `cd /opt/linkedin-mcp && git pull && npm ci && npm run build && systemctl restart linkedin-mcp` |
| New secret URL | `rm /etc/linkedin-mcp/http-token && systemctl restart linkedin-mcp`, then step 4 and update the connector |
| Logs | `journalctl -u linkedin-mcp -f` |

---

## Example prompts

- *"Who am I on LinkedIn?"* (connection test, read-only)
- *"Write a LinkedIn post about our new open-source release, link https://github.com/…, show me the draft first."*
- *"Post this image `/Users/me/Desktop/chart.png` with the text '…' and alt text 'Revenue chart Q3'."*
- *"Publish it for my connections only."*
- *"Delete the post you just published."*
- *"Like urn:li:share:7234… and comment 'Congratulations!'"*

---

## Automated posting

The server provides the tools; something has to trigger them:

- **Claude**: scheduled tasks, e.g. *"Every Tuesday at 9:00, write a short post about this week's topic from my notes and publish it."*
- **ChatGPT**: scheduled tasks with the developer-mode app enabled
- **n8n, cron or an agent framework** that can act as an MCP client

Keep in mind:

- **Token lifetime:** standard LinkedIn apps get no refresh token. The access token expires after **60 days** and the server then reports a clear error. Put a reminder in your calendar to run `auth` again.
- **Confirmation:** the post tool asks the model to confirm the text with you first. For unattended runs, say explicitly in your prompt that publishing without confirmation is intended.
- **Fair use:** posting through the official API is allowed, but LinkedIn's [User Agreement](https://www.linkedin.com/legal/user-agreement) prohibits spam and bulk posting. Keep the cadence human.

---

## Troubleshooting

| Problem | Cause & fix |
| --- | --- |
| "Do I need a company account?" | No. You only need a Page to *create* the developer app (step 1.1). Posts go to your personal profile. |
| Terminal shows `dquote>` or `zsh: no matches found` | A value was pasted directly behind the command. Press `Ctrl+C`, run only `npx -y github:vlpmedialtd/linkedin-mcp auth`, then paste values at the prompts. |
| Browser: **"The redirect_uri does not match the registered value"** | The redirect URL is missing or differs in the app's **Auth** tab. Add exactly `http://localhost:8787/callback` and click **Update**. Watch for `https`, `127.0.0.1`, a trailing `/` or spaces. Then press `Ctrl+C` and run `auth` again. |
| **`Token exchange failed (401): invalid_client`** | The Client Secret is wrong. If it says `received 14 characters`, you pasted the Client ID again. Copy *Primary Client Secret* with the copy icon (or generate a new one) and run `auth` again. |
| Browser: `unauthorized_scope_error` | One of the two products isn't added yet. Check **Products → Added products** for *Share on LinkedIn* and *Sign In with LinkedIn using OpenID Connect*. |
| **`No LinkedIn access token found`** | `auth` didn't finish. Run it again and wait for `✔ Token saved to …`. No restart of your MCP client is needed; the token is read on every call. |
| `The stored LinkedIn access token expired` | 60 days are over. Run `auth` again. |
| `auth` still shows old behaviour | npx cached an old version. Run `rm -rf ~/.npm/_npx` and try again. |
| `EADDRINUSE` on port 8787 | Something else uses the port. Run `export LINKEDIN_REDIRECT_URI=http://localhost:8788/callback`, register that URL in the app, then run `auth`. |
| `403 … partnerApiSocialActions.GET` / `partnerApiSocialMetadata.GET` on `get_post_stats`, `get_post`, `list_posts` | Expected for personal profiles. Reading posts, comments and engagement needs `r_member_social`, which LinkedIn only grants to partners. **No setting in your app changes this.** The EU "Member Data Portability" product doesn't help either: it only logs your own actions, not engagement you receive. For your own analytics, use *Analytics → Export* on linkedin.com. |
| `403 … partnerApiSocialActions.CREATE` / `partnerApiReactions.CREATE` when commenting or reacting | Fixed in v0.2.1: comments and reactions now use the v2 endpoints that work with `w_member_social`. Update (`npx` fetches the latest version; self-hosted: see *Maintenance*). |
| LinkedIn API `426` / version errors | Set `LINKEDIN_API_VERSION` to a current `YYYYMM` month (LinkedIn supports each version for about a year). |
| ChatGPT: *"Error creating connector"* / `401` | Check the URL: tunnel address + `/mcp/` + the secret the server printed. Is the `http` server still running? |
| ChatGPT worked yesterday, not today | The quick tunnel got a new address, or the computer slept. Restart both terminals and update the URL in ChatGPT. |
| Claude Code: `linkedin` not listed / not connected | Run `claude mcp list`. Re-add with the command from step 3a and start a new session. |
| **Claude routine / claude.ai: "LinkedIn connector missing"** | Routines and claude.ai run in the cloud and only see connectors added at **claude.ai → Settings → Connectors**, not local MCP servers. Host the server ([3c](#3c-self-hosting-always-on)) and add its URL as a custom connector. |
| **Claude Desktop chat has no LinkedIn tools** (but Claude Code does) | `claude mcp add` only configures Claude Code. Add the server to `claude_desktop_config.json` (step 3a) with the absolute `npx` path and `PATH`, then quit with `Cmd+Q` and reopen. |
| Claude Desktop: `spawn npx ENOENT` / server failed | The app can't find Node. Use the absolute path from `which npx` plus an `env.PATH` (see step 3a). Logs: `~/Library/Logs/Claude/mcp-server-linkedin.log`. |

Still stuck? [Open an issue](https://github.com/vlpmedialtd/linkedin-mcp/issues) with the error message. **Never post your Client Secret, access token or MCP URL.**

---

## Tools reference

| Tool | What it does | LinkedIn permission |
| --- | --- | --- |
| `linkedin_get_profile` | Name, email, picture and person URN of the signed-in member | `openid profile email` |
| `linkedin_create_post` | Publish a text post, optionally with link preview (`link_url`) or image (`image`) | `w_member_social` |
| `linkedin_delete_post` | Delete a post you authored | `w_member_social` |
| `linkedin_comment_on_post` | Comment on a post | `w_member_social` |
| `linkedin_react_to_post` | React to a post | `w_member_social` |
| `linkedin_get_post` | Fetch a post by URN | `r_member_social`\* / `r_organization_social` |
| `linkedin_list_posts` | List recent posts | `r_member_social`\* / `r_organization_social` |
| `linkedin_get_post_stats` | Like and comment summary | `r_member_social`\* / `r_organization_social` |
| `linkedin_list_organizations` | Pages you administer | `rw_organization_admin` |

\* Restricted by LinkedIn to approved partners.

All write tools accept an optional `organization_id` to act as a company page. Tools carry MCP annotations (`readOnlyHint`, `destructiveHint`), so clients like ChatGPT and Claude can ask before write actions.

---

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `LINKEDIN_ACCESS_TOKEN` | – | Access token; takes precedence over the token file (useful for hosting) |
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` | prompted | Used by `auth` |
| `LINKEDIN_REDIRECT_URI` | `http://localhost:8787/callback` | Must match the app's Auth settings |
| `LINKEDIN_SCOPES` | `openid profile email w_member_social` | Scopes requested by `auth` |
| `LINKEDIN_API_VERSION` | `202608` | `LinkedIn-Version` header (`YYYYMM`) |
| `LINKEDIN_TOKEN_FILE` | `~/.config/linkedin-mcp/token.json` | Token storage |
| `MCP_AUTH_TOKEN` | generated | Secret for the HTTP endpoint |
| `PORT` / `HOST` | `3000` / `127.0.0.1` | HTTP mode listen address |

CLI:

```text
linkedin-mcp                 stdio server (Claude Code, Claude Desktop, Cursor, …)
linkedin-mcp auth            sign in and store the token
linkedin-mcp http            Streamable HTTP server (ChatGPT, remote clients)
    --port <port> --host <host> --new-token
```

HTTP endpoints: `GET /health`; MCP at `/mcp/<secret>` or `/mcp` with `Authorization: Bearer <secret>`.

---

## Company pages

To post, comment and read statistics **as a company page**:

1. Create a **separate** LinkedIn app. LinkedIn requires the Community Management API to be the only product in its app.
2. Request **Community Management API** (LinkedIn reviews the request).
3. Sign in with the extra scopes:

   ```bash
   LINKEDIN_SCOPES="openid profile email w_member_social w_organization_social r_organization_social rw_organization_admin" npx -y github:vlpmedialtd/linkedin-mcp auth
   ```

4. Ask *"Which LinkedIn pages do I manage?"*, then *"Post … on page 12345"*.

---

## Security

- Tokens and the HTTP secret are stored locally with `600` permissions and are never logged.
- The Client Secret is only used during `auth` and is not saved.
- **Anyone with your HTTP MCP URL can post as you.** Don't share it. Rotate it with `linkedin-mcp http --new-token`, then update the URL in ChatGPT.
- The HTTP server listens on `127.0.0.1` by default and is only reachable through your tunnel.
- Revoke access any time at <https://www.linkedin.com/psettings/permitted-services>.

---

## Development

```bash
git clone https://github.com/vlpmedialtd/linkedin-mcp.git
cd linkedin-mcp
npm install
npm test                                              # build + tests (LinkedIn API is mocked)
npx @modelcontextprotocol/inspector node dist/index.js   # try tools interactively
```

```
src/
  index.ts      CLI (stdio, auth, http)
  server.ts     MCP tool definitions
  http.ts       Streamable HTTP transport with secret-token protection
  linkedin.ts   LinkedIn REST client (Posts, Assets, Organizations, Social Actions, Reactions)
  auth.ts       OAuth 2.0 authorization-code flow with local callback
  config.ts     Token storage
  text.ts       LinkedIn "little text" escaping + hashtags
  test/         node:test suites
```

Issues and pull requests are welcome.

## License

[MIT](LICENSE) © Andreas Henkel

*Not affiliated with, endorsed or sponsored by LinkedIn Corporation or OpenAI. LinkedIn is a trademark of LinkedIn Corporation; ChatGPT is a trademark of OpenAI.*
