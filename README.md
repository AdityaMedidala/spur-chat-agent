# spur-chat-agent

> AI live chat support agent — SvelteKit · Anthropic Claude · Neon Postgres · SSE streaming

**Live demo:** https://spur-chat-agent-bice.vercel.app/

Chat with **Aria**, a support agent for **Maple & Co.**, a fictional home-goods store. Replies stream token-by-token in real time, persist to Postgres, and survive page reloads — no login required.

---

## What it does

- **Real-time streaming replies** — responses stream token-by-token via SSE; you see a live cursor as Aria types
- **Persistent conversations** — a session cookie ties your chat to a DB conversation; reload and your history is there
- **Retry on failure** — mid-stream errors surface as an error bubble with a one-click retry button
- **Rate limiting** — sliding-window IP-based limiter (Upstash Redis, optional; degrades gracefully to no-op if absent)
- **Safe markdown rendering** — AI replies are rendered server-side (marked → sanitize-html allowlist) before being persisted and displayed

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | SvelteKit 2 — TypeScript, Svelte 5 runes |
| Database | PostgreSQL via [Neon](https://neon.tech) (HTTP/serverless) + [Drizzle ORM](https://orm.drizzle.team) |
| LLM | Anthropic Claude `claude-sonnet-4-6` — token streaming via SSE |
| Rate limiting | [Upstash Redis](https://upstash.com) + `@upstash/ratelimit` — optional |
| Styling | Tailwind CSS v4 |
| Deployment | Vercel (`adapter-vercel`) |

---

## Run locally

**Prerequisites:** Node.js ≥ 18, a [Neon](https://neon.tech) database, an [Anthropic](https://console.anthropic.com) API key.

```bash
git clone https://github.com/AdityaMedidala/spur-chat-agent
cd spur-chat-agent
npm install

cp .env.example .env
# open .env and fill in DATABASE_URL and ANTHROPIC_API_KEY

npx drizzle-kit push   # creates the tables in your Neon database
npm run dev            # starts at http://localhost:5173
```

> **Neon connection string:** use the **HTTP / serverless** string, not the pooled TCP one. The app uses `@neondatabase/serverless` over HTTP, which is required for Vercel's stateless runtime.

---

## Environment variables

```bash
# Required
DATABASE_URL=            # Neon HTTP connection string
ANTHROPIC_API_KEY=       # Anthropic API key

# Optional — app runs fine without these (rate limiter becomes a no-op)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

`DATABASE_URL` and `ANTHROPIC_API_KEY` are validated at startup — the server throws immediately with a clear message if either is missing. The Upstash variables are optional; if absent, a no-op limiter is used and all requests pass through.

---

## Architecture

### Request flow

```
Browser
  │
  ├─ POST /chat/message ──────────────────────────────────────────────────
  │     │
  │     ├─ [Upstash Redis] sliding-window rate limit  ← fail-open if absent
  │     ├─ validate & truncate input (400 on bad/empty message)
  │     ├─ resolve or create conversation  (UUID cookie ↔ Neon DB)
  │     ├─ persist user message to DB
  │     ├─ fetch last 10 messages for LLM context
  │     │
  │     ├─ streamReply() ─→ Anthropic API (Claude streaming)
  │     │       content_block_delta events
  │     │          │
  │     │          └─→  SSE token events  ──────────────────→  Browser
  │     │                                                    (live cursor)
  │     │
  │     ├─ accumulate full text → marked → sanitize-html
  │     ├─ persist sanitized AI reply to DB
  │     └─ SSE done event { html, sessionId } ────────────→  Browser
  │                                                        (swap to final bubble)
  │
  ├─ GET /  (page load) ──────────────────────────────────────────────────
  │     └─ read session cookie → fetch conversation history → SSR
  │
  └─ POST /chat/new ──────────────────────────────────────────────────────
        └─ delete session cookie (server-side)
```

### Layer separation

```
src/
├── routes/
│   ├── +page.svelte             # UI, SSE reader, streaming state machine
│   ├── +page.server.ts          # session resolution, history load (SSR)
│   └── chat/
│       ├── message/+server.ts   # POST: rate limit → validate → stream → SSE
│       └── new/+server.ts       # POST: clear session cookie
│
└── lib/server/
    ├── llm.ts                   # streamReply(), buildMessages(), error handling
    ├── sanitize.ts              # marked → sanitize-html pipeline
    ├── ratelimit.ts             # Upstash limiter + no-op fallback
    ├── session.ts               # cookie name constant + UUID validation
    └── db/
        ├── schema.ts            # Drizzle table definitions + inferred types
        ├── client.ts            # Neon HTTP client (one import, one export)
        └── queries.ts           # typed query helpers — no HTTP concerns
```

The LLM and DB layers are channel-agnostic. Adding a WhatsApp or Instagram webhook is a new route that calls the same `streamReply()` and `addMessage()` functions — no changes to the core logic.

---

## LLM design

**Model:** `claude-sonnet-4-6` · `max_tokens: 512`

**Streaming:** `client.messages.stream()` yields `content_block_delta / text_delta` events which are forwarded as SSE `token` events to the browser. The full accumulated text is sanitized and persisted only on stream completion.

**System prompt:** hardcoded Aria persona + Maple & Co. knowledge base (shipping, returns, support hours). No retrieval step — predictable latency, simple to reason about.

**Context window:** last 10 messages sent to the API. `buildMessages()` enforces strict `user / assistant` role alternation — consecutive same-role turns are deduplicated, and trailing `user` turns are trimmed before appending the new message. This prevents Anthropic API errors from malformed history.

**Error handling:** `APIConnectionTimeoutError`, `RateLimitError`, `AuthenticationError`, and `APIError` are each caught and logged server-side with distinct messages. `streamReply()` re-throws so the route emits an SSE `error` event — no raw error details ever reach the browser.

---

## Robustness

| Scenario | Behaviour |
|---|---|
| Empty / whitespace-only message | 400 before DB or LLM is touched |
| Message > 4 000 chars | Silently truncated, still processed |
| Invalid or stale session cookie | UUID-validated then DB-checked; new conversation created if not found |
| LLM timeout / rate limit / bad key | Friendly error bubble + retry button |
| Mid-stream LLM failure | SSE `error` event emitted; partial content not persisted |
| Redis unreachable | Rate limiter fails open; request proceeds normally |
| Network failure on the client | `fetch` catch block; error bubble + retry |
| Malformed JSON body | 400 with specific validation message |
| Unexpected server error | Top-level try/catch; clean JSON 500, no stack trace to client |

---

## Trade-offs & if I had more time

**Orphaned user messages** — the user turn is persisted before the LLM call (intentional, so failures are logged). If the stream errors, that row exists without an AI reply and re-appears on reload. Fix: wrap both inserts in a transaction, or persist the user message only alongside the AI reply at stream completion.

**Auth** — conversations are anonymous session cookies. A real product needs user identity for cross-device history and agent handoff context.

**Redis session cache** — every request validates the session ID with a DB round-trip. A Redis cache in front of `conversationExists()` would eliminate that (separate from the Upstash rate-limiting Redis already present).

**FAQ retrieval** — knowledge is hardcoded in the system prompt. A vector store (pgvector + embeddings) would handle a larger or frequently-changing knowledge base without redeployment.

**Progressive markdown rendering** — during streaming, raw token text is displayed (asterisks visible for bold/lists). Running `marked.parse()` on the accumulated text on each token would render markdown progressively.

**SSE utility** — the SSE buffer/parse loop in `+page.svelte` is correct but would be cleaner extracted as a `$lib/sse.ts` async-generator: `async function* readSSE(response)` yielding parsed events.

**Tests** — none shipped; priority targets would be `buildMessages()` role-alternation edge cases, `renderAiReply()` XSS scenarios, and the route's input validation branches.