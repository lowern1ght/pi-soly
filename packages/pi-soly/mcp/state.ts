import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ConsentManager } from "./consent-manager.ts";
import type { McpLifecycleManager } from "./lifecycle.ts";
import type { McpServerManager } from "./server-manager.ts";
import type { ToolMetadata, McpConfig, UiSessionMessages, UiStreamSummary } from "./types.ts";
import type { ToolCache } from "./tool-cache.ts";
import type { UiResourceHandler } from "./ui-resource-handler.ts";
import type { UiServerHandle } from "./ui-server.ts";

export interface CompletedUiSession {
  serverName: string;
  toolName: string;
  completedAt: Date;
  reason: string;
  messages: UiSessionMessages;
  stream?: UiStreamSummary;
}

export type SendMessageFn = (
  message: {
    customType: string;
    content: Array<{ type: "text"; text: string }>;
    display?: string;
    details?: unknown;
  },
  options?: { triggerTurn?: boolean }
) => void;

export interface McpExtensionState {
  manager: McpServerManager;
  lifecycle: McpLifecycleManager;
  toolMetadata: Map<string, ToolMetadata[]>;
  config: McpConfig;
  failureTracker: Map<string, number>;
  uiResourceHandler: UiResourceHandler;
  consentManager: ConsentManager;
  uiServer: UiServerHandle | null;
  completedUiSessions: CompletedUiSession[];
  /** In-memory TTL cache for direct tool call results. Attached by index.ts
   *  right after initializeMcp resolves; consumed by updateStatusBar for the
   *  footer and by showStatus for the /mcp status panel. Optional because
   *  initializeMcp constructs the state without it; index.ts assigns before
   *  any consumer can see the state. */
  toolCache?: ToolCache;
  openBrowser: (url: string) => Promise<void>;
  ui?: ExtensionContext["ui"];
  sendMessage?: SendMessageFn;
}
