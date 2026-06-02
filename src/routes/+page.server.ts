import type { PageServerLoad } from './$types';
import { conversationExists, getMessages } from '$lib/server/db/queries';
import { SESSION_COOKIE, isValidUUID } from '$lib/server/session';

export const load: PageServerLoad = async ({ cookies }) => {
	const sessionId = cookies.get(SESSION_COOKIE);

	if (!sessionId || !isValidUUID(sessionId) || !(await conversationExists(sessionId))) {
		return { messages: [], sessionId: null };
	}

	const rows = await getMessages(sessionId);

	return {
		messages: rows.map((r) => ({
			id: r.id,
			sender: r.sender,
			text: r.text
		})),
		sessionId
	};
};
