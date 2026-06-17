// =============================================================================
// index.ts — pi-keyrouter extension entry point
// =============================================================================
//
// Usage:
//   pi install npm:pi-keyrouter
//   # create ~/.pi/keyrouter.json with your provider keys
//   /reload
//
// On load:
// 1. Reads keyrouter config (project or user-level)
// 2. Wraps globalThis.fetch with rotation logic
// 3. On 429/401, retries with next key up to maxRetries
// 4. Notifies user on every key switch via Box widget
//
// Provides /keyrouter command for status / disable / enable.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.ts";
import { installKeyRouter, type KeyRouterHandle } from "./fetch-wrapper.ts";

export default function keyRouterExtension(pi: ExtensionAPI): void {
	let handle: KeyRouterHandle | undefined;
	let enabled = true;
	let currentCwd = "";

	function activate(cwd: string, notify: (text: string, level: string) => void): void {
		if (handle) return;
		const config = loadConfig(cwd);
		if (config.providers.length === 0) {
			return; // nothing to do
		}
		handle = installKeyRouter(config, (event) => {
			notify(
				`🔑 keyrouter: ${event.provider} — ${event.fromKey} → ${event.toKey} ` +
					`(HTTP ${event.status}, attempt ${event.attempt})`,
				"warning",
			);
		});
	}

	function deactivate(): void {
		if (handle) {
			handle.disable();
			handle = undefined;
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		currentCwd = ctx.cwd;
		activate(ctx.cwd, (text, level) =>
			(ctx.ui.notify as (t: string, l?: string) => void)(text, level),
		);
		if (handle) {
			ctx.ui.notify(
				`🔑 keyrouter: active (${loadConfig(ctx.cwd).providers.length} provider(s))`,
				"info",
			);
		}
	});

	pi.on("session_shutdown", () => {
		deactivate();
	});

	pi.registerCommand("keyrouter", {
		description: "manage key rotation (status, enable, disable, reload)",
		handler: async (args, ctx) => {
			const sub = args.trim().split(/\s+/)[0] ?? "status";
			if (sub === "status") {
				if (!handle) {
					ctx.ui.notify("🔑 keyrouter: not active", "info");
					return;
				}
				const snap = handle.getSnapshot();
				const lines: string[] = [`🔑 keyrouter: ${enabled ? "active" : "disabled"}`];
				for (const p of snap) {
					lines.push(``);
					lines.push(`  ${p.provider} (current: ${p.current})`);
					for (const k of p.keys) {
						const cooldown = k.cooldownRemainingMs > 0
							? ` ⏱ ${Math.ceil(k.cooldownRemainingMs / 1000)}s`
							: "";
						lines.push(
							`    • ${k.name}  uses=${k.uses} fails=${k.failures} status=${k.lastStatus}${cooldown}`,
						);
					}
				}
				ctx.ui.notify(lines.join("\n"), "info");
				return;
			}
			if (sub === "enable") {
				if (!handle) {
					activate(currentCwd, (text, level) =>
						(ctx.ui.notify as (t: string, l?: string) => void)(text, level),
					);
				}
				enabled = true;
				ctx.ui.notify("🔑 keyrouter: enabled", "info");
				return;
			}
			if (sub === "disable") {
				deactivate();
				enabled = false;
				ctx.ui.notify("🔑 keyrouter: disabled (fetch restored)", "info");
				return;
			}
			if (sub === "reload") {
				deactivate();
				activate(currentCwd, (text, level) =>
					(ctx.ui.notify as (t: string, l?: string) => void)(text, level),
				);
				ctx.ui.notify("🔑 keyrouter: reloaded", "info");
				return;
			}
			ctx.ui.notify(
				"Usage: /keyrouter [status|enable|disable|reload]",
				"info",
			);
		},
	});
}