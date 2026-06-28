// =============================================================================
// ext-apps-bridge.ts — lazy, guarded access to @modelcontextprotocol/ext-apps
// =============================================================================
//
// `@modelcontextprotocol/ext-apps@1.7.4` (its peer is sdk `^1.29.0`, yet its
// compiled CJS `app-bridge.js` does `require("@modelcontextprotocol/sdk/types.js")`
// — a subpath sdk 1.29 no longer exposes to CJS) is currently broken upstream.
// Importing it statically threw at module-eval and crashed the whole pi agent.
//
// So we load it LAZILY, exactly once, behind a try/catch. If it loads, the MCP-UI
// (app-bridge) features work; if it can't, the cache is null and those features
// degrade gracefully (no UI resource URIs, empty iframe allow-list, fallback MIME)
// while core MCP keeps working. `preloadAppBridge()` is awaited early in MCP init
// so the synchronous accessors below see a populated (or null) cache.
//
// The dynamic specifier is typed as `string` on purpose so TypeScript does not
// resolve ext-apps' types (which themselves reference the missing sdk subpath).
// =============================================================================

/** Minimal shape of the bits of ext-apps/app-bridge we use. */
interface AppBridge {
	RESOURCE_MIME_TYPE: string;
	getToolUiResourceUri(meta: { _meta?: unknown }): string | undefined;
	buildAllowAttribute(permissions: unknown): string;
}

/** Mirrors ext-apps' RESOURCE_MIME_TYPE; used when the module can't be loaded. */
const FALLBACK_RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";

// `: string` (not a string literal) so `import()` is typed `Promise<any>` and TS
// never tries to resolve ext-apps' (broken) types.
const APP_BRIDGE_SPECIFIER: string = "@modelcontextprotocol/ext-apps/app-bridge";

let cached: AppBridge | null = null;
let attempted = false;

/** Load ext-apps once (idempotent), swallowing any failure. Safe to await many
 *  times. Call early in MCP init before the sync accessors are used. */
export async function preloadAppBridge(): Promise<void> {
	if (attempted) return;
	attempted = true;
	try {
		cached = (await import(APP_BRIDGE_SPECIFIER)) as unknown as AppBridge;
	} catch {
		cached = null;
		console.error(
			"[soly] MCP UI (ext-apps/app-bridge) could not load — app-bridge features are disabled " +
				"(upstream ext-apps/sdk version mismatch, not a soly bug). Core MCP is unaffected.",
		);
	}
}

/** ext-apps' RESOURCE_MIME_TYPE when loaded, else the fallback literal. */
export function resourceMimeType(): string {
	return cached?.RESOURCE_MIME_TYPE ?? FALLBACK_RESOURCE_MIME_TYPE;
}

/** ext-apps getToolUiResourceUri, or undefined when the bridge isn't available. */
export function getToolUiResourceUri(meta: { _meta?: unknown }): string | undefined {
	if (!cached) return undefined;
	try {
		return cached.getToolUiResourceUri(meta);
	} catch {
		return undefined;
	}
}

/** ext-apps buildAllowAttribute, or "" (most restrictive) when not available. */
export function buildAllowAttribute(permissions: unknown): string {
	if (!cached) return "";
	try {
		return cached.buildAllowAttribute(permissions);
	} catch {
		return "";
	}
}
