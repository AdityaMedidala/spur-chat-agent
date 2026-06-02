import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { SESSION_COOKIE } from '$lib/server/session';

// Clears the session cookie so the next message starts a fresh conversation
// and a page reload shows an empty chat. Path must match the path used when
// the cookie was set, otherwise Set-Cookie: Max-Age=0 targets the wrong scope.
export const POST: RequestHandler = ({ cookies }) => {
	cookies.delete(SESSION_COOKIE, { path: '/' });
	return json({ ok: true });
};
