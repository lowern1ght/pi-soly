// =============================================================================
// rotation.ts — pure key-rotation logic
// =============================================================================
//
// Decides which key to use next. No side effects, no I/O. Given a list of
// keys + their state, picks the best available one.
//
// Strategy:
// 1. Start with the first key (most recent working key takes priority).
// 2. If it's on cooldown, find the next available key.
// 3. If all keys are on cooldown, return the one that becomes available
//    soonest (may need to wait).
// 4. If there are no keys, return null.

import type { KeyState, RotationReason } from "./types.ts";

/** Build initial state from a list of key values. */
export function initKeyStates(
  keys: ReadonlyArray<{ name: string; value: string }>,
): KeyState[] {
  return keys.map((k) => ({
    name: k.name,
    value: k.value,
    lastStatus: "untried",
    cooldownUntil: 0,
    overloadedUntil: 0,
    uses: 0,
    failures: 0,
  }));
}

/** Returns true if the key is currently available (past cooldown AND
 *  not in a provider-wide overload window). */
export function isAvailable(state: KeyState, now: number): boolean {
  if (state.cooldownUntil !== 0 && state.cooldownUntil > now) return false;
  if (state.overloadedUntil !== 0 && state.overloadedUntil > now) return false;
  return true;
}

/** Returns true if this key's provider is currently marked overloaded. */
export function isOverloaded(state: KeyState, now: number): boolean {
  return state.overloadedUntil !== 0 && state.overloadedUntil > now;
}

/** Mark a key as bad for `cooldownMs`. */
export function markBad(
  state: KeyState,
  reason: RotationReason,
  cooldownMs: number,
  now: number,
): void {
  state.lastStatus = reason === "rate-limited" ? "rate-limited" : "unauthorized";
  state.cooldownUntil = now + cooldownMs;
  state.failures += 1;
}

/** Mark a key's PROVIDER as overloaded for `cooldownMs`. Provider-wide:
 *  call this on EVERY key of the affected provider so pickNextKey treats
 *  them all as unavailable until the window expires. Does NOT count as a
 *  key failure and does NOT change lastStatus. */
export function markOverloaded(state: KeyState, cooldownMs: number, now: number): void {
  state.overloadedUntil = now + cooldownMs;
}

/** Mark a key as used successfully. Clears any cooldown. */
export function markOk(state: KeyState): void {
  state.lastStatus = "ok";
  state.cooldownUntil = 0;
}

/** Record that a key was attempted (regardless of outcome). */
export function recordUse(state: KeyState): void {
  state.uses += 1;
}

/**
 * Pick the next key to try.
 *
 * Priority:
 * 1. The key at `preferredIndex` if available (used to "stick" with a key
 *    that was working — pi doesn't change keys across requests in the same
 *    turn unless we rotate).
 * 2. The next available key in rotation order.
 * 3. If all on cooldown, the one that becomes available soonest.
 *
 * Returns the picked index, or -1 if no keys.
 */
export function pickNextKey(
  states: KeyState[],
  preferredIndex: number,
  now: number,
): number {
  if (states.length === 0) return -1;

  // 1. Preferred if available
  const preferred = states[preferredIndex];
  if (preferred && isAvailable(preferred, now)) {
    return preferredIndex;
  }

  // 2. Next available in rotation order (start from preferred + 1)
  for (let offset = 1; offset <= states.length; offset++) {
    const idx = (preferredIndex + offset) % states.length;
    const s = states[idx];
    if (s && isAvailable(s, now)) {
      return idx;
    }
  }

  // 3. All on cooldown or in overload — pick the one that becomes
  //    available soonest. "Available" here means the earliest moment
  //    when EITHER cooldownUntil OR overloadedUntil clears (whichever
  //    is later defines when the key is usable again, so the soonest
  //    such moment is what we want).
  const soonest = (s: KeyState): number => {
    const cd = s.cooldownUntil;
    const ov = s.overloadedUntil;
    return Math.max(cd, ov);
  };
  let bestIdx = 0;
  let bestUntil = soonest(states[0] ?? { cooldownUntil: 0, overloadedUntil: 0 } as KeyState);
  for (let i = 1; i < states.length; i++) {
    const u = soonest(states[i] ?? { cooldownUntil: 0, overloadedUntil: 0 } as KeyState);
    if (u < bestUntil) {
      bestUntil = u;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/** Find the provider config whose `match` substrings hit the URL. */
export function matchProvider<T extends { name: string; match: string[] }>(
  providers: T[],
  url: string,
): T | undefined {
  const lower = url.toLowerCase();
  for (const p of providers) {
    for (const m of p.match) {
      if (lower.includes(m.toLowerCase())) return p;
    }
  }
  return undefined;
}

/**
 * Compute the delay (ms) to wait before the soonest key becomes available.
 * Returns 0 if at least one key is available now.
 */
export function waitForNextKey(states: KeyState[], now: number): number {
  let minWait = Number.POSITIVE_INFINITY;
  for (const s of states) {
    if (isAvailable(s, now)) return 0;
    const wait = s.cooldownUntil - now;
    if (wait < minWait) minWait = wait;
  }
  return minWait === Number.POSITIVE_INFINITY ? 0 : minWait;
}