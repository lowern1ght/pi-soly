// =============================================================================
// tests/docs-stats.test.ts — verify buildIntentStats + formatter
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test";
import {
	buildIntentStats,
	formatIntentStats,
	type IntentDoc,
	type IntentInlineDoc,
} from "../intent.js";

const makeDoc = (overrides: Partial<IntentDoc> = {}): IntentDoc => ({
	relPath: "test.md",
	absPath: "/test.md",
	kind: "md",
	title: "Test Doc",
	preview: "This is a preview text for the doc",
	tokens: 200,
	oversized: false,
	...overrides,
});

describe("buildIntentStats", () => {
	test("empty docs → all zeros", () => {
		const stats = buildIntentStats([], []);
		expect(stats.totalDocs).toBe(0);
		expect(stats.totalPerTurnTokens).toBe(0);
		expect(stats.inlineDocs).toEqual([]);
		expect(stats.previewDocs).toEqual([]);
	});

	test("doc without inline body goes to previewDocs", () => {
		const doc = makeDoc({ relPath: "design.md" });
		const stats = buildIntentStats([doc], []);
		expect(stats.previewDocs.length).toBe(1);
		expect(stats.inlineDocs.length).toBe(0);
	});

	test("doc with inline body goes to inlineDocs", () => {
		const doc = makeDoc({ relPath: "principles.md" });
		const inlineBodies: IntentInlineDoc[] = [
			{ relPath: "principles.md", body: "full body", tokens: 500 },
		];
		const stats = buildIntentStats([doc], inlineBodies);
		expect(stats.inlineDocs.length).toBe(1);
		expect(stats.previewDocs.length).toBe(0);
		expect(stats.totalInlineTokens).toBe(500);
	});

	test("phase-specific docs are categorized", () => {
		const doc = makeDoc({ relPath: "phase1.md", phaseNumber: 1 });
		const stats = buildIntentStats([doc], []);
		expect(stats.phaseSpecificDocs.length).toBe(1);
		expect(stats.phaseSpecificDocs[0]?.relPath).toBe("phase1.md");
	});

	test("oversized flag propagated", () => {
		const doc = makeDoc({ oversized: true });
		const stats = buildIntentStats([doc], []);
		expect(stats.previewDocs[0]?.oversized).toBe(true);
	});

	test("previewTokens computed from preview length", () => {
		const doc = makeDoc({ preview: "x".repeat(400) }); // 400 chars = ~100 tokens
		const stats = buildIntentStats([doc], []);
		expect(stats.previewDocs[0]?.previewTokens).toBe(100);
	});

	test("totalPerTurnTokens = inlineTokens + previewTokens", () => {
		const d1 = makeDoc({ relPath: "inline.md", preview: "x".repeat(100) });
		const d2 = makeDoc({ relPath: "preview.md", preview: "y".repeat(200) });
		const inlineBodies: IntentInlineDoc[] = [
			{ relPath: "inline.md", body: "z".repeat(400), tokens: 100 },
		];
		const stats = buildIntentStats([d1, d2], inlineBodies);
		expect(stats.totalInlineTokens).toBe(100);
		expect(stats.totalPreviewTokens).toBeGreaterThan(0);
		expect(stats.totalPerTurnTokens).toBe(stats.totalInlineTokens + stats.totalPreviewTokens);
	});

	test("html docs work", () => {
		const doc = makeDoc({ kind: "html", relPath: "landing.html" });
		const stats = buildIntentStats([doc], []);
		expect(stats.previewDocs[0]?.kind).toBe("html");
	});
});

describe("formatIntentStats", () => {
	test("includes emoji header", () => {
		const stats = buildIntentStats([], []);
		expect(formatIntentStats(stats)).toContain("📚");
	});

	test("shows zero docs message", () => {
		const stats = buildIntentStats([], []);
		const out = formatIntentStats(stats);
		expect(out).toContain("No intent docs found");
	});

	test("shows inline docs", () => {
		const doc = makeDoc({ relPath: "principles.md", title: "Principles" });
		const inlineBodies: IntentInlineDoc[] = [
			{ relPath: "principles.md", body: "x".repeat(400), tokens: 100 },
		];
		const stats = buildIntentStats([doc], inlineBodies);
		const out = formatIntentStats(stats);
		expect(out).toContain("INLINE");
		expect(out).toContain("principles.md");
		expect(out).toContain("Principles");
	});

	test("shows preview-only docs", () => {
		const doc = makeDoc({ relPath: "design.md" });
		const stats = buildIntentStats([doc], []);
		const out = formatIntentStats(stats);
		expect(out).toContain("PREVIEW-ONLY");
		expect(out).toContain("design.md");
	});

	test("shows phase-specific docs", () => {
		const doc = makeDoc({ relPath: "phase1.md", phaseNumber: 1 });
		const stats = buildIntentStats([doc], []);
		const out = formatIntentStats(stats);
		expect(out).toContain("PHASE-SPECIFIC");
		expect(out).toContain("phase 1");
	});

	test("shows oversized flag", () => {
		const doc = makeDoc({ oversized: true });
		const stats = buildIntentStats([doc], []);
		const out = formatIntentStats(stats);
		expect(out).toContain("(oversized)");
	});

	test("breaks down inline vs preview tokens", () => {
		const d1 = makeDoc({ relPath: "inline.md" });
		const d2 = makeDoc({ relPath: "preview.md", preview: "x".repeat(80) });
		const inlineBodies: IntentInlineDoc[] = [
			{ relPath: "inline.md", body: "z".repeat(400), tokens: 100 },
		];
		const stats = buildIntentStats([d1, d2], inlineBodies);
		const out = formatIntentStats(stats);
		expect(out).toContain("100 from inline");
		expect(out).toContain("from previews");
	});
});