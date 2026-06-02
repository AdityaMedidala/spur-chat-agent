import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';

export const conversations = pgTable('conversations', {
	id: uuid('id').primaryKey().defaultRandom(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const messages = pgTable('messages', {
	id: uuid('id').primaryKey().defaultRandom(),
	conversationId: uuid('conversation_id')
		.notNull()
		.references(() => conversations.id, { onDelete: 'cascade' }),
	sender: text('sender', { enum: ['user', 'ai'] }).notNull(),
	text: text('text').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
