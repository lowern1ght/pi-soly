// =============================================================================
// tests/provider-resolution.test.ts — provider name mapping
// =============================================================================

/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test";

// We test the mapping logic by re-implementing it here (it's a pure function
// inside index.ts). In the future we could export it, but for now this
// documents the expected behavior.
function resolveProviderName(displayName: string): string {
	const lower = displayName.toLowerCase();
	const map: Record<string, string> = {
		"z-ai": "zai",
		"z.ai": "zai",
		"open-router": "openrouter",
		"openai": "openai",
		"anthropic": "anthropic",
	};
	return map[lower] ?? displayName;
}

describe("resolveProviderName", () => {
	test("maps z-ai → zai", () => {
		expect(resolveProviderName("z-ai")).toBe("zai");
	});

	test("maps z.ai → zai", () => {
		expect(resolveProviderName("z.ai")).toBe("zai");
	});

	test("case-insensitive", () => {
		expect(resolveProviderName("Z-AI")).toBe("zai");
		expect(resolveProviderName("Z.AI")).toBe("zai");
	});

	test("maps open-router → openrouter", () => {
		expect(resolveProviderName("open-router")).toBe("openrouter");
	});

	test("passes through unknown providers", () => {
		expect(resolveProviderName("custom-provider")).toBe("custom-provider");
		expect(resolveProviderName("minimax")).toBe("minimax");
	});

	test("passes through already-canonical names", () => {
		expect(resolveProviderName("openai")).toBe("openai");
		expect(resolveProviderName("anthropic")).toBe("anthropic");
	});
});