// =============================================================================
// types.ts — shared types for pi-keyrouter
// =============================================================================

/** A single API key entry. `name` is for logging; `value` is the literal key. */
export interface ApiKey {
  name: string;
  value: string;
}

/** Configuration for a single provider. */
export interface ProviderConfig {
  /** Display name (e.g. "z-ai", "openrouter"). For logging. */
  name: string;
  /** URL substrings to match. If request URL contains any of these, the
   *  wrapper handles it. Match is case-insensitive. */
  match: string[];
  /** Ordered list of keys. First key used by default; on 429/401, rotate. */
  keys: ApiKey[];
}

/** Top-level config. */
export interface KeyRouterConfig {
  providers: ProviderConfig[];
  /** Max number of retries across all keys per request. Default 3. */
  maxRetries: number;
  /** How long a key is marked bad after 429 (ms). Default 60_000. */
  cooldownMs: number;
}

/** Internal state for a key (not user-configurable). */
export interface KeyState {
  name: string;
  value: string;
  /** Last status we saw from this key. */
  lastStatus: "ok" | "rate-limited" | "unauthorized" | "untried";
  /** Epoch ms when this key's bad-status expires. 0 = available. */
  cooldownUntil: number;
  /** How many times this key has been used (for diagnostics). */
  uses: number;
  /** How many times this key has returned 429/401. */
  failures: number;
}

/** Reason we rotated to a new key. */
export type RotationReason = "rate-limited" | "unauthorized";

/** Event payload for `onRotate` callback. */
export interface RotationEvent {
  provider: string;
  fromKey: string;
  toKey: string;
  reason: RotationReason;
  status: number;
  attempt: number;
}