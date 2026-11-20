import { runWithLocalStateOwner } from "openclaw/plugin-sdk/cli-state-owner";
import { defaultRuntime } from "openclaw/plugin-sdk/memory-core-host-runtime-cli";
import type { MemoryPromoteCommandOptions, MemoryRemHarnessOptions } from "./cli.types.js";
import type { MemoryCoreRuntimeHost } from "./memory/runtime-host.js";

export type MemoryOwnerOperation = "promote" | "remHarness" | "index";
export type MemoryOwnerOutput =
  | { kind: "log" | "error"; text: string }
  | { kind: "json"; value: unknown };

export async function runMemoryRemWithOwner(
  operation: MemoryOwnerOperation,
  opts: MemoryPromoteCommandOptions & MemoryRemHarnessOptions,
  hostOptions?: MemoryCoreRuntimeHost,
): Promise<void> {
  // Arbitrary local input paths and durable promotion keep their offline contract.
  const offline = Boolean(opts.apply || opts.path);
  const reply = await runWithLocalStateOwner<{ output: MemoryOwnerOutput[] } | undefined>({
    method: `memory.${operation}.owner`,
    params: Object.fromEntries(Object.entries(opts).filter(([, value]) => value !== undefined)),
    target: `memory ${operation}`,
    databaseEngine: "configured",
    ...(offline ? { onForeignOwner: "refuse" as const } : {}),
    runLocal: async () => {
      const runtime = await import("./cli.runtime.js");
      if (operation === "promote") await runtime.runMemoryPromote(opts, hostOptions);
      else if (operation === "remHarness") await runtime.runMemoryRemHarness(opts, hostOptions);
      else await runtime.runMemoryIndex(opts, hostOptions);
    },
  });
  for (const item of reply?.output ?? []) {
    if (item.kind === "json") defaultRuntime.writeJson(item.value);
    else defaultRuntime[item.kind](item.text);
  }
}
