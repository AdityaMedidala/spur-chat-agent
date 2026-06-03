import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import {
	createConversation,
	conversationExists,
	getMessages,
	addMessage
} from '$lib/server/db/queries';
import { streamReply } from '$lib/server/llm';
import { renderAiReply } from '$lib/server/sanitize';
import { SESSION_COOKIE, isValidUUID } from '$lib/server/session';
import { limiter } from '$lib/server/ratelimit';

const MESSAGE_MAX_LENGTH = 4000;

// Cookie options — matches COOKIE_OPTIONS used previously, but we construct
// the Set-Cookie header manually to support streaming (raw Response) responses.
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days in seconds

function sessionCookieHeader(sessionId: string): string {
	return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE}`;
}

// SSE helper — encodes one event as UTF-8 bytes.
const encoder = new TextEncoder();
function sseEvent(data: object): Uint8Array {
	return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}

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

		// ── 5. Fetch history for context ─────────────────────────────────────────
		const rows = await getMessages(sessionId);
		const history = rows
			.slice(0, -1) // drop the user message we just persisted
			.map((r) => ({ sender: r.sender, text: r.text }));

		// ── 6. Stream LLM reply via SSE ──────────────────────────────────────────
		// We know the sessionId before streaming starts, so the Set-Cookie header
		// can be sent upfront with the response headers (before any body bytes).
		const body_ = new ReadableStream<Uint8Array>({
			async start(controller) {
				let fullText = '';

				try {
					for await (const chunk of streamReply(history, message)) {
						fullText += chunk;
						controller.enqueue(sseEvent({ type: 'token', text: chunk }));
					}

					// Stream completed successfully — sanitize, persist, respond.
					const html = renderAiReply(fullText);
					await addMessage(sessionId, 'ai', html);
					controller.enqueue(sseEvent({ type: 'done', html, sessionId }));
				} catch (err) {
					// Mid-stream LLM error. We do NOT persist incomplete content.
					// streamReply already logged the specific error type.
					console.error('[POST /chat/message] Stream error:', err);
					controller.enqueue(
						sseEvent({
							type: 'error',
							message:
								"I'm sorry, I'm having trouble responding right now. " +
								'Please try again in a moment, or email us at support@mapleandco.com.'
						})
					);
				} finally {
					controller.close();
				}
			}
		});

		return new Response(body_, {
			status: 200,
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				'Connection': 'keep-alive',
				'X-Accel-Buffering': 'no', // disable nginx buffering on proxied deployments
				'Set-Cookie': sessionCookieHeader(sessionId)
			}
		});
	} catch (err) {
		// Outer catch: unexpected errors (DB down, session logic, etc.).
		// Log server-side, never expose internals to the client.
		console.error('[POST /chat/message] Unexpected error:', err);
		return json(
			{ error: 'Something went wrong on our end. Please try again.' },
			{ status: 500 }
		);
	}
};
