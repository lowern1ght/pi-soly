// visual/event-sink.ts — global event sink for soly notifications
//
// All soly modules (commands, workflows, mcp, init) route their events
// through this sink instead of ctx.ui.notify. The sink is set once at
// session_start by index.ts (wired to chrome.recordEvent). Before it's
// set, events are silently dropped (no chrome = no UI).
//
// Why a module-level global instead of threading `recordEvent` through
// every function signature? The mcp/ module has 30+ call sites in
// deeply-nested handlers; threading a new parameter through all of them
// is pure churn with no architectural benefit — every call would pass
// the same value. A global sink is the pragmatic choice.

type EventLevel = "info" | "warning" | "error";
type EventSink = (text: string, level?: EventLevel) => void;

let sink: EventSink | null = null;

/** Wire the event sink to the chrome's recordEvent. Called once at
 *  session_start. Safe to call multiple times (idempotent). */
export function setEventSink(fn: EventSink): void {
	sink = fn;
}

/** Record a soly event. Routes to chrome.recordEvent if the sink is
 *  wired (TUI mode); silently drops if not (RPC/print mode or before
 *  session_start). */
export function emit(text: string, level: EventLevel = "info"): void {
	sink?.(text, level);
}
