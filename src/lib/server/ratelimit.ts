import { env } from '$env/dynamic/private';
import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';

// Minimal interface satisfied by both the real Ratelimit instance and the no-op.
// remaining and limit are optional so noopLimiter can omit them.
type Limiter = {
	limit(key: string): Promise<{ success: boolean; remaining?: number; limit?: number }>;
};

// Always allows the request through. Used when Upstash env vars are not set
// so the app runs locally and in environments without Redis configured.
const noopLimiter: Limiter = {
	limit: async () => {
		console.log('[ratelimit] no-op mode (UPSTASH env vars not set)');
		return { success: true };
	}
};

function buildLimiter(): Limiter {
	const url = env.UPSTASH_REDIS_REST_URL;
	const token = env.UPSTASH_REDIS_REST_TOKEN;

	// Both vars must be present — a partial config would fail on the first call,
	// which would look like a Redis error and be logged, not silently swallowed.
	if (!url || !token) {
		console.log('[ratelimit] UPSTASH vars absent — using no-op limiter');
		return noopLimiter;
	}

	const redis = new Redis({ url, token });

	// Sliding window: allows up to 10 requests per 10-second window per IP.
	// Sliding (vs. fixed) window prevents a burst at the boundary of two windows.
	const instance = new Ratelimit({
		redis,
		limiter: Ratelimit.fixedWindow(3, '10 s'),
		analytics: false,
		prefix: 'spur:rl'
	});

	// This log confirms the module was (re-)evaluated and which window is active.
	// Remove after confirming 429 behaviour works in production.
	console.log('[ratelimit] Redis limiter initialised — fixedWindow(3, "10 s")');

	return instance;
}

export const limiter = buildLimiter();
