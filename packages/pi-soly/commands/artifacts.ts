// =============================================================================
// commands/artifacts.ts — /artifacts command (browse html_artifact gallery)
// =============================================================================

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getArtifactServer, ensureArtifactServer, artifactDir } from "../artifact/session.ts";
import { openListPanel, openExternally, type CommandsDeps } from "./_helpers.ts";

type ArtifactsDeps = Pick<CommandsDeps, "getConfig" | "recordEvent">;

export function registerArtifactsCommand(pi: ExtensionAPI, deps: ArtifactsDeps): void {
	const { getConfig, recordEvent } = deps;

	pi.registerCommand("artifacts", {
		description: "browse this project's html_artifact gallery (list, open, clear)",
		handler: async (args, ctx) => {
			if (!getConfig().artifacts.server) {
				recordEvent("artifact server is disabled (artifacts.server=false)");
				return;
			}
			// Always re-resolve: reuse another window's server or start ours, and
			// re-probe a stale client whose owner may have died in the meantime.
			let server = getArtifactServer();
			try {
				server = await ensureArtifactServer(artifactDir(getConfig().artifacts.dir, ctx.cwd), ctx.cwd);
			} catch {
				// ignore — handled by the count check below
			}
			if (!server || server.count === 0) {
				recordEvent("no artifacts for this project yet (use the html_artifact tool)");
				return;
			}
			const gallery = server.galleryUrl();
			const sub = args.trim().split(/\s+/).filter(Boolean)[0] ?? "";

			if (sub === "clear") {
				const n = server.clear();
				recordEvent(`cleared ${n} artifact(s)`);
				return;
			}
			if (sub === "open" || sub === "gallery") {
				try {
					await openExternally(pi, gallery);
					recordEvent(`opened ${gallery}`);
				} catch {
					recordEvent(`soly artifacts gallery: ${gallery}`);
				}
				return;
			}

			if (ctx.mode === "tui") {
				await openListPanel(ctx, {
					title: "soly · artifacts",
					headerRight: `${server.count} artifact${server.count === 1 ? "" : "s"}`,
					build: () => [
						{
							id: "artifacts",
							title: "Artifacts",
							icon: "▦",
							items: (getArtifactServer()?.list() ?? []).map((a) => ({
								id: a.id,
								marker: "▦", // BMP glyph — an astral emoji (🖼) breaks ListPanel width
								label: a.title,
								meta: new Date(a.createdAt).toLocaleTimeString(),
								body: a.url,
							})),
						},
					],
					onSelect: (it) => {
						const a = getArtifactServer()?.list().find((x) => x.id === it.id);
						if (a) void openExternally(pi, a.url);
					},
					actions: [
						{ key: "g", hint: "gallery", run: () => void openExternally(pi, gallery) },
						{ key: "x", hint: "delete", run: (it) => { getArtifactServer()?.remove(it.id); } },
					],
				});
				return;
			}

			// Non-TUI: print the list + gallery URL.
			const lines = server.list().map((a) => `🖼 ${a.title} — ${a.url}`);
			recordEvent([`soly artifacts gallery: ${gallery}`, "", ...lines].join("\n"));
		},
	});
}
