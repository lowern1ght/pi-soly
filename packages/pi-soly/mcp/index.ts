// @ts-nocheck — upstream MCP code with pre-existing strict-mode issues
import type { ExtensionAPI, ExtensionContext, ToolInfo } from "@earendil-works/pi-coding-agent";
import type { McpExtensionState } from "./state.ts";
import type { DirectToolSpec } from "./types.ts";
import { Type } from "typebox";
import { showStatus, showTools, reconnectServers, authenticateServer, logoutServer, openMcpAuthPanel, openMcpPanel, openMcpSetup } from "./commands.ts";
import { loadMcpConfig } from "./config.ts";
import { buildProxyDescription, createDirectToolExecutor, getMissingConfiguredDirectToolServers, resolveDirectTools } from "./direct-tools.ts";
import { flushMetadataCache, initializeMcp, updateStatusBar } from "./init.ts";
import { loadMetadataCache } from "./metadata-cache.ts";
import { executeAuthComplete, executeAuthStart, executeCall, executeConnect, executeDescribe, executeList, executeSearch, executeStatus, executeUiMessages } from "./proxy-modes.ts";
import { getConfigPathFromArgv, truncateAtWord } from "./utils.ts";
import { initializeOAuth, shutdownOAuth } from "./mcp-auth-flow.ts";
import { createMcpDirectToolCallRenderer, renderMcpProxyToolCall, renderMcpToolResult } from "./tool-result-renderer.ts";
import { ToolCache, cacheKey as makeCacheKey } from "./tool-cache.ts";
import { preloadAppBridge } from "./ext-apps-bridge.ts";

/** Default TTL for cached MCP tool results (60s). Tools that hit a stable
 *  server benefit; volatile ones are penalized for 60s — call sites can
 *  invalidate via cache.invalidateServer(name) on reconnect. */
const TOOL_CACHE_TTL_MS = 60_000;

export default function mcpAdapter(pi: ExtensionAPI) {
  let state: McpExtensionState | null = null;
  let initPromise: Promise<McpExtensionState> | null = null;
  let lifecycleGeneration = 0;
  /** In-memory TTL cache for direct MCP tool results. Per-session; cleared on
   *  shutdown and on per-server invalidation (e.g. after reconnect). The
   *  onChange callback refreshes the footer segment so cache activity stays
   *  visible without an explicit refresh. */
  const toolCache = new ToolCache(TOOL_CACHE_TTL_MS, Date.now, () => {
    // state may be null briefly during session_restart / session_shutdown —
    // skip the refresh in that case, the next init will set it again.
    if (state) updateStatusBar(state);
  });

  /** Registry of direct-tool specs keyed by their registered (prefixed) name,
   *  so mcp_retry can look up a spec by name when the LLM asks for a retry. */
  const specByPrefixedName = new Map<string, DirectToolSpec>();

  async function shutdownState(currentState: McpExtensionState | null, reason: string): Promise<void> {
    if (!currentState) return;

    if (currentState.uiServer) {
      currentState.uiServer.close(reason);
      currentState.uiServer = null;
    }

    let flushError: unknown;
    try {
      flushMetadataCache(currentState);
    } catch (error) {
      flushError = error;
    }

    try {
      await currentState.lifecycle.gracefulShutdown();
    } catch (error) {
      if (flushError) {
        console.error("MCP: graceful shutdown failed after metadata flush error", error);
      } else {
        throw error;
      }
    }

    if (flushError) {
      throw flushError;
    }
  }

  const earlyConfigPath = getConfigPathFromArgv();
  const earlyConfig = loadMcpConfig(earlyConfigPath);
  const earlyCache = loadMetadataCache();
  const prefix = earlyConfig.settings?.toolPrefix ?? "server";

  const envRaw = process.env.MCP_DIRECT_TOOLS;
  const directSpecs = envRaw === "__none__"
    ? []
    : resolveDirectTools(
        earlyConfig,
        earlyCache,
        prefix,
        envRaw?.split(",").map(s => s.trim()).filter(Boolean),
      );
  const missingConfiguredDirectToolServers = getMissingConfiguredDirectToolServers(earlyConfig, earlyCache);
  const shouldRegisterProxyTool =
    earlyConfig.settings?.disableProxyTool !== true
    || directSpecs.length === 0
    || missingConfiguredDirectToolServers.length > 0;

  for (const spec of directSpecs) {
    specByPrefixedName.set(spec.prefixedName, spec);
    (pi.registerTool as (tool: unknown) => unknown)({
      name: spec.prefixedName,
      label: `MCP: ${spec.originalName}`,
      description: spec.description || "(no description)",
      promptSnippet: truncateAtWord(spec.description, 100) || `MCP tool from ${spec.serverName}`,
      parameters: Type.Unsafe((spec.inputSchema || { type: "object", properties: {} }) as never),
      execute: createDirectToolExecutor(() => state, () => initPromise, spec, toolCache),
      renderCall: createMcpDirectToolCallRenderer(spec.prefixedName),
      renderResult: renderMcpToolResult,
    });
  }

  const getPiTools = (): ToolInfo[] => pi.getAllTools();

  pi.registerFlag("mcp-config", {
    description: "Path to MCP config file",
    type: "string",
  });

  pi.on("session_start", async (_event, ctx) => {
    const generation = ++lifecycleGeneration;
    const previousState = state;
    state = null;
    initPromise = null;

    try {
      await Promise.all([
        shutdownState(previousState, "session_restart"),
        shutdownOAuth(),
      ]);
    } catch (error) {
      console.error("MCP: failed to shut down previous session state", error);
    }

    if (generation !== lifecycleGeneration) {
      return;
    }

    await initializeOAuth().catch(err => {
      console.error("MCP OAuth initialization failed:", err);
    });

    // Load the (optional, sometimes-broken upstream) ext-apps UI bridge once,
    // before metadata is built. Guarded — a failure disables UI features only.
    await preloadAppBridge();

    const promise = initializeMcp(pi, ctx);
    initPromise = promise;

    promise.then(async (nextState) => {
      if (generation !== lifecycleGeneration || initPromise !== promise) {
        try {
          await shutdownState(nextState, "stale_session_start");
        } catch (error) {
          console.error("MCP: failed to clean stale session state", error);
        }
        return;
      }

      state = nextState;
      nextState.toolCache = toolCache;
      updateStatusBar(nextState);
      initPromise = null;
    }).catch(err => {
      if (generation !== lifecycleGeneration) {
        return;
      }
      if (initPromise !== promise && initPromise !== null) {
        return;
      }
      console.error("MCP initialization failed:", err);
      initPromise = null;
    });
  });

  pi.on("session_shutdown", async () => {
    ++lifecycleGeneration;
    const currentState = state;
    state = null;
    initPromise = null;
    toolCache.clear();

    try {
      await Promise.all([
        shutdownState(currentState, "session_shutdown"),
        shutdownOAuth(),
      ]);
    } catch (error) {
      console.error("MCP: session shutdown cleanup failed", error);
    }
  });

  pi.registerCommand("mcp", {
    description: "Show MCP server status",
    handler: async (args, ctx) => {
      if (!state && initPromise) {
        try {
          state = await initPromise;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (ctx.hasUI) ctx.ui.notify(`MCP initialization failed: ${message}`, "error");
          return;
        }
      }
      if (!state) {
        if (ctx.hasUI) ctx.ui.notify("MCP not initialized", "error");
        return;
      }

      const parts = args?.trim()?.split(/\s+/) ?? [];
      const subcommand = parts[0] ?? "";
      const targetServer = parts[1];
      const rest = parts.slice(1).join(" ");

      switch (subcommand) {
        case "reconnect":
          await reconnectServers(state, ctx, targetServer);
          break;
        case "tools":
          await showTools(state, ctx);
          break;
        case "setup": {
          const result = await openMcpSetup(state, pi, ctx, earlyConfigPath, "setup");
          if (result?.configChanged) {
            await ctx.reload();
            return;
          }
          break;
        }
        case "logout": {
          const serverName = rest;
          if (!serverName) {
            if (ctx.hasUI) ctx.ui.notify("Usage: /mcp logout <server>", "error");
            return;
          }
          await logoutServer(serverName, state, ctx);
          break;
        }
        case "status":
        case "":
        default:
          if (ctx.hasUI) {
            const result = await openMcpPanel(state, pi, ctx, earlyConfigPath);
            if (result?.configChanged) {
              await ctx.reload();
              return;
            }
          } else {
            await showStatus(state, ctx);
          }
          break;
      }
    },
  });

  pi.registerCommand("mcp-auth", {
    description: "Authenticate with an MCP server (OAuth)",
    handler: async (args, ctx) => {
      const serverName = args?.trim();
      if (!serverName && !ctx.hasUI) {
        return;
      }

      if (!state && initPromise) {
        try {
          state = await initPromise;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (ctx.hasUI) ctx.ui.notify(`MCP initialization failed: ${message}`, "error");
          return;
        }
      }
      if (!state) {
        if (ctx.hasUI) ctx.ui.notify("MCP not initialized", "error");
        return;
      }

      if (!serverName) {
        await openMcpAuthPanel(state, pi, ctx, earlyConfigPath);
        return;
      }

      await authenticateServer(serverName, state.config, ctx);
    },
  });

  if (shouldRegisterProxyTool) {
    (pi.registerTool as (tool: unknown) => unknown)({
      name: "mcp",
      label: "MCP",
      description: buildProxyDescription(earlyConfig, earlyCache, directSpecs),
      promptSnippet: "MCP gateway - connect to MCP servers and call their tools",
      renderCall: renderMcpProxyToolCall,
      parameters: Type.Object({
        tool: Type.Optional(Type.String({ description: "Tool name to call (e.g., 'xcodebuild_list_sims')" })),
        args: Type.Optional(Type.String({ description: "Arguments as JSON string (e.g., '{\"key\": \"value\"}')" })),
        connect: Type.Optional(Type.String({ description: "Server name to connect (lazy connect + metadata refresh)" })),
        describe: Type.Optional(Type.String({ description: "Tool name to describe (shows parameters)" })),
        search: Type.Optional(Type.String({ description: "Search tools by name/description" })),
        regex: Type.Optional(Type.Boolean({ description: "Treat search as regex (default: substring match)" })),
        includeSchemas: Type.Optional(Type.Boolean({ description: "Include parameter schemas in search results (default: true)" })),
        server: Type.Optional(Type.String({ description: "Filter to specific server (also disambiguates tool calls)" })),
        action: Type.Optional(Type.String({ description: "Action: 'ui-messages', 'auth-start', or 'auth-complete'" })),
      }),
      renderResult: renderMcpToolResult,
      async execute(_toolCallId: string, params: {
        tool?: string;
        args?: string;
        connect?: string;
        describe?: string;
        search?: string;
        regex?: boolean;
        includeSchemas?: boolean;
        server?: string;
        action?: string;
      }, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) {
        let parsedArgs: Record<string, unknown> | undefined;
        if (params.args) {
          try {
            parsedArgs = JSON.parse(params.args);
            if (typeof parsedArgs !== "object" || parsedArgs === null || Array.isArray(parsedArgs)) {
              const gotType = Array.isArray(parsedArgs) ? "array" : parsedArgs === null ? "null" : typeof parsedArgs;
              throw new Error(`Invalid args: expected a JSON object, got ${gotType}`);
            }
          } catch (error) {
            if (error instanceof SyntaxError) {
              throw new Error(`Invalid args JSON: ${error.message}`, { cause: error });
            }
            throw error;
          }
        }

        if (!state && initPromise) {
          try {
            state = await initPromise;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
              content: [{ type: "text" as const, text: `MCP initialization failed: ${message}` }],
              details: { error: "init_failed", message },
            };
          }
        }
        if (!state) {
          return {
            content: [{ type: "text" as const, text: "MCP not initialized" }],
            details: { error: "not_initialized" },
          };
        }

        if (params.action === "ui-messages") {
          return executeUiMessages(state);
        }
        if (params.action === "auth-start") {
          if (!params.server) {
            return {
              content: [{ type: "text" as const, text: "auth-start requires `server`. Example: mcp({ action: \"auth-start\", server: \"linear-server\" })" }],
              details: { mode: "auth-start", error: "missing_server" },
            };
          }
          return executeAuthStart(state, params.server);
        }
        if (params.action === "auth-complete") {
          if (!params.server) {
            return {
              content: [{ type: "text" as const, text: "auth-complete requires `server`." }],
              details: { mode: "auth-complete", error: "missing_server" },
            };
          }
          const input = parsedArgs?.redirectUrl ?? parsedArgs?.code ?? parsedArgs?.input;
          if (typeof input !== "string" || input.trim().length === 0) {
            return {
              content: [{ type: "text" as const, text: "auth-complete requires args with `redirectUrl`, `code`, or `input`." }],
              details: { mode: "auth-complete", error: "missing_input" },
            };
          }
          return executeAuthComplete(state, params.server, input);
        }
        if (params.tool) {
          return executeCall(state, params.tool, parsedArgs, params.server, getPiTools);
        }
        if (params.connect) {
          return executeConnect(state, params.connect);
        }
        if (params.describe) {
          return executeDescribe(state, params.describe);
        }
        if (params.search) {
          return executeSearch(state, params.search, params.regex, params.server, params.includeSchemas);
        }
        if (params.server) {
          return executeList(state, params.server);
        }
        return executeStatus(state);
      },
    });
  }

  // ============================================================================
  // LLM-callable retry / reconnect
  //
  // Direct tools fail with `server_unavailable`, `not_connected`, or
  // `call_failed` when the underlying connection drops. The LLM used to need
  // the user to run `/mcp reconnect <server>` manually; these tools let it
  // self-recover without bothering the user.
  // ============================================================================

  /** Pull the live state out of the lazy init promise; structured error on failure. */
  async function getStateForTool() {
    let s = state;
    if (!s && initPromise) {
      try {
        s = await initPromise;
      } catch (error) {
        return {
          ok: false as const,
          result: {
            content: [{
              type: "text" as const,
              text: `MCP initialization failed: ${error instanceof Error ? error.message : String(error)}`,
            }],
            details: { error: "init_failed" },
          },
        };
      }
    }
    if (!s) {
      return {
        ok: false as const,
        result: {
          content: [{ type: "text" as const, text: "MCP not initialized" }],
          details: { error: "not_initialized" },
        },
      };
    }
    return { ok: true as const, state: s };
  }

  (pi.registerTool as (tool: unknown) => unknown)({
    name: "mcp_reconnect",
    label: "MCP reconnect",
    description: "Reconnect to one or all MCP servers after a connection failure. Use this when direct tool calls return `server_unavailable`, `not_connected`, or `call_failed` errors. Without `server`, reconnects all configured servers. The tool cache for the affected server is invalidated so the next call gets a fresh result.",
    promptSnippet: "MCP reconnect - restore a server connection after failure",
    parameters: Type.Object({
      server: Type.Optional(Type.String({ description: "Server name to reconnect; omit to reconnect all configured servers" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
      const got = await getStateForTool();
      if (!got.ok) return got.result;
      const targetServer = params.server;
      if (targetServer) toolCache.invalidateServer(targetServer);
      else toolCache.clear();
      await reconnectServers(got.state, ctx, targetServer);
      return {
        content: [{
          type: "text" as const,
          text: targetServer
            ? `Reconnect attempted for "${targetServer}". Check server status with /mcp status, then re-call the failed tool.`
            : "Reconnect attempted for all configured servers. Re-call any failed tool.",
        }],
        details: { server: targetServer ?? null, action: "reconnect" },
      };
    },
  });

  (pi.registerTool as (tool: unknown) => unknown)({
    name: "mcp_retry",
    label: "MCP retry",
    description: "Reconnect to an MCP server and re-execute a specific direct tool call in one shot. Use after `mcp_reconnect`, or directly when you know the original tool name and arguments. The `tool` must be a registered direct tool name (the prefixed form, e.g. 'demo_search'). The tool cache for the server is invalidated before the retry so the response is fresh.",
    promptSnippet: "MCP retry - reconnect server and re-execute a tool call",
    parameters: Type.Object({
      server: Type.String({ description: "Server name to reconnect" }),
      tool: Type.String({ description: "Direct tool name as registered (prefixedName, e.g. 'demo_search')" }),
      args: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Original tool arguments as a JSON object; omit or pass {} if the tool takes no arguments" })),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx: ExtensionContext) {
      const got = await getStateForTool();
      if (!got.ok) return got.result;

      const spec = specByPrefixedName.get(params.tool);
      if (!spec) {
        return {
          content: [{
            type: "text" as const,
            text: `Tool "${params.tool}" not found. Use the proxy tool mcp({ server: "${params.server}" }) to see available tools for this server.`,
          }],
          details: { error: "tool_not_found", requestedTool: params.tool },
        };
      }
      if (spec.serverName !== params.server) {
        return {
          content: [{
            type: "text" as const,
            text: `Tool "${params.tool}" belongs to server "${spec.serverName}", not "${params.server}".`,
          }],
          details: {
            error: "server_mismatch",
            requestedTool: params.tool,
            requestedServer: params.server,
            actualServer: spec.serverName,
          },
        };
      }

      toolCache.invalidateServer(params.server);
      await reconnectServers(got.state, ctx, params.server);

      const executor = createDirectToolExecutor(
        () => got.state,
        () => null,
        spec,
        toolCache,
      );
      return executor(toolCallId, params.args ?? {}, signal, onUpdate, ctx);
    },
  });
}
