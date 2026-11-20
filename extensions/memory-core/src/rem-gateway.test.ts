import type { GatewayRequestHandlerOptions } from "openclaw/plugin-sdk/gateway-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { beforeEach, expect, it, vi } from "vitest";
import { registerMemoryRemGatewayMethods } from "./rem-gateway.js";

const fixture = vi.hoisted(() => ({
  current: true,
  run: vi.fn(),
}));
vi.mock("./cli.runtime.js", () => ({
  runMemoryPromote: fixture.run,
  runMemoryRemHarness: fixture.run,
  runMemoryIndex: fixture.run,
}));
// Physical owner transport is tested by core. Here a real handler must retain the
// selected request's authority across runtime loading, operation and disclosure.
vi.mock("openclaw/plugin-sdk/gateway-runtime", async (original) => ({
  ...(await original<typeof import("openclaw/plugin-sdk/gateway-runtime")>()),
  runWithLocalStateMutationOwner: async (
    owner: string,
    _invocation: unknown,
    run: (assertCurrent: () => void) => Promise<unknown>,
  ) => {
    const assertCurrent = () => {
      if (owner !== "current-owner" || !fixture.current) throw new Error("owner retired");
    };
    assertCurrent();
    return run(assertCurrent);
  },
}));

function harness() {
  const methods = new Map<
    string,
    { handler: (o: GatewayRequestHandlerOptions) => Promise<void>; scope?: string }
  >();
  const cfg = { agents: { entries: { pixi: {} } } };
  const api = {
    runtime: { config: { current: () => cfg } },
    registerGatewayMethod: (
      name: string,
      handler: (o: GatewayRequestHandlerOptions) => Promise<void>,
      options: { scope?: string },
    ) => {
      methods.set(name, { handler, ...options });
    },
  } as unknown as OpenClawPluginApi;
  registerMemoryRemGatewayMethods(api, {});
  return async (operation: string, params: Record<string, unknown>) => {
    const respond = vi.fn();
    const method = methods.get(`memory.${operation}.owner`)!;
    expect(method.scope).toBe("operator.admin");
    await method.handler({ params, respond } as unknown as GatewayRequestHandlerOptions);
    return respond;
  };
}

beforeEach(() => {
  fixture.current = true;
  fixture.run.mockReset();
});

it.each(["promote", "remHarness", "index"])(
  "serves %s through selected owner and returns request-scoped output",
  async (op) => {
    fixture.run.mockImplementation(async (_options, _host, execution) => {
      execution.output.log("completed");
      if (op !== "index") execution.output.writeJson({ candidates: [], workspaceDir: "/fixture" });
    });
    const respond = await harness()(op, { expectedOwnerId: "current-owner", agent: "pixi" });
    expect(respond).toHaveBeenCalledWith(true, {
      output: [
        { kind: "log", text: "completed" },
        ...(op === "index"
          ? []
          : [{ kind: "json", value: { candidates: [], workspaceDir: "/fixture" } }]),
      ],
    });
  },
);

it.each([
  ["promote", { apply: true }],
  ["promote", { minScore: Infinity }],
  ["promote", { limit: 0 }],
  ["promote", { minRecallCount: -1 }],
  ["remHarness", { path: "/arbitrary" }],
  ["index", { force: "true" }],
  ["promote", { agent: "unknown" }],
  ["index", { expectedOwnerId: "" }],
])("rejects invalid %s input before loading the operation", async (op, bad) => {
  const respond = await harness()(op, { expectedOwnerId: "current-owner", agent: "pixi", ...bad });
  expect(respond.mock.calls[0]?.[0]).toBe(false);
  expect(respond.mock.calls[0]?.[2]).toMatchObject({ code: "INVALID_REQUEST" });
  expect(fixture.run).not.toHaveBeenCalled();
});

it("refuses a foreign owner without executing memory work", async () => {
  const respond = await harness()("promote", { expectedOwnerId: "old-owner", agent: "pixi" });
  expect(respond.mock.calls[0]?.[0]).toBe(false);
  expect(fixture.run).not.toHaveBeenCalled();
});

it("does not disclose a late result after owner retirement", async () => {
  fixture.run.mockImplementation(async (_opts, _host, execution) => {
    execution.output.writeJson({ candidates: [] });
    await Promise.resolve();
    fixture.current = false;
  });
  const respond = await harness()("remHarness", {
    expectedOwnerId: "current-owner",
    agent: "pixi",
  });
  expect(respond.mock.calls[0]?.[0]).toBe(false);
  expect(respond.mock.calls[0]?.[1]).toBeUndefined();
});

it("reports domain/index failure instead of success", async () => {
  fixture.run.mockRejectedValueOnce(new Error("index unavailable"));
  const respond = await harness()("index", { expectedOwnerId: "current-owner", agent: "pixi" });
  expect(respond.mock.calls[0]?.[0]).toBe(false);
  expect(respond.mock.calls[0]?.[2]).toMatchObject({ code: "UNAVAILABLE" });
});
