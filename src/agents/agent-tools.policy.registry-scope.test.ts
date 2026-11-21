import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  captureActivePluginRegistrySnapshot,
  restoreActivePluginRegistrySnapshot,
  setActivePluginRegistry,
} from "../plugins/runtime.js";
import {
  ExpiredPluginRegistryScopeError,
  withPluginRuntimeGatewayRequestScope,
  withPluginRuntimeRegistryScope,
} from "../plugins/runtime/gateway-request-scope.js";
import { createChannelTestPluginBase, createTestRegistry } from "../test-utils/channel-plugins.js";
import { resolveGroupToolPolicy } from "./agent-tools.policy.js";
import { isToolAllowedByPolicyName } from "./tool-policy-match.js";

function registry(accountId: string, allow: string[]) {
  return createTestRegistry([
    {
      pluginId: "fixture-whatsapp",
      source: "fixture",
      plugin: {
        ...createChannelTestPluginBase({
          id: "whatsapp",
          config: { listAccountIds: () => [accountId] },
        }),
        groups: {
          resolveToolPolicy: ({ accountId: requested }: { accountId?: string | null }) =>
            requested === accountId ? { allow } : { deny: ["*"] },
        },
      },
    },
  ]);
}

const config: OpenClawConfig = {};
const group = {
  config,
  sessionKey: "agent:fixture:whatsapp:group:room",
  accountId: "alpha",
};
const snapshot = captureActivePluginRegistrySnapshot();

beforeEach(() => setActivePluginRegistry(registry("root", ["exec"])));
afterEach(() => restoreActivePluginRegistrySnapshot(snapshot));

describe("request-registry account and tool-policy isolation", () => {
  it("resolves the scheduled account and its restrictive tool policy from the request", () => {
    withPluginRuntimeRegistryScope(registry("alpha", ["read"]), () => {
      const policy = resolveGroupToolPolicy({ ...group, requireConfiguredAccount: true });
      expect(policy).toEqual({ allow: ["read"] });
      expect(isToolAllowedByPolicyName("read", policy)).toBe(true);
      expect(isToolAllowedByPolicyName("exec", policy)).toBe(false);
    });
  });

  it.each(["root", "removed"])(
    "rejects scheduled account %s absent from the request",
    (accountId) => {
      withPluginRuntimeRegistryScope(registry("alpha", ["read"]), () => {
        expect(() =>
          resolveGroupToolPolicy({ ...group, accountId, requireConfiguredAccount: true }),
        ).toThrow(`Scheduled account "${accountId}" is unavailable`);
      });
    },
  );

  it("does not borrow a root channel when the scoped registry has none", () => {
    withPluginRuntimeRegistryScope(createTestRegistry(), () => {
      expect(() =>
        resolveGroupToolPolicy({ ...group, accountId: "root", requireConfiguredAccount: true }),
      ).toThrow('Scheduled account "root" is unavailable');
      expect(resolveGroupToolPolicy(group)).toBeUndefined();
    });
  });

  it.each([
    { accountId: "alpha", requireConfiguredAccount: false },
    { accountId: "default", requireConfiguredAccount: true },
  ])("rejects expired request authority for $accountId", (account) => {
    const fallbackConfig: OpenClawConfig = {
      channels: { whatsapp: { groups: { room: { tools: { allow: ["exec"] } } } } },
    };
    withPluginRuntimeGatewayRequestScope(
      {
        isWebchatConnect: () => false,
        // Deterministic fault at the borrowed-registry boundary, without GC timing.
        get pluginRegistry() {
          throw new ExpiredPluginRegistryScopeError();
        },
      },
      () => {
        expect(() =>
          resolveGroupToolPolicy({ ...group, ...account, config: fallbackConfig }),
        ).toThrow(ExpiredPluginRegistryScopeError);
      },
    );
  });

  it("keeps concurrent asynchronous scopes separate and restores the unscoped fallback", async () => {
    const policies = await Promise.all(
      ["alpha", "beta"].map((accountId) =>
        withPluginRuntimeRegistryScope(
          registry(accountId, [accountId === "alpha" ? "read" : "write"]),
          async () => {
            await Promise.resolve();
            return resolveGroupToolPolicy({ ...group, accountId, requireConfiguredAccount: true });
          },
        ),
      ),
    );
    expect(policies).toEqual([{ allow: ["read"] }, { allow: ["write"] }]);
    expect(
      resolveGroupToolPolicy({ ...group, accountId: "root", requireConfiguredAccount: true }),
    ).toEqual({ allow: ["exec"] });
    expect(() => resolveGroupToolPolicy({ ...group, requireConfiguredAccount: true })).toThrow(
      'Scheduled account "alpha" is unavailable',
    );
  });

  it("checks scheduled direct-account authority even without a group policy", () => {
    withPluginRuntimeRegistryScope(registry("alpha", ["read"]), () => {
      const direct = {
        ...group,
        sessionKey: "agent:fixture:whatsapp:direct:sender",
        messageProvider: "whatsapp",
        requireConfiguredAccount: true,
      };
      expect(resolveGroupToolPolicy(direct)).toBeUndefined();
      expect(() => resolveGroupToolPolicy({ ...direct, accountId: "root" })).toThrow(
        'Scheduled account "root" is unavailable',
      );
    });
  });
});
