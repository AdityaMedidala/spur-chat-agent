import { eq, asc } from 'drizzle-orm';
import { db } from './client';
import { conversations, messages } from './schema';
import type { Message } from './schema';

// Creates a new conversation row and returns its id.
export async function createConversation(): Promise<string> {
	const [row] = await db.insert(conversations).values({}).returning({ id: conversations.id });
	return row.id;
}

// Returns true if the given id maps to an existing conversation.
export async function conversationExists(id: string): Promise<boolean> {
	const [row] = await db
		.select({ id: conversations.id })
		.from(conversations)
		.where(eq(conversations.id, id))
		.limit(1);
	return row !== undefined;
}

// Returns all messages for a conversation ordered oldest-first.
export async function getMessages(conversationId: string): Promise<Message[]> {
	return db
		.select()
		.from(messages)
		.where(eq(messages.conversationId, conversationId))
		.orderBy(asc(messages.createdAt));
}

// Persists a single message and returns the saved row.
export async function addMessage(
	conversationId: string,
	sender: 'user' | 'ai',
	text: string
): Promise<Message> {
	const [row] = await db
		.insert(messages)
		.values({ conversationId, sender, text })
		.returning();
	return row;
}
