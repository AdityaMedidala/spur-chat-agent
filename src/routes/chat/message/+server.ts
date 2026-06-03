import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import {
	createConversation,
	conversationExists,
	getMessages,
	addMessage
} from '$lib/server/db/queries';
import { generateReply } from '$lib/server/llm';
import { SESSION_COOKIE, isValidUUID } from '$lib/server/session';
import { limiter } from '$lib/server/ratelimit';

const MESSAGE_MAX_LENGTH = 4000;

// Cookie options — httpOnly prevents JS access; SameSite=strict is sufficient
// since we have no cross-origin POST flows.
const COOKIE_OPTIONS = {
	path: '/',
	httpOnly: true,
	sameSite: 'strict' as const,
	maxAge: 60 * 60 * 24 * 30 // 30 days
};

export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
	try {
		// ── 0. Rate limiting ─────────────────────────────────────────────────────
		// Fail open: a Redis error logs server-side but never blocks the request.
		// The limiter is a no-op when Upstash env vars are absent.
		try {
			const ip = getClientAddress();
			const result = await limiter.limit(ip);
			if (!result.success) {
				return json(
					{ error: 'Too many requests. Please slow down and try again in a moment.' },
					{ status: 429 }
				);
			}
		} catch (err) {
			console.error('[ratelimit] Redis unreachable, failing open:', err);
		}

		// ── 1. Parse body ────────────────────────────────────────────────────────
		let body: unknown;
		try {
			body = await request.json();
		} catch {
			return json({ error: 'Request body must be valid JSON.' }, { status: 400 });
		}

		if (typeof body !== 'object' || body === null || Array.isArray(body)) {
			return json({ error: 'Request body must be a JSON object.' }, { status: 400 });
		}

		// ── 2. Validate message ──────────────────────────────────────────────────
		const raw = (body as Record<string, unknown>).message;

		if (raw === undefined || raw === null || raw === '') {
			return json({ error: 'message is required.' }, { status: 400 });
		}

		if (typeof raw !== 'string') {
			return json({ error: 'message must be a string.' }, { status: 400 });
		}

		if (raw.trim() === '') {
			return json({ error: 'message must not be blank.' }, { status: 400 });
		}

		// Truncate silently — still process, just cap the input.
		const message = raw.slice(0, MESSAGE_MAX_LENGTH);

		// ── 3. Resolve session ───────────────────────────────────────────────────
		// Prefer body-supplied sessionId, fall back to cookie. Validate either
		// against the DB before trusting — a stale / fabricated id gets a new
		// conversation rather than a 404 or crash.
		const candidateId =
			typeof (body as Record<string, unknown>).sessionId === 'string'
				? ((body as Record<string, unknown>).sessionId as string)
				: cookies.get(SESSION_COOKIE);

		let sessionId: string;

		if (candidateId && isValidUUID(candidateId) && (await conversationExists(candidateId))) {
			sessionId = candidateId;
		} else {
			sessionId = await createConversation();
		}

		// ── 4. Persist user message first ────────────────────────────────────────
		// Saved before the LLM call so that even on LLM failure we have a record
		// of what the user asked.
		await addMessage(sessionId, 'user', message);

		// ── 5. Fetch history and generate reply ──────────────────────────────────
		// getMessages returns rows ordered oldest-first; map to HistoryItem shape.
		// We exclude the message we just inserted — generateReply receives it as
		// the separate `userMessage` argument, not inside `history`, so it isn't
		// double-counted.
		const rows = await getMessages(sessionId);
		const history = rows
			.slice(0, -1) // drop the user message we just persisted
			.map((r) => ({ sender: r.sender, text: r.text }));

		// generateReply never throws — returns a friendly string on any error.
		const reply = await generateReply(history, message);

		// ── 6. Persist AI reply ──────────────────────────────────────────────────
		await addMessage(sessionId, 'ai', reply);

		// ── 7. Set cookie and respond ────────────────────────────────────────────
		cookies.set(SESSION_COOKIE, sessionId, COOKIE_OPTIONS);

		return json({ reply, sessionId });
	} catch (err) {
		// Outer catch: unexpected errors (DB down, import failure, etc.).
		// Log server-side, never expose internals to the client.
		console.error('[POST /chat/message] Unexpected error:', err);
		return json(
			{ error: 'Something went wrong on our end. Please try again.' },
			{ status: 500 }
		);
	}
};
