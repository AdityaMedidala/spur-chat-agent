// Single source of truth for the session cookie name.
// Import this in every file that reads or sets the cookie — never redefine locally.
export const SESSION_COOKIE = 'spur_session_id';

// Standard UUID format: 8-4-4-4-12 hex groups, case-insensitive.
// Used to reject malformed session IDs before they reach the DB — Postgres
// throws a type error if a non-UUID string is queried against a uuid column.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUUID(value: string): boolean {
	return UUID_RE.test(value);
}
