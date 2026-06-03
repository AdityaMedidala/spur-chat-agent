# spur-chat-agent

> AI live-chat support agent — SvelteKit · Anthropic Claude · Neon Postgres · SSE streaming

**Live demo:** https://spur-chat-agent-bice.vercel.app/

Chat with **Aria**, a support agent for **Maple & Co.** (a fictional home-goods store). Replies stream in token-by-token, persist to Postgres, and survive a page reload — no login required.

---

## What it does

- **Streaming replies** — responses arrive token-by-token over SSE, with a live cursor while Aria types
- **Persistent conversations** — a session cookie links your chat to a DB conversation; reload and your history is still there
- **Graceful failure** — a mid-stream error becomes an error bubble with a one-click retry, never a stuck spinner
- **Rate limiting** — sliding-window per-IP limiter via Upstash Redis; optional, and degrades to a no-op if not configured
- **Safe rendering** — AI replies are converted and sanitized server-side (marked → sanitize-html) before they're stored or shown, so there's no client-side XSS surface

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | SvelteKit 2 — TypeScript, Svelte 5 runes |
| Database | PostgreSQL via [Neon](https://neon.tech) (HTTP/serverless) + [Drizzle ORM](https://orm.drizzle.team) |
| LLM | Anthropic Claude `claude-sonnet-4-6` — token streaming |
| Rate limiting | [Upstash Redis](https://upstash.com) + `@upstash/ratelimit` (optional) |
| Styling | Tailwind CSS v4 |
| Deployment | Vercel (`adapter-vercel`) |

---

## Run locally

You'll need Node ≥ 18, a [Neon](https://neon.tech) database, and an [Anthropic](https://console.anthropic.com) API key.

```bash
git clone https://github.com/AdityaMedidala/spur-chat-agent
cd spur-chat-agent
npm install

cp .env.example .env
# fill in DATABASE_URL and ANTHROPIC_API_KEY

npx drizzle-kit push   # create the tables in Neon
npm run dev            # http://localhost:5173
```

> Use Neon's **HTTP/serverless** connection string, not the pooled TCP one — the app talks to Neon over HTTP (`@neondatabase/serverless`), which is what Vercel's stateless runtime needs.

---

## Environment variables

```bash
# Required
DATABASE_URL=            # Neon HTTP connection string
ANTHROPIC_API_KEY=       # Anthropic API key

# Optional — the app runs fine without these (rate limiter becomes a no-op)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

The two required variables are checked at startup — the server fails fast with a clear message if either is missing. The Upstash pair is optional; without it, rate limiting quietly turns off and every request passes through.

---

## Architecture

A single SvelteKit app serves both the UI and the API. Three layers, cleanly separated: routes handle HTTP, `lib/server/llm.ts` owns the model, `lib/server/db/` owns persistence — and the LLM and DB layers don't know HTTP exists.

### Request flow

```
Browser
  │
  ├─ POST /chat/message ──────────────────────────────────────────────────
  │     │
  │     ├─ [Upstash] sliding-window rate limit   ← fails open if absent
  │     ├─ validate + truncate input             (400 on empty/bad message)
  │     ├─ resolve or create conversation         (UUID cookie ↔ Neon)
  │     ├─ persist user message
  │     ├─ fetch last 10 messages for context
  │     │
  │     ├─ streamReply() ─→ Anthropic (Claude streaming)
  │     │        text deltas
  │     │           └─→  SSE token events  ───────────────→  Browser
  │     │                                                  (live cursor)
  │     │
  │     ├─ accumulate full text → marked → sanitize-html
  │     ├─ persist sanitized reply
  │     └─ SSE done { html, sessionId } ──────────────────→  Browser
  │                                                        (swap to final bubble)
  │
  ├─ GET /  (page load) ──── read cookie → load history → SSR
  │
  └─ POST /chat/new ──────── delete session cookie (server-side)
```

### Project layout

```
src/
├── routes/
│   ├── +page.svelte             # UI + SSE reader / streaming state
│   ├── +page.server.ts          # session resolution, history load (SSR)
│   └── chat/
│       ├── message/+server.ts   # POST: rate limit → validate → stream
│       └── new/+server.ts       # POST: clear session cookie
│
└── lib/server/
    ├── llm.ts                   # streamReply(), buildMessages(), error handling
    ├── sanitize.ts              # marked → sanitize-html pipeline
    ├── ratelimit.ts             # Upstash limiter + no-op fallback
    ├── session.ts               # cookie name + UUID validation
    └── db/
        ├── schema.ts            # Drizzle tables + inferred types
        ├── client.ts            # Neon HTTP client
        └── queries.ts           # typed query helpers
```

Because the model and DB layers are channel-agnostic, adding a WhatsApp or Instagram webhook is just a new route that calls the same `streamReply()` and `addMessage()` — the core logic doesn't change.

---

## LLM design

**Model:** `claude-sonnet-4-6`, capped at `max_tokens: 512` for a predictable cost ceiling.

**Streaming.** `client.messages.stream()` emits text deltas, which the route forwards as SSE `token` events. The full text is only sanitized and persisted once the stream completes — so a half-finished reply never ends up in the database.

**Prompt.** A hardcoded system prompt gives Aria her persona plus the Maple & Co. facts (shipping, returns, support hours). No retrieval step — it keeps latency predictable and the logic easy to follow.

**Context.** The last 10 messages go to the API. `buildMessages()` enforces strict user/assistant alternation — it dedupes consecutive same-role turns and trims a trailing user turn before appending the new one, which avoids the 400s Anthropic returns on malformed history.

**Errors.** Timeout, rate-limit, auth, and generic API errors are each caught and logged server-side with a distinct message. `streamReply()` re-throws so the route can emit an SSE `error` event — raw error details never reach the browser.

---

## Robustness

| Scenario | Behaviour |
|---|---|
| Empty / whitespace-only message | 400 before the DB or LLM is touched |
| Message over 4,000 chars | Truncated, still processed |
| Invalid or stale session cookie | UUID-checked, then DB-checked; a new conversation is created if it doesn't resolve |
| LLM timeout / rate limit / bad key | Friendly error bubble + retry |
| Mid-stream LLM failure | SSE `error` event; partial content is **not** persisted |
| Redis unreachable | Limiter fails open; request proceeds |
| Client network failure | `fetch` catch → error bubble + retry |
| Malformed JSON body | 400 with a specific message |
| Unexpected server error | Top-level catch → clean JSON 500, no stack trace |

---

## Trade-offs & what I'd do next

**Orphaned user messages.** The user's turn is saved *before* the LLM call — deliberately, so nothing is lost on failure. The downside: if the stream errors, that row exists with no reply and reappears on reload. I'd wrap both inserts in a transaction, or hold the user message until the reply lands.

**Auth.** Conversations are anonymous cookies. A real product needs identity for cross-device history and agent handoff.

**Redis session cache.** Every request validates the session with a DB round-trip; a cache in front of `conversationExists()` would remove it. (Separate from the Upstash rate-limiting Redis already in place.)

**FAQ retrieval.** Knowledge is hardcoded in the prompt. A vector store (pgvector + embeddings) would handle a bigger or changing knowledge base without a redeploy.

**Progressive markdown.** During streaming the raw token text shows (asterisks visible) until the final swap. Parsing the accumulated text per-token would render markdown live.

**Tests.** None shipped. First targets: `buildMessages()` alternation edge cases, `renderAiReply()` against XSS payloads, and the route's validation branches.