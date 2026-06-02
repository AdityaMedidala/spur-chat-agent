import { env } from '$env/dynamic/private';
import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';

// Minimal interface satisfied by both the real Ratelimit instance and the no-op.
type Limiter = {
	limit(key: string): Promise<{ success: boolean }>;
};

// Always allows the request through. Used when Upstash env vars are not set
// so the app runs locally and in environments without Redis configured.
const noopLimiter: Limiter = {
	limit: async () => ({ success: true })
};

function buildLimiter(): Limiter {
	const url = env.UPSTASH_REDIS_REST_URL;
	const token = env.UPSTASH_REDIS_REST_TOKEN;

	// Both vars must be present — a partial config would fail on the first call,
	// which would look like a Redis error and be logged, not silently swallowed.
	if (!url || !token) {
		return noopLimiter;
	}

	const redis = new Redis({ url, token });

	// Sliding window: allows up to 10 requests per 10-second window per IP.
	// Sliding (vs. fixed) window prevents a burst at the boundary of two windows.
	return new Ratelimit({
		redis,
		limiter: Ratelimit.slidingWindow(10, '10 s'),
		analytics: false,
		prefix: 'spur:rl'
	});
}

export const limiter = buildLimiter();
