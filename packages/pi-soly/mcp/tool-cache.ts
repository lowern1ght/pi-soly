// =============================================================================
// mcp/tool-cache.ts — in-memory TTL cache for MCP tool call results
// =============================================================================
//
// Lives once per MCP session, cleared on session_shutdown. Keyed by
// `${server}:${tool}:${stableStringify(args)}`. Only successful tool results
// are stored; errors, auth-required, init failures, UI tools, and resource
// reads are never cached (UI tools have side effects, resources may be large
// and the user explicitly asked for "тулзы" only).
//
// Stats (hits/misses/expirations) are tracked for future observability but
// not surfaced yet — kept internal until a user-facing surface exists.
// =============================================================================

/** A single cache entry with absolute expiry timestamp. */
type CacheEntry = {
	value: unknown;
	expiresAt: number;
};

/** Snapshot of cache counters — for tests and future telemetry. */
export type CacheStats = {
	size: number;
	hits: number;
	misses: number;
	expirations: number;
};

/** In-memory TTL cache for MCP tool results. Not thread-safe (single-threaded JS). */
export class ToolCache {
	private readonly entries = new Map<string, CacheEntry>();
	private hits = 0;
	private misses = 0;
	private expirations = 0;

	constructor(
		private readonly defaultTtlMs: number,
		private readonly now: () => number = Date.now,
		/** Fires after every get/set/clear/invalidateServer/delete so the
		 *  caller can refresh the footer or telemetry. Fired before the
		 *  function returns, never throws — UI work must not crash the cache. */
		private readonly onChange?: () => void,
	) {}

	private notify(): void {
		if (!this.onChange) return;
		try { this.onChange(); } catch { /* UI refresh must never break the cache */ }
	}

	/** Return the cached value if present and not expired; otherwise undefined. */
	get(key: string): unknown | undefined {
		const entry = this.entries.get(key);
		if (!entry) {
			this.misses++;
			this.notify();
			return undefined;
		}
		if (this.now() >= entry.expiresAt) {
			this.entries.delete(key);
			this.expirations++;
			this.misses++;
			this.notify();
			return undefined;
		}
		this.hits++;
		this.notify();
		return entry.value;
	}

	/** Store `value` under `key`, overwriting any prior entry. */
	set(key: string, value: unknown, ttlMs?: number): void {
		this.entries.set(key, {
			value,
			expiresAt: this.now() + (ttlMs ?? this.defaultTtlMs),
		});
		this.notify();
	}

	/** Remove a single entry; returns true if it existed. */
	delete(key: string): boolean {
		const existed = this.entries.delete(key);
		if (existed) this.notify();
		return existed;
	}

	/** Drop every cached entry. Called on session_shutdown. */
	clear(): void {
		const had = this.entries.size > 0;
		this.entries.clear();
		if (had) this.notify();
	}

	/** Drop every entry belonging to a server (e.g. after a reconnect invalidates them). */
	invalidateServer(serverName: string): void {
		const prefix = `${serverName}:`;
		let removed = 0;
		for (const key of [...this.entries.keys()]) {
			if (key.startsWith(prefix)) {
				this.entries.delete(key);
				removed++;
			}
		}
		if (removed > 0) this.notify();
	}

	stats(): CacheStats {
		return {
			size: this.entries.size,
			hits: this.hits,
			misses: this.misses,
			expirations: this.expirations,
		};
	}
}

/**
 * Stable JSON serialization: object keys are sorted recursively, so two
 * structurally-equal arguments always produce the same string regardless of
 * the original insertion order. Required for a correct cache key.
 */
export function stableStringify(value: unknown): string {
	if (value === null) return "null";
	if (typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) {
		return "[" + value.map(stableStringify).join(",") + "]";
	}
	const obj = value as Record<string, unknown>;
	const keys = Object.keys(obj).sort();
	return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

/** Build a deterministic cache key for an MCP tool call. */
export function cacheKey(serverName: string, toolName: string, args: unknown): string {
	return `${serverName}:${toolName}:${stableStringify(args ?? {})}`;
}