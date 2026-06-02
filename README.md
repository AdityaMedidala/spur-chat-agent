# Spur Take-Home — AI Live Chat Support Agent

## Overview

A minimal AI-powered customer support chat built as part of the Spur founding engineer take-home. Users open a web page and chat with **Aria**, a support agent for a fictional home-goods store called Maple & Co. Every message is persisted to Postgres with a session ID stored in a cookie, so conversations survive page reloads. The backend calls Anthropic's Claude API to generate responses, with store-specific knowledge (shipping, returns, support hours) baked into the system prompt.

**Deployed:** `<YOUR_DEPLOYED_URL_HERE>`

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | SvelteKit (TypeScript) — single app serving both the UI and all API endpoints |
| Database | PostgreSQL via [Neon](https://neon.tech), accessed with [Drizzle ORM](https://orm.drizzle.team) |
| LLM | Anthropic Claude (`claude-sonnet-4-6`) via the official `@anthropic-ai/sdk` |
| Rate limiting | [Upstash Redis](https://upstash.com) + `@upstash/ratelimit` (optional) |
| Styling | Tailwind CSS v4 |

---

## Run Locally

**Prerequisites:** Node.js ≥ 18, a Neon database, and an Anthropic API key.

```bash
# 1. Clone
git clone <repo-url>
cd spur-chat-agent

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp .env.example .env
# Edit .env and fill in DATABASE_URL and ANTHROPIC_API_KEY

# 4. Push the schema to your database
npx drizzle-kit push

# 5. Start the development server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

---

## Database Setup

1. Create a free project at [neon.tech](https://neon.tech).
2. Copy the **connection string** from the Neon dashboard (use the HTTP/serverless connection string, not the pooled TCP one).
3. Paste it as `DATABASE_URL` in your `.env`.
4. Run the migration:

```bash
npx drizzle-kit push
```

This creates two tables in your Neon database:

| Table | Columns |
|---|---|
| `conversations` | `id` (uuid PK), `created_at` |
| `messages` | `id` (uuid PK), `conversation_id` (FK), `sender` (`user`\|`ai`), `text`, `created_at` |

---

## Environment Variables

Copy `.env.example` to `.env` and fill in the required values. The `.env` file is gitignored and must never be committed.

```
# Required
DATABASE_URL=               # Neon HTTP connection string
ANTHROPIC_API_KEY=          # Anthropic API key (https://console.anthropic.com)

# Optional — rate limiting (app runs fine without these)
UPSTASH_REDIS_REST_URL=     # Upstash Redis REST URL
UPSTASH_REDIS_REST_TOKEN=   # Upstash Redis REST token
```

`DATABASE_URL` and `ANTHROPIC_API_KEY` are validated at server startup — the app throws immediately with a clear message if either is missing. The Upstash variables are optional; if absent the rate limiter is replaced with a no-op and all requests proceed normally.

---

## Architecture Overview

```
src/
├── routes/
│   ├── +page.svelte              # Chat UI
│   ├── +page.server.ts           # Load: reads session cookie, returns conversation
│   │                             # history as initial page data
│   └── chat/
│       ├── message/
│       │   └── +server.ts        # POST /chat/message — validates input,
│       │                         # persists messages, calls LLM, sets cookie
│       └── new/
│           └── +server.ts        # POST /chat/new — clears session cookie
│
└── lib/
    ├── components/               # UI: MessageBubble, TypingIndicator, InputBar
    │
    └── server/                   # Server-only — never bundled to the client
        ├── llm.ts                # generateReply(history, userMessage) → string
        ├── session.ts            # Shared SESSION_COOKIE constant
        ├── ratelimit.ts          # Upstash sliding-window limiter, or no-op if
        │                         # env vars are absent
        └── db/
            ├── client.ts         # Drizzle + Neon HTTP client
            ├── schema.ts         # Table definitions and inferred types
            └── queries.ts        # createConversation, getMessages, addMessage, …
```

**Separation of concerns:** routes handle HTTP concerns (parsing, cookies, status codes), `lib/server/llm.ts` owns everything LLM-related, and `lib/server/db/` owns all database access. Neither the LLM layer nor the DB layer knows about each other — the route calls both and assembles the response.

**Plugging in additional channels (WhatsApp, Instagram, etc.):** `generateReply` and the DB helpers are channel-agnostic. Adding a WhatsApp webhook means creating a new route that validates the inbound payload, maps it to `{ sender, text }`, and calls the same `generateReply` + `addMessage` functions. The LLM and DB layers need no changes.

---

## LLM Notes

**Provider:** Anthropic Claude
**Model:** `claude-sonnet-4-6`

**Prompting approach:**
- A hardcoded system prompt establishes Aria's persona and embeds the store's FAQ knowledge base (shipping costs and timelines, return policy, support hours, order issues). Hardcoding keeps latency low and eliminates a retrieval step.
- The last 10 messages from the conversation are sent as context so replies are coherent across turns. The cap keeps token spend predictable regardless of conversation length.
- Strict role alternation is enforced before sending history to the API — consecutive same-role entries (which can appear after a failed LLM turn) are trimmed rather than causing a 400.
- `max_tokens` is capped at 512, sufficient for support answers and a predictable cost ceiling.

**Guardrails:**
- A 20-second request timeout surfaces as `APIConnectionTimeoutError`.
- All Anthropic error classes (timeout, rate limit, auth failure, generic API error) are caught individually, logged server-side with diagnostic detail, and converted to a single friendly fallback string returned to the user. The route never receives a thrown exception from the LLM layer.

---

## Robustness

- **Empty messages** are rejected with a 400 before reaching the DB or LLM.
- **Very long messages** are silently truncated to 4 000 characters and still processed ("truncate / warn / still work").
- **Invalid or stale session IDs** (fabricated cookie, expired conversation) are validated against the DB; if not found, a new conversation is created rather than returning an error.
- **User message persisted before LLM call** — if the LLM fails, the user's message is still recorded and a friendly error reply is returned. No silent data loss on failure.
- **New Chat** calls `POST /chat/new` server-side to delete the session cookie before clearing local state, so a page reload after New Chat correctly shows an empty conversation.
- **Unexpected server errors** are caught by a top-level try/catch in each route handler and returned as a clean JSON 500 — no stack traces reach the client.
- **Rate limiting** on `POST /chat/message` uses Upstash Redis sliding window (10 requests / 10 s per IP). The limiter is **fail-open**: if Redis is unreachable the error is logged and the request proceeds. If the Upstash env vars are not set, the limiter is a no-op and all requests are allowed through — the app is fully functional without Redis configured.

---

## Trade-offs & If I Had More Time

**Streaming**
Chose simple `POST → JSON` over SSE token streaming. It maps cleanly to the persist-then-reply flow and is easier to reason about. Streaming would improve perceived latency on longer replies and is the obvious next step.

**Authentication**
Sessions are anonymous cookies. For a real product you'd want user identity so conversation history persists across devices and can be scoped to a customer account.

**Redis session cache**
Each request re-queries the DB to validate the session ID. A Redis cache in front of `conversationExists` would eliminate that round-trip for active sessions.

**FAQ retrieval vs. prompt injection**
Store knowledge is hardcoded in the system prompt. For a larger or frequently-changing knowledge base, a retrieval step (embeddings + vector search) would keep the prompt concise and let the knowledge be updated without redeployment.

**UI polish**
The interface is functional and intentional but not production-grade. Given more time: message timestamps, copy-to-clipboard on AI responses, an error retry button, and a proper accessibility audit.

**Test coverage**
No automated tests. Priority additions: unit tests for `buildMessages` (role-alternation edge cases), `generateReply` error branches, and the route's input validation paths.
