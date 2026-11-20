import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import {
  ErrorCodes,
  errorShape,
  runWithLocalStateMutationOwner,
  type GatewayRequestHandlerOptions,
} from "openclaw/plugin-sdk/gateway-runtime";
import { createLazyRuntimeModule } from "openclaw/plugin-sdk/lazy-runtime";
import { listAgentIds } from "openclaw/plugin-sdk/memory-core-host-runtime-core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { MemoryOwnerOperation, MemoryOwnerOutput } from "./cli-rem-owner.js";
import type { MemoryPromoteCommandOptions, MemoryRemHarnessOptions } from "./cli.types.js";
import type { MemoryCoreRuntimeHost } from "./memory/runtime-host.js";

const loadRuntime = createLazyRuntimeModule(() => import("./cli.runtime.js"));

function parseRequest(operation: MemoryOwnerOperation, params: Record<string, unknown>) {
  const allowed = new Set([
    "expectedOwnerId",
    "agent",
    ...(operation === "promote"
      ? [
          "limit",
          "minScore",
          "minRecallCount",
          "minUniqueQueries",
          "includePromoted",
          "json",
          "apply",
        ]
      : []),
    ...(operation === "remHarness" ? ["includePromoted", "grounded", "json"] : []),
    ...(operation === "index" ? ["force", "verbose"] : []),
  ]);
  for (const key of Object.keys(params)) {
    if (!allowed.has(key)) throw new Error(`Unexpected parameter: ${key}`);
  }
  if (typeof params.expectedOwnerId !== "string" || !params.expectedOwnerId.trim())
    throw new Error("expectedOwnerId is required");
  if (params.agent !== undefined && (typeof params.agent !== "string" || !params.agent.trim()))
    throw new Error("agent must be non-empty");
  for (const key of ["json", "includePromoted", "grounded", "force", "verbose", "apply"]) {
    if (params[key] !== undefined && typeof params[key] !== "boolean")
      throw new Error(`${key} must be boolean`);
  }
  if (params.apply === true)
    throw new Error("Promotion apply requires exclusive offline ownership");
  for (const key of ["limit", "minRecallCount", "minUniqueQueries", "minScore"]) {
    const value = params[key];
    if (value === undefined) continue;
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      (key !== "minScore" && (!Number.isInteger(value) || value < (key === "limit" ? 1 : 0)))
    )
      throw new Error(`Invalid ${key}`);
  }
  const { expectedOwnerId, ...options } = params;
  return {
    expectedOwnerId,
    options: options as MemoryPromoteCommandOptions & MemoryRemHarnessOptions,
  };
}

export function registerMemoryRemGatewayMethods(
  api: OpenClawPluginApi,
  host: MemoryCoreRuntimeHost,
): void {
  for (const operation of ["promote", "remHarness", "index"] as const) {
    api.registerGatewayMethod(
      `memory.${operation}.owner`,
      async (invocation: GatewayRequestHandlerOptions) => {
        const { respond } = invocation;
        let request: ReturnType<typeof parseRequest>;
        try {
          request = parseRequest(operation, invocation.params);
          const cfg = api.runtime.config.current() as OpenClawConfig;
          if (
            request.options.agent !== undefined &&
            !listAgentIds(cfg).includes(request.options.agent)
          )
            throw new Error("Unknown agent");
        } catch (error) {
          respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(error)));
          return;
        }
        try {
          const result = await runWithLocalStateMutationOwner(
            request.expectedOwnerId,
            invocation,
            async (assertCurrent) => {
              const output: MemoryOwnerOutput[] = [];
              const execution = {
                config: api.runtime.config.current() as OpenClawConfig,
                assertCurrent,
                output: {
                  log: (...args: unknown[]) => {
                    assertCurrent();
                    output.push({ kind: "log", text: args.map(String).join(" ") });
                  },
                  error: (...args: unknown[]) => {
                    assertCurrent();
                    output.push({ kind: "error", text: args.map(String).join(" ") });
                  },
                  writeJson: (value: unknown) => {
                    assertCurrent();
                    output.push({ kind: "json", value });
                  },
                },
              };
              const runtime = await loadRuntime();
              assertCurrent();
              if (operation === "promote")
                await runtime.runMemoryPromote(request.options, host, execution);
              else if (operation === "remHarness")
                await runtime.runMemoryRemHarness(request.options, host, execution);
              else await runtime.runMemoryIndex(request.options, host, execution);
              assertCurrent();
              return { output };
            },
          );
          respond(true, result);
        } catch (error) {
          respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
        }
      },
      { scope: "operator.admin" },
    );
  }
}
