# 🔑 pi-keyrouter

**API key rotation for [pi-coding-agent](https://github.com/nicobailon/pi-coding-agent).**

Multiple keys per provider · automatic 429/401 fallback · no fetch hacks.

```bash
pi install npm:pi-keyrouter
# create ~/.pi/keyrouter.json with your keys
/reload
```

When your model returns 429 (rate-limited) or 401 (unauthorized), pi-keyrouter applies the next key using the best mechanism available on your installed pi-coding-agent build (see [How it works](#-how-it-works)). pi's built-in retry then uses the new key automatically.

> ⚠️ **Setup requirement:** a provider you want rotated must have **no entry in `~/.pi/agent/auth.json`**. See [Setup requirement](#️-setup-requirement) below — skipping this is the #1 cause of "rotation configured but nothing happens."

---

## ⚡ Install

```bash
pi install npm:pi-keyrouter
```

Add your provider config to `~/.pi/keyrouter.json`:

```json
{
  "providers": [
    {
      "name": "z-ai",
      "match": ["api.z.ai", "z.ai"],
      "keys": [
        { "name": "primary", "value": "key-1-..." },
        { "name": "backup",  "value": "key-2-..." }
      ]
    }
  ],
  "maxRetries": 3,
  "cooldownMs": 60000
}
```

`/reload` picks up the config and starts rotating on 429/401.

---

## 🎯 How it works

pi-keyrouter listens for provider errors on `message_end` and, on a rotatable failure, applies the next key in the pool using **one of two mechanisms**, tried in this order:

1. **Native runtime override** — `ctx.modelRegistry.authStorage.setRuntimeApiKey(provider, key)`. A genuine priority-1 override, checked by pi-ai's credential resolver *before* `auth.json`. Present on `ModelRegistry` in some pi-coding-agent releases (confirmed working: `0.78.1`).
2. **Environment variable** — `process.env.<PROVIDER>_API_KEY = key` (e.g. `NVIDIA_API_KEY`, `ZAI_API_KEY`). Fallback for releases where `ModelRegistry` no longer exposes `authStorage` to extensions at all (confirmed: `0.80.10` turned `ModelRegistry` into a compatibility facade with no extension-reachable override). pi-ai reads `process.env` fresh on every request — no caching — so this takes effect on the very next retry, in the same process.

pi-keyrouter tries mechanism 1 first on every call and only falls back to mechanism 2 when it's unavailable, so the same install keeps working whether or not your pi-coding-agent build still exposes the native override. See [`docs/fix-authstorage-runtime-key-override.md`](../../docs/fix-authstorage-runtime-key-override.md) at the repo root for the full investigation, including exactly which published SDK versions expose which shape.

Flow:

1. **session_start / before_agent_start** — extension loads config and applies the first key for each managed provider.
2. **Request** — pi makes the HTTP call with the applied key.
3. **message_end (error, 429/401/403)** — extension fires, applies the next key.
4. **pi's built-in retry** — pi's retry logic (the "Retrying 3/3" you see in the UI) makes the next attempt, which now picks up the new key.
5. **Success or exhaustion** — if all keys fail, pi-keyrouter stops rotating for that request and pi surfaces the real error.

### ⚠️ Setup requirement

**A provider being rotated must have NO stored credential in `~/.pi/agent/auth.json`.** This only matters when mechanism 2 (env var) is in effect, but since which mechanism your build uses isn't something you control from config, treat it as a hard requirement for every provider you list in `keyrouter.json`.

Why: pi-ai's credential resolver checks a stored `auth.json` credential *before* the environment variable — unconditionally. If a key exists there, it always wins, and every override pi-keyrouter makes is silently ignored: **no error, no rotation, keys just never switch.** Remove that provider's entry from `auth.json` (or never add one) before configuring it here.

### Why not fetch wrapping?

An earlier version wrapped `globalThis.fetch`. It didn't work because the OpenAI SDK (used by pi-ai for z.ai and others) captures the `fetch` reference at client creation time, before extensions load. The SDK kept calling the original fetch, ignoring the wrapper. Both mechanisms above avoid this: pi owns the HTTP layer, we only change which key it picks up for the next attempt.

### What gets rotated

| Status | Action |
|---|---|
| 200 | Key marked OK |
| 429 | Current key marked `rate-limited` (cooldown), next key applied |
| 401 / 403 | Current key marked `unauthorized` (cooldown), next key applied |
| 529 / "overloaded" | Provider-wide cooldown on **all** keys — not a per-key failure, no rotation |
| All keys exhausted | pi-keyrouter stops intercepting; pi surfaces the real error |

---

## 📊 Visibility

The `/keyrouter` command shows live state:

```bash
/keyrouter
```

```
🔑 keyrouter: active
  zai (current: backup)
    • primary  uses=0 fails=2 status=rate-limited (cooldown)
    → backup   uses=0 fails=0 status=untried
```

Subcommands:

- `/keyrouter status` — show snapshot (default)
- `/keyrouter reload` — re-read `~/.pi/keyrouter.json` and reset all provider runtimes

Every key rotation notifies the user with a box widget:

> 🔑 keyrouter: zai — primary → backup (HTTP 429, attempt 1)

---

## 🔧 Config

**`~/.pi/keyrouter.json` only** (user-level, never project-scoped).

- Windows: `%USERPROFILE%\.pi\keyrouter.json`
- macOS/Linux: `~/.pi/keyrouter.json`

Config is global because API keys are personal credentials — they do not
belong inside a project directory. Project-local `keyrouter.json` files are
**deliberately ignored** (security: prevents a malicious repo from overriding
your real keys).

```json5
{
  "providers": [
    {
      "name": "z-ai",                  // display name (for logs) — resolved to
                                        // the canonical provider id internally
      "match": ["api.z.ai", "z.ai"],   // reserved for future URL-based matching;
                                        // not currently read by the extension
      "keys": [
        { "name": "primary", "value": "key-1..." },
        { "name": "backup",  "value": "key-2..." }
      ]
    }
  ],
  "maxRetries": 3,         // total retries per request across all keys
  "cooldownMs": 60000      // how long a bad key stays marked bad (1 min default)
}
```

> See [Setup requirement](#️-setup-requirement) above — remove `name`'s provider from `auth.json` before relying on rotation.

### Multi-provider

```json
{
  "providers": [
    { "name": "z-ai",       "match": ["api.z.ai"], "keys": [...] },
    { "name": "openrouter", "match": ["openrouter.ai"], "keys": [...] }
  ]
}
```

Each provider rotates independently.

---

## 🛡️ Security

API keys live in plain text in `keyrouter.json`. **Don't commit it.** Options:

- Add `keyrouter.json` to `.gitignore`
- Use `chmod 600` on the file
- (Future) env var interpolation `$ENV_VAR` — not yet implemented

---

## 🛠 Development

```bash
bun test          # unit + integration tests
bun run typecheck # tsc --noEmit
```

Monorepo layout:

```
packages/pi-keyrouter/
├── index.ts          — extension entry point (dual-path key application)
├── rotation.ts       — pure key-pick logic
├── config.ts         — config loader
├── notification.ts   — box-widget notifications
├── types.ts          — shared types
└── tests/
    ├── rotation.test.ts              — pure logic
    ├── provider-resolution.test.ts   — provider name mapping
    ├── config.test.ts                — config loader
    ├── index.test.ts                 — event handlers against a realistic ctx
    └── smoke.test.ts                 — load-time smoke test
```

---

## 📜 License

MIT — same as [pi-soly](https://github.com/lowern1ght/pi-soly).
