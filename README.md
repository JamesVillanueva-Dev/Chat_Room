# Chat Room

A self-hosted chat server you run on your own machine. Rooms and direct messages,
threaded replies, reactions, full-text search, file uploads, moderation tools and
a rock paper scissors bot — served to any browser on your network.

Node + Express + Socket.IO on the back end, SQLite for storage, and a plain
ES-module front end with no build step.

---

## Quick start

```bash
npm install
npm start
```

Then open <http://localhost:3000>.

The first account you register becomes the **server admin**. Everyone else joins
as a regular user. Other devices on your network can reach the same server at
`http://<your-machine-ip>:3000`.

Requires **Node 22.5 or newer**. Nothing else to install — the database file is
created on first run at `data/chat.db`.

---

## Features

**Messaging**
- Public and private rooms, plus one-to-one direct messages
- Threaded replies with a quoted preview of the parent message
- Edit and delete your own messages (deletes are soft, so threads survive)
- Emoji reactions with a searchable picker
- `@mentions` that highlight, notify, and count separately from other unread messages
- Lightweight markdown: `**bold**`, `*italic*`, `` `code` ``, ```` ```code blocks``` ````,
  `~~strikethrough~~`, `> quotes` and links
- Link previews — the server fetches Open Graph metadata and caches it
- Image and file attachments with inline previews
- Message pinning, and full-text search across a room's history

**Rooms**
- Browse and join public rooms, or lock one behind a password
- Private rooms with shareable invite links (optional expiry and use limits)
- Per-room member list, live presence, and typing indicators
- Unread badges per room and DM, with mention counts called out separately

**People**
- Accounts with bcrypt-hashed passwords and persistent sessions
- Profiles: display name, bio, avatar (uploaded or generated from initials)
- Presence (online / away / busy / offline) with a custom status message

**Moderation**
- Three levels: regular user, room moderator, server admin
- Kick, mute, and ban — scoped to a room or the whole server
- An admin panel with live stats, user management and an audit log
- Per-user rate limiting with escalating backoff, plus a per-IP connection cap

**Client**
- Responsive layout that works down to phone widths
- Light and dark themes, following your system by default
- Desktop notifications and a sound on mentions when the tab is in the background
- Drafts survive reloads and room switches; messages typed while offline are
  queued and sent on reconnect
- Full keyboard support and screen-reader labelling

---

## Using it

### Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `Ctrl`/`⌘` + `K` | Jump to a room or person |
| `Alt` + `↑` / `↓` | Previous / next room |
| `Ctrl`/`⌘` + `F` | Search the current room |
| `/` | Open the command menu |
| `Enter` | Send |
| `Shift` + `Enter` | New line |
| `Esc` | Cancel a reply or edit, close a panel |
| `?` | Show the shortcut list |

### Slash commands

Type `/` in the composer to see the commands available to you — the menu and
`/help` are both generated from the command registry, so they always match what
the server actually accepts. Start a message with `//` to send a literal
leading slash.

| Command | Who | What it does |
| --- | --- | --- |
| `/help [command]` | everyone | List commands, or explain one |
| `/users` | everyone | Who is in this room, and their status |
| `/whois @user` | everyone | Show someone's profile |
| `/me <action>` | everyone | Send an action, e.g. `/me refills the coffee` |
| `/shrug [text]` | everyone | Append `¯\_(ツ)_/¯` to your message |
| `/status [text]` | everyone | Set the status shown next to your name |
| `/online`, `/away`, `/busy` | everyone | Set your availability |
| `/play <rock\|paper\|scissors>` | everyone | Play the bot; `/play reset` clears your score |
| `/exit` | everyone | Stop playing and clear your score |
| `/topic <text>` | moderator | Set the room topic |
| `/invite [minutes]` | moderator | Create an invite link |
| `/kick @user [reason]` | moderator | Remove someone from the room |
| `/mute @user [minutes] [reason]` | moderator | Mute (default 10 minutes) |
| `/unmute @user` | moderator | Lift a mute |
| `/ban @user [--server] [reason]` | moderator | Ban from the room; admins can add `--server` |
| `/unban @user [--server]` | moderator | Lift a ban |
| `/roomrole @user <role>` | owner | Set member / moderator / owner |

A mistyped command is refused rather than posted, so a fumbled
`/mte @bob spamming` never lands in the room as a public message.

---

## Configuration

Copy `.env.example` to `.env` and edit what you need. Every value is optional in
development; `SESSION_SECRET` is required when `NODE_ENV=production`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` enables secure cookies and asset caching |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address; `127.0.0.1` restricts to this machine |
| `TRUST_PROXY` | `0` | Set to `1` behind nginx, Caddy or a tunnel |
| `SESSION_SECRET` | dev-only value | Cookie signing key — **required in production** |
| `SESSION_MAX_AGE_DAYS` | `30` | How long a sign-in lasts |
| `SESSION_SECURE_COOKIES` | on in production | Force the `Secure` cookie flag |
| `DATABASE_PATH` | `./data/chat.db` | SQLite file location |
| `UPLOAD_DIR` | `./public/uploads` | Where attachments are stored |
| `UPLOAD_MAX_BYTES` | `10485760` | Attachment size limit (10 MB) |
| `AVATAR_MAX_BYTES` | `2097152` | Avatar size limit (2 MB) |
| `HISTORY_PAGE_SIZE` | `40` | Messages per history page |
| `MAX_MESSAGE_LENGTH` | `4000` | Longest message accepted |
| `RATE_LIMIT_WINDOW_MS` | `10000` | Rate limit window |
| `RATE_LIMIT_MAX_MESSAGES` | `10` | Messages allowed per window |
| `RATE_LIMIT_BACKOFF_MS` | `2000` | First cooldown; doubles on repeat offences |
| `RATE_LIMIT_BACKOFF_MAX_MS` | `60000` | Longest cooldown |
| `MAX_CONNECTIONS_PER_IP` | `12` | Concurrent sockets per address |
| `UNFURL_ENABLED` | `1` | Fetch link previews |
| `UNFURL_TIMEOUT_MS` | `4000` | Give up on a slow page |
| `UNFURL_CACHE_TTL_MINUTES` | `1440` | How long a preview stays cached |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info` or `debug` |
| `LOG_PRETTY` | on outside production | Human-readable logs instead of JSON |
| `METRICS_TOKEN` | unset | Bearer token allowing `/metrics` without an admin session |
| `RPS_ENABLED` | `1` | Enable the rock paper scissors bot |
| `PYTHON` | `python` | Interpreter used to run `public/RPS.py` |

Generate a session secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Running the tests

```bash
npm test                  # everything
npm run test:unit         # pure logic, no I/O
npm run test:integration  # HTTP + websocket against a real server
npm run test:smoke        # 25 concurrent clients in one room
npm run test:watch        # re-run on change
```

Tests run against an in-memory database, one per test file, so they are
isolated and need no cleanup. The suite covers the command registry, rate
limiter, validators, migration runner, SSRF protection, and end-to-end flows for
auth, rooms, messaging, search, moderation and reconnection.

---

## How it fits together

```
server.js                 entry point, graceful shutdown
src/
  config.js               environment configuration, frozen at startup
  logger.js               levelled JSON / pretty logging
  db/
    driver.js             SQLite wrapper (better-sqlite3, else node:sqlite)
    migrate.js            numbered, checksummed migration runner
    migrations/           001_initial_schema.sql, 002_message_search.sql, …
    repositories/         all SQL lives here, one module per table group
  auth/                   password hashing, SQLite session store, sign-in
  http/
    app.js                Express app, security headers, static files
    routes/               REST API
  realtime/
    index.js              Socket.IO wiring and event fan-out
    rateLimiter.js        sliding window with escalating backoff
    presence.js           who is online, across multiple tabs
    commands/             the slash-command registry and the RPS bot
  services/               chat, moderation, mentions, unfurling, metrics, events
public/
  index.html, styles.css
  js/                     ES modules, no build step
tests/                    unit, integration and smoke tests
```

**Writes flow one way.** HTTP routes and socket handlers both call the same
service layer, which announces what changed on an internal event bus; the
realtime layer is the only subscriber that turns those announcements into socket
messages. That keeps the REST API from importing Socket.IO and the socket layer
from importing the routes.

**Adding a slash command** is a single `registry.register({...})` call in
`src/realtime/commands/index.js`. Help text, the autocomplete menu and
permission checks all read from that record — there is no dispatch chain to
extend.

**Adding a schema change** means adding the next numbered file in
`src/db/migrations/`. Applied migrations are checksummed, so editing one that
has already run fails loudly instead of silently diverging between machines.

---

## Operations

- `GET /healthz` — public liveness check.
- `GET /metrics` — connection counts, messages per minute, rate-limit hits,
  memory and database totals. Requires an admin session, or a `METRICS_TOKEN`
  bearer token if you have set one.
- `SIGINT` / `SIGTERM` trigger a graceful shutdown: clients are told the server
  is restarting, sockets and the database close cleanly, and presence is reset.
- Logs are JSON lines in production and human-readable elsewhere.

### Database driver

The data layer prefers [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3),
but that is a native addon needing a C++ toolchain when no prebuilt binary
matches your Node version. Since Node 22.5 ships an equivalent synchronous
engine, `src/db/driver.js` falls back to the built-in `node:sqlite` so a
compiler is never a requirement. To use `better-sqlite3`, just install it:

```bash
npm install better-sqlite3
```

No code changes needed — the driver picks it up automatically.

---

## Security notes

Worth knowing if you expose this beyond your own network:

- Passwords are bcrypt hashed. A sign-in for an unknown username still performs
  a hash comparison so response timing does not reveal which accounts exist.
- Sessions are stored server-side in SQLite, regenerated on sign-in to prevent
  fixation, and destroyed immediately when an account is banned.
- The client builds every message node with `createElement` and `textContent`.
  No user content is ever turned into HTML, so message text cannot introduce
  markup. Links are restricted to `http`/`https`.
- A Content Security Policy blocks inline and third-party scripts.
- Uploads are stored under generated filenames, checked against both MIME type
  and extension, and served with `nosniff`. Anything that is not a known image
  type is sent as a download. SVG is deliberately not accepted, since it can
  carry script.
- Link unfurling resolves each hostname and refuses private, loopback and
  link-local addresses, including across redirects, so a pasted URL cannot make
  the server probe your internal network.
- Full-text search input is stripped of FTS operators before it reaches SQLite.
- Failed sign-ins are throttled per address; messages and commands have separate
  rate-limit budgets with escalating cooldowns.

This is built for a trusted network. Put it behind HTTPS with `TRUST_PROXY=1`
and a real `SESSION_SECRET` before putting it on the public internet.
