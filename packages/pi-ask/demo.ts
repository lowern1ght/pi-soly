// =============================================================================
// demo.ts — Visual demo of the AskProComponent picker
// =============================================================================
//
// Constructs the picker, simulates key inputs, and prints the actual rendered
// TUI lines (with ANSI colors) at each step. Run with:
//
//   cd ~/.pi/agent/extensions/pi-ask
//   bun demo.ts
//
// This is what the picker would look like inside pi's interactive TUI.
// =============================================================================

import { AskProComponent, type AskQuestion, type AskProTheme } from "./picker.js";
import type { KeybindingsManager } from "@earendil-works/pi-tui";

// ANSI-colored theme for visual output. Matches pi-coding-agent's color
// scheme (cyan = accent, green = success, yellow = warning, dim = gray).
const theme: AskProTheme = {
	fg: (color: string, text: string): string => {
		const codes: Record<string, string> = {
			accent: "\x1b[36m",  // cyan
			success: "\x1b[32m", // green
			warning: "\x1b[33m", // yellow
			dim: "\x1b[90m",     // gray
			text: "\x1b[37m",    // white
		};
		const code = codes[color] ?? "";
		return code ? `${code}${text}\x1b[0m` : text;
	},
	bold: (text: string): string => `\x1b[1m${text}\x1b[0m`,
};

const keybindings: KeybindingsManager = {
	matches: (keyData: string, name: string): boolean => {
		if (name === "tui.select.up") return keyData === "\x1b[A" || keyData === "k";
		if (name === "tui.select.down") return keyData === "\x1b[B" || keyData === "j";
		if (name === "tui.select.confirm") return keyData === "\n" || keyData === "\r";
		if (name === "tui.select.cancel") return keyData === "\x1b";
		return false;
	},
} as unknown as KeybindingsManager;

const SCENARIO_QUESTIONS: AskQuestion[] = [
	{
		header: "Auth",
		question: "Which auth approach do you prefer?",
		options: [
			{
				label: "JWT in httpOnly cookie",
				description: "Stateless, scales horizontally, modern default",
				recommended: true,
			},
			{
				label: "JWT in localStorage",
				description: "Simpler client code, but XSS risk",
			},
			{
				label: "Server sessions + Redis",
				description: "Revocable, but extra dependency",
			},
		],
	},
	{
		header: "Tokens",
		question: "Where to store the access token?",
		options: [
			{ label: "httpOnly cookie", description: "Auto-sent by browser, XSS-safe" },
			{
				label: "Bearer in Authorization header",
				description: "Explicit, works cross-origin",
				recommended: true,
			},
		],
	},
	{
		header: "Refresh",
		question: "Refresh token rotation?",
		options: [
			{
				label: "Yes — new refresh on each use",
				description: "Best security, more DB writes",
				recommended: true,
			},
			{ label: "No — keep until expiry", description: "Simpler, weaker" },
		],
	},
];

const MULTI_QUESTIONS: AskQuestion[] = [
	{
		header: "Features",
		question: "Which features to include in v1?",
		options: [
			{ label: "User auth" },
			{ label: "Project CRUD" },
			{ label: "Task CRUD" },
			{ label: "Comments" },
		],
		multiSelect: true,
	},
	{
		header: "Priority",
		question: "Default task priority?",
		options: [
			{ label: "High" },
			{ label: "Medium", recommended: true },
			{ label: "Low" },
		],
	},
];

const OTHER_QUESTIONS: AskQuestion[] = [
	{
		header: "Auth",
		question: "Which auth approach?",
		options: [
			{ label: "JWT in httpOnly cookie", recommended: true },
			{ label: "JWT in localStorage" },
			{ label: "Server sessions + Redis" },
		],
		allowOther: true,
	},
];

const WIDTH = 78;

function render(picker: AskProComponent): void {
	const lines = picker.render(WIDTH);
	for (const line of lines) {
		console.log(line);
	}
}

function show(label: string, picker: AskProComponent, doneResult: unknown): void {
	console.log(`\n\x1b[1m\x1b[33m▶ ${label}\x1b[0m`);
	console.log("\x1b[90m" + "─".repeat(WIDTH) + "\x1b[0m");
	render(picker);
	console.log("\x1b[90m" + "─".repeat(WIDTH) + "\x1b[0m");
	if (doneResult !== null) {
		console.log("\n\x1b[1m\x1b[32m✓ DONE:\x1b[0m", JSON.stringify(doneResult));
	}
}

// ---------------------------------------------------------------------------
// Scenario 1: 3 single-select questions, one-by-one via number keys
// ---------------------------------------------------------------------------

console.log("\x1b[1m\x1b[36m" + "═".repeat(WIDTH) + "\x1b[0m");
console.log("\x1b[1m\x1b[36mSCENARIO 1: 3 single-select questions, instant-pick via number keys\x1b[0m");
console.log("\x1b[1m\x1b[36m" + "═".repeat(WIDTH) + "\x1b[0m");

let done1: unknown = null;
const picker1 = new AskProComponent({
	questions: SCENARIO_QUESTIONS,
	theme,
	keybindings,
	done: (r) => {
		done1 = r;
	},
});

show("INITIAL — Q1 of 3, JWT cookie ⭐ highlighted (selectedIndex=0)", picker1, done1);
picker1.handleInput("1");
show("After '1' — picked option 1 (JWT cookie) on Q1, AUTO-ADVANCED to Q2", picker1, done1);
picker1.handleInput("2");
show("After '2' — picked option 2 (Bearer header) on Q2, AUTO-ADVANCED to Q3", picker1, done1);
picker1.handleInput("1");
show("After '1' — picked option 1 on Q3 (last), SUBMITTED", picker1, done1);

console.log("\n\x1b[1m\x1b[32mFinal result:\x1b[0m", JSON.stringify(done1));

// ---------------------------------------------------------------------------
// Scenario 2: multi-select + single-select
// ---------------------------------------------------------------------------

console.log("\n\n\x1b[1m\x1b[36m" + "═".repeat(WIDTH) + "\x1b[0m");
console.log("\x1b[1m\x1b[36mSCENARIO 2: multi-select toggling + single-select submit\x1b[0m");
console.log("\x1b[1m\x1b[36m" + "═".repeat(WIDTH) + "\x1b[0m");

let done2: unknown = null;
const picker2 = new AskProComponent({
	questions: MULTI_QUESTIONS,
	theme,
	keybindings,
	done: (r) => {
		done2 = r;
	},
});

show("INITIAL — Q1 (multi-select), nothing checked yet", picker2, done2);
picker2.handleInput("1");
show("After '1' — toggled 'User auth' (☒)", picker2, done2);
picker2.handleInput("3");
show("After '3' — toggled 'Task CRUD' (☒), [User auth, Task CRUD]", picker2, done2);
picker2.handleInput("1");
show("After '1' AGAIN — toggled 'User auth' OFF (☐)", picker2, done2);
picker2.handleInput("\t");
show("Tab → Q2 (single-select, auto-advanced with [Task CRUD] preserved)", picker2, done2);
picker2.handleInput("2");
show("After '2' — picked 'Medium' (recommended) on Q2, SUBMITTED", picker2, done2);

console.log("\n\x1b[1m\x1b[32mFinal result:\x1b[0m", JSON.stringify(done2));

// ---------------------------------------------------------------------------
// Scenario 3: Esc cancel mid-flow
// ---------------------------------------------------------------------------

console.log("\n\n\x1b[1m\x1b[36m" + "═".repeat(WIDTH) + "\x1b[0m");
console.log("\x1b[1m\x1b[36mSCENARIO 3: user presses Esc mid-flow → cancelled\x1b[0m");
console.log("\x1b[1m\x1b[36m" + "═".repeat(WIDTH) + "\x1b[0m");

let done3: unknown = null;
const picker3 = new AskProComponent({
	questions: SCENARIO_QUESTIONS,
	theme,
	keybindings,
	done: (r) => {
		done3 = r;
	},
});

show("INITIAL — Q1", picker3, done3);
picker3.handleInput("1");
show("After '1' — picked on Q1, advanced to Q2", picker3, done3);
picker3.handleInput("\x1b");
show("After Esc — cancelled, no answers returned", picker3, done3);
console.log("\n\x1b[1m\x1b[32mFinal result:\x1b[0m", JSON.stringify(done3));

// ---------------------------------------------------------------------------
// Scenario 5: "Other…" with text input
// ---------------------------------------------------------------------------

console.log("\n\n\x1b[1m\x1b[36m" + "═".repeat(WIDTH) + "\x1b[0m");
console.log("\x1b[1m\x1b[36mSCENARIO 5: allowOther — user picks 'Other…' and types a custom answer\x1b[0m");
console.log("\x1b[1m\x1b[36m" + "═".repeat(WIDTH) + "\x1b[0m");

let done5: unknown = null;
const picker5 = new AskProComponent({
	questions: OTHER_QUESTIONS,
	theme,
	keybindings,
	done: (r) => {
		done5 = r;
	},
	// Mock the text input dialog
	onRequestInput: async () => {
		return "WebAuthn / passkeys";
	},
});

show("INITIAL — 3 options + 'Other…' (last)", picker5, done5);
picker5.handleInput("j");
picker5.handleInput("j");
show("After 'jj' — selection on 'Other…' (index 3), footer shows '⏎ type'", picker5, done5);
picker5.handleInput("4"); // pick Other (4th = index 3)
await new Promise((r) => setImmediate(r));
show("After picking Other + typing 'WebAuthn / passkeys' — submitted with custom string", picker5, done5);
console.log("\n\x1b[1m\x1b[32mFinal result:\x1b[0m", JSON.stringify(done5));

// ---------------------------------------------------------------------------
// Scenario 6: Tab navigation + back arrow
// ---------------------------------------------------------------------------

console.log("\n\n\x1b[1m\x1b[36m" + "═".repeat(WIDTH) + "\x1b[0m");
console.log("\x1b[1m\x1b[36mSCENARIO 4: user navigates with Tab and arrows, goes back to change answer\x1b[0m");
console.log("\x1b[1m\x1b[36m" + "═".repeat(WIDTH) + "\x1b[0m");

let done4: unknown = null;
const picker4 = new AskProComponent({
	questions: SCENARIO_QUESTIONS,
	theme,
	keybindings,
	done: (r) => {
		done4 = r;
	},
});

show("INITIAL — Q1, Q2, Q3", picker4, done4);
picker4.handleInput("2");
show("After '2' on Q1 — picked 'JWT in localStorage', advanced to Q2", picker4, done4);
picker4.handleInput("\t");
show("Tab — went BACK from Q2 to Q1 (no — Tab is forward, we're at Q2)", picker4, done4);
picker4.handleInput("\x1b[D");
show("Left arrow — went back to Q1, answer (option 2) preserved", picker4, done4);
picker4.handleInput("j");
show("'j' — moved selection down to option 2", picker4, done4);
picker4.handleInput("3");
show("After '3' — picked option 3 (Server sessions), advanced to Q2", picker4, done4);
picker4.handleInput("1");
show("After '1' on Q2 — picked option 1 (cookie), advanced to Q3", picker4, done4);
picker4.handleInput("2");
show("After '2' on Q3 (last) — picked 'No — keep until expiry', SUBMITTED", picker4, done4);

console.log("\n\x1b[1m\x1b[32mFinal result:\x1b[0m", JSON.stringify(done4));
