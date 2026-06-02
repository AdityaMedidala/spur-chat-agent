import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { env } from '$env/dynamic/private';
import * as schema from './schema';

// @neondatabase/serverless over HTTP — correct choice for Vercel serverless
// functions, which don't support persistent TCP connections. Each request
// opens a single HTTP call to Neon; no connection pool needed.
if (!env.DATABASE_URL) {
	throw new Error('DATABASE_URL is not set. Add it to your .env file.');
}

const sql = neon(env.DATABASE_URL);

export const db = drizzle(sql, { schema });
