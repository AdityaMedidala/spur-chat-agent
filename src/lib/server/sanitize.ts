import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

// Tags that standard markdown can produce. Anything outside this list is stripped.
const ALLOWED_TAGS = [
	'p', 'br', 'hr',
	'h1', 'h2', 'h3',
	'ul', 'ol', 'li',
	'blockquote',
	'pre', 'code',
	'strong', 'em',
	'a',
];

/**
 * Convert AI reply markdown → sanitized HTML, ready to persist and render
 * via {@html} without any further client-side processing.
 *
 * Sanitization happens at write-time (before addMessage) so the stored text
 * is already clean: SSR never outputs raw, unfiltered HTML.
 */
export function renderAiReply(markdown: string): string {
	const html = marked.parse(markdown, { async: false }) as string;
	return sanitizeHtml(html, {
		allowedTags: ALLOWED_TAGS,
		allowedAttributes: {
			a: ['href'],
			code: ['class'], // preserve language classes from fenced code blocks
		},
		allowedSchemes: ['http', 'https'],
	});
}
