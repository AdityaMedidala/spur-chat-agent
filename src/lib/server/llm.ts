import Anthropic from '@anthropic-ai/sdk';
import { env } from '$env/dynamic/private';

if (!env.ANTHROPIC_API_KEY) {
	throw new Error('ANTHROPIC_API_KEY is not set. Add it to your .env file.');
}

const client = new Anthropic({
	apiKey: env.ANTHROPIC_API_KEY,
	timeout: 20_000 // 20 s — surfaces as APIConnectionTimeoutError
});

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 512;
const CONTEXT_WINDOW = 10; // last N messages sent to the model

const SYSTEM_PROMPT = `\
You are Aria, a friendly and concise customer support agent for Maple & Co., \
a small online home-goods store. Answer questions clearly and helpfully. \
If a question is outside your knowledge, say so politely and offer to escalate.

STORE KNOWLEDGE BASE
====================
Shipping:
- Standard shipping: 5–7 business days, free on orders over $50, otherwise $4.99.
- Express shipping: 2 business days, $12.99 flat.
- We ship within the US only. No international shipping at this time.

Returns & Refunds:
- Items can be returned within 30 days of delivery for a full refund.
- Items must be unused and in original packaging.
- To start a return, email returns@mapleandco.com with your order number.
- Refunds are processed within 5–7 business days of receiving the return.

Support Hours:
- Monday–Friday, 9 AM – 6 PM Eastern Time.
- Weekend support is not available; emails received on weekends are answered \
the next business day.

Order Issues:
- For damaged or missing items, contact support@mapleandco.com within 7 days \
of delivery and include a photo.
- Order changes or cancellations must be requested within 1 hour of placing the order.
`;

export type HistoryItem = {
	sender: 'user' | 'ai';
	text: string;
};

// Maps our internal sender labels to Anthropic's required roles.
function toAnthropicRole(sender: 'user' | 'ai'): 'user' | 'assistant' {
	return sender === 'ai' ? 'assistant' : 'user';
}

// Anthropic requires messages to strictly alternate user/assistant.
// If history has consecutive same-role messages (edge case from a
// prior failed AI turn), drop them rather than send a malformed request.
function buildMessages(
	history: HistoryItem[],
	userMessage: string
): Anthropic.MessageParam[] {
	// Cap context to the most recent CONTEXT_WINDOW messages before appending
	// the new user turn — keeps token spend predictable.
	const recent = history.slice(-CONTEXT_WINDOW);

	const params: Anthropic.MessageParam[] = [];

	for (const item of recent) {
		const role = toAnthropicRole(item.sender);
		if (params.length > 0 && params[params.length - 1].role === role) continue;
		params.push({ role, content: item.text });
	}

	// Trim any trailing user entries that remain after dedup so the history
	// always ends on 'assistant' before we append the new user message.
	// Example: history [user A, user B] deduped to [user A] — we drop A here
	// because A had no AI reply and can't form valid context.
	while (params.length > 0 && params[params.length - 1].role === 'user') {
		params.pop();
	}

	// Now safe: params is empty or ends on 'assistant'.
	params.push({ role: 'user', content: userMessage });

	return params;
}

const FALLBACK =
	"I'm sorry, I'm having trouble responding right now. Please try again in a moment, " +
	"or email us at support@mapleandco.com and we'll get back to you shortly.";

export async function generateReply(
	history: HistoryItem[],
	userMessage: string
): Promise<string> {
	try {
		const response = await client.messages.create({
			model: MODEL,
			max_tokens: MAX_TOKENS,
			system: SYSTEM_PROMPT,
			messages: buildMessages(history, userMessage)
		});

		const block = response.content[0];
		if (block.type !== 'text') {
			console.error('[llm] Unexpected content block type:', block.type);
			return FALLBACK;
		}

		return block.text;
	} catch (err) {
		// Log server-side with enough detail to diagnose, but never expose
		// raw error messages (which may contain key fragments) to the client.
		if (err instanceof Anthropic.APIConnectionTimeoutError) {
			console.error('[llm] Request timed out after 20 s');
		} else if (err instanceof Anthropic.RateLimitError) {
			console.error('[llm] Rate limit hit:', err.status);
		} else if (err instanceof Anthropic.AuthenticationError) {
			console.error('[llm] Bad API key — check ANTHROPIC_API_KEY');
		} else if (err instanceof Anthropic.APIError) {
			console.error('[llm] API error:', err.status, err.message);
		} else {
			console.error('[llm] Unexpected error:', err);
		}

		return FALLBACK;
	}
}
