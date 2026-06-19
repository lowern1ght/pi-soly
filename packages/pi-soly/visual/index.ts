// =============================================================================
// visual/index.ts — public surface of the soly chrome (Phase 2: visual)
// =============================================================================
//
// A flexible, native, dependency-free status system for pi: two width-aware
// "polosy" (a top bar above the editor + a custom footer) plus a configurable
// working spinner with live telemetry. Built only on documented pi UI APIs
// (setWidget / setFooter / setWorkingIndicator / setWorkingMessage).
//
// index.ts (the extension entry) creates one Chrome via createChrome(), keeps
// its `data` snapshot up to date on lifecycle events, and calls poke() to
// re-render. Everything else is internal.
// =============================================================================

export { createChrome, type Chrome, type ChromeConfig } from "./chrome.ts";
export { type ChromeData, emptyChromeData } from "./data.ts";
export { SPINNER_FRAMES, SPINNER_INTERVAL_MS } from "./working.ts";
export { readWelcomeMeta, type WelcomeInput } from "./welcome.ts";
