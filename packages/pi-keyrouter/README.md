# 🔑 pi-keyrouter

**API key rotation for [pi-coding-agent](https://github.com/nicobailon/pi-coding-agent).**

Multiple keys per provider · automatic 429/401 fallback · recursion-safe.

```bash
pi install npm:pi-keyrouter
# create ~/.pi/keyrouter.json with your keys
/reload
```

When your model returns 429 (rate-limited) or 401 (unauthorized), the next key is picked automatically. pi sees a single successful response — retries are transparent.

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

`/reload` — extension wraps `globalThis.fetch` and rotates on 429/401.

---

## 🎯 How it works

1. **Install** — extension loads, reads config, wraps `fetch`.
2. **Request** — URL matches a provider → key picked, `Authorization: Bearer <key>` set.
3. **On 429 / 401** — current key marked bad (cooldown `cooldownMs`), next key tried.
4. **On 200** — response returned, key marked OK.
5. **After `maxRetries`** — last failed response returned (so pi sees the real error).

Recursion is bounded by `maxRetries` (default 3). No infinite loops.

### What gets rotated

| Status | Action |
|---|---|
| 200 | Return response, mark key OK |
| 429 | Mark key `rate-limited` (cooldown), try next |
| 401 / 403 | Mark key `unauthorized` (cooldown), try next |
| 5xx / network | Don't mark key bad — try next, but no cooldown |
| `maxRetries` exhausted | Return last failed response |

---

## 📊 Visibility

The `/keyrouter` command shows live state:

```bash
/keyrouter
```

```
🔑 keyrouter: active
  z-ai (current: backup)
    • primary  uses=12 fails=2 status=rate-limited ⏱ 47s
    • backup   uses=2  fails=0 status=ok
```

Subcommands:

- `/keyrouter status` — show snapshot (default)
- `/keyrouter enable` — re-activate (if disabled)
- `/keyrouter disable` — restore original fetch, stop rotating
- `/keyrouter reload` — re-read config

Every key switch notifies the user with a Box widget:

> 🔑 keyrouter: z-ai — primary → backup (HTTP 429, attempt 1)

---

## 🔧 Config

`~/.pi/keyrouter.json` (or `<cwd>/.soly/keyrouter.json`, `<cwd>/.pi/keyrouter.json`).

```json5
{
  "providers": [
    {
      "name": "display-name",          // for logs (any string)
      "match": ["api.z.ai", "z.ai"],   // URL substrings (case-insensitive)
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

### Multi-provider

```json
{
  "providers": [
    { "name": "z-ai",       "match": ["api.z.ai"], "keys": [...] },
    { "name": "openrouter", "match": ["openrouter.ai"], "keys": [...] }
  ]
}
```

Each provider rotates independently. Cross-provider URLs are not intercepted.

---

## 🛡️ Security

API keys live in plain text in `keyrouter.json`. **Don't commit it.** Options:

- Add `keyrouter.json` to `.gitignore`
- Use `chmod 600` on the file
- (Future) env var interpolation `$ENV_VAR` — not yet implemented

---

## 🛠 Development

```bash
bun test          # 34 tests
bun run typecheck # tsc --noEmit
```

Monorepo layout:

```
packages/pi-keyrouter/
├── index.ts          — extension entry point
├── rotation.ts       — pure key-pick logic
├── fetch-wrapper.ts  — fetch interceptor with retry
├── config.ts         — config loader
├── types.ts          — shared types
└── tests/
    ├── rotation.test.ts      — pure logic
    ├── fetch-wrapper.test.ts — integration with mocked fetch
    ├── config.test.ts        — config loader
    └── smoke.test.ts         — load-time smoke test
```

---

## 📜 License

MIT — same as [pi-soly](https://github.com/lowern1ght/pi-soly).