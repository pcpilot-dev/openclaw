import { beforeEach, expect, it, vi } from "vitest";
import { withMemoryCommand, type MemoryCommandExecution } from "./cli-runtime-common.js";

const fixture = vi.hoisted(() => ({ getManager: vi.fn() }));
// Only acquisition is external; real withManager must settle cleanup failures.
vi.mock("./memory/index.js", () => ({ getMemorySearchManager: fixture.getManager }));
beforeEach(() => fixture.getManager.mockReset());
function execution(assertCurrent = () => {}): MemoryCommandExecution {
  return {
    config: { agents: { entries: { pixi: {} } } },
    assertCurrent,
    output: { log: vi.fn(), error: vi.fn(), writeJson: vi.fn() },
  };
}
it("rejects owner-mode success if manager cleanup fails without touching process exit state", async () => {
  const closeError = new Error("manager drain failed");
  fixture.getManager.mockResolvedValueOnce({
    manager: {
      close: async () => {
        throw closeError;
      },
    },
  });
  const previousExitCode = process.exitCode;
  await expect(
    withMemoryCommand({
      commandName: "memory promote",
      options: { agent: "pixi", json: true },
      execution: execution(),
      run: async () => {},
    }),
  ).rejects.toBe(closeError);
  expect(process.exitCode).toBe(previousExitCode);
});
it("refuses domain work when authority retires during awaited manager acquisition", async () => {
  let current = true;
  const close = vi.fn();
  const domain = vi.fn();
  fixture.getManager.mockImplementation(async () => {
    await Promise.resolve();
    current = false;
    return { manager: { close } };
  });
  await expect(
    withMemoryCommand({
      commandName: "memory index",
      options: { agent: "pixi" },
      execution: execution(() => {
        if (!current) throw new Error("owner retired");
      }),
      run: domain,
    }),
  ).rejects.toThrow("owner retired");
  expect(domain).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
});
it("rejects missing manager rather than emitting apparently successful JSON", async () => {
  fixture.getManager.mockResolvedValueOnce({ manager: null, error: "provider unavailable" });
  const context = execution();
  await expect(
    withMemoryCommand({
      commandName: "memory rem-harness",
      options: { agent: "pixi", json: true },
      execution: context,
      run: async () => {},
    }),
  ).rejects.toThrow("provider unavailable");
  expect(context.output.writeJson).not.toHaveBeenCalled();
});
