// =============================================================================
// visual/chrome.ts — controller that wires the soly chrome into pi's UI
// =============================================================================
//
// Owns one ChromeData and installs three pieces through documented APIs only:
//   - ctx.ui.setFooter         → SolyFooter (bottom polosa, replaces native)
//   - ctx.ui.setWidget(above)  → SolyTopBar (top polosa, soly workflow state)
//   - ctx.ui.setWorkingIndicator + setWorkingMessage → native snowflake spinner
//     with a live telemetry message (elapsed · ↑↓ tokens · tok/s)
//
// No terminal monkey-patching, no runtime deps. The telemetry message is
// driven by a 1s timer (elapsed) plus message_update pokes (output tokens),
// and is torn down on agent_end / shutdown. install() is idempotent.
// =============================================================================

import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { type ChromeData, emptyChromeData } from "./data.ts";
import { SolyFooter } from "./footer.ts";
import { SolyTopBar } from "./topbar.ts";
import { SolyHeader, type WelcomeInput } from "./welcome.ts";
import { buildWorkingMessage } from "./working.ts";

/** Subset of soly config that controls the chrome (see config.ts `chrome`). */
export type ChromeConfig = {
	enabled: boolean;
	ascii: boolean;
	spinnerFrames: string[];
	spinnerIntervalMs: number;
	telemetry: boolean;
	/** Hex gradient stops for the welcome banner (empty → accent color). */
	bannerColors: string[];
};

const TOPBAR_KEY = "soly-chrome-top";
const WORKING_LABEL = "Working";
/** Columns reserved for the spinner glyph and pi's own "(esc to interrupt)" hint. */
const WORKING_MARGIN = 18;

type WorkingState = {
	ui: ExtensionUIContext;
	startMs: number;
	inputTokens: number;
	outputTokens: number;
	timer: ReturnType<typeof setInterval> | null;
};

/** The chrome controller. One per extension instance. */
export type Chrome = {
	/** Mutable snapshot the components render from; index.ts updates it in place. */
	readonly data: ChromeData;
	/** Install footer/top-bar/spinner/header. Safe to call repeatedly (session_start). */
	install(ui: ExtensionUIContext): void;
	/** Provide the startup-header snapshot (version, state, recent changes). */
	setWelcome(input: WelcomeInput): void;
	/** Force a re-render of footer + top bar after data changes. */
	poke(): void;
	/** Begin the working telemetry line (agent_start). */
	startWorking(ui: ExtensionUIContext): void;
	/** Update generated-token count during streaming (message_update). */
	updateWorking(ui: ExtensionUIContext, outputTokens: number): void;
	/** Stop the telemetry line and restore the default message (agent_end). */
	stopWorking(ui: ExtensionUIContext): void;
	/** Restore pi's native footer/widgets/indicator (session_shutdown / disable). */
	dispose(ui?: ExtensionUIContext): void;
};

/** Create a chrome controller. `getConfig` is read live so /reload picks up changes. */
export function createChrome(getConfig: () => ChromeConfig): Chrome {
	const data = emptyChromeData();
	let welcome: WelcomeInput | null = null;
	let tui: TUI | null = null;
	let working: WorkingState | null = null;
	const ascii = () => getConfig().ascii;

	const workingWidth = (): number => {
		const cols = typeof process !== "undefined" ? process.stdout?.columns : undefined;
		return Math.max(20, (cols ?? 80) - WORKING_MARGIN);
	};

	const renderWorking = (): void => {
		if (!working || !getConfig().telemetry) return;
		const message = buildWorkingMessage(
			{
				label: WORKING_LABEL,
				elapsedMs: Date.now() - working.startMs,
				inputTokens: working.inputTokens,
				outputTokens: working.outputTokens,
			},
			workingWidth(),
		);
		try { working.ui.setWorkingMessage(message); } catch { /* session may have ended */ }
	};

	const clearWorking = (): void => {
		if (working?.timer) clearInterval(working.timer);
		working = null;
	};

	return {
		data,

		install(ui): void {
			if (!getConfig().enabled) return;
			ui.setWorkingIndicator({ frames: getConfig().spinnerFrames, intervalMs: getConfig().spinnerIntervalMs });
			ui.setFooter((t, theme, footerData) => {
				tui = t;
				return new SolyFooter(data, footerData, theme, ascii);
			});
			ui.setWidget(
				TOPBAR_KEY,
				(t, theme) => {
					tui = t;
					return new SolyTopBar(data, theme, ascii);
				},
				{ placement: "aboveEditor" },
			);
			ui.setHeader((t, theme) => {
				tui = t;
				return new SolyHeader(() => welcome, theme, ascii, () => getConfig().bannerColors);
			});
		},

		setWelcome(input): void {
			welcome = input;
			try { tui?.requestRender(); } catch { /* not mounted yet */ }
		},

		poke(): void {
			try { tui?.requestRender(); } catch { /* not mounted yet */ }
		},

		startWorking(ui): void {
			if (!getConfig().enabled || !getConfig().telemetry) return;
			clearWorking();
			working = { ui, startMs: Date.now(), inputTokens: data.ctxTokens ?? 0, outputTokens: 0, timer: null };
			renderWorking();
			working.timer = setInterval(renderWorking, 1000);
		},

		updateWorking(ui, outputTokens): void {
			if (!working) return;
			working.ui = ui;
			working.outputTokens = Math.max(working.outputTokens, outputTokens);
			renderWorking();
		},

		stopWorking(ui): void {
			clearWorking();
			try { ui.setWorkingMessage(); } catch { /* ignore */ }
		},

		dispose(ui): void {
			clearWorking();
			tui = null;
			if (!ui) return;
			try {
				ui.setFooter(undefined);
				ui.setWidget(TOPBAR_KEY, undefined);
				ui.setHeader(undefined);
				ui.setWorkingIndicator();
				ui.setWorkingMessage();
			} catch { /* session already torn down */ }
		},
	};
}
