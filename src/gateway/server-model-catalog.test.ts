import { describe, expect, it, vi } from "vitest";
import type { ModelCatalogSnapshot } from "../agents/model-catalog.types.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  loadGatewayModelCatalog,
  loadGatewayModelCatalogSnapshot,
  readPreparedGatewayModelCatalogSnapshot,
  type GatewayModelCatalogSnapshot,
} from "./server-model-catalog.js";
import type { GatewayModelCatalogOwnerSnapshot } from "./server-model-catalog.types.js";

const snapshot: ModelCatalogSnapshot = {
  entries: [{ provider: "openai", id: "gpt-5.5", name: "GPT-5.5" }],
  routeVariants: [],
};

function ownerConfig(agentId = "main", extra: OpenClawConfig = {}): OpenClawConfig {
  return {
    ...extra,
    agents: {
      ...extra.agents,
      list: [
        {
          id: agentId,
          default: true,
          agentDir: "/tmp/gateway-agent",
          workspace: "/tmp/gateway-workspace",
        },
      ],
    },
  };
}

function ownerSnapshot(
  config: OpenClawConfig,
  modelCatalog: ModelCatalogSnapshot = snapshot,
  agentId: string,
) {
  return {
    agentId,
    agentDir: "/tmp/gateway-agent",
    config,
    modelCatalog,
  };
}

describe("gateway prepared model catalog", () => {
  it("reads the configured gateway owner with the startup binding identity", async () => {
    const config = ownerConfig("worker");
    const getPreparedModelCatalogOwnerSnapshot = vi.fn(() => ({
      ...ownerSnapshot(config, snapshot, "worker"),
      workspaceDir: "/tmp/gateway-workspace",
    }));

    await expect(
      readPreparedGatewayModelCatalogSnapshot({
        agentId: "worker",
        getConfig: () => config,
        getPreparedModelCatalogOwnerSnapshot,
      }),
    ).resolves.toMatchObject({ agentId: "worker", entries: snapshot.entries });
    expect(getPreparedModelCatalogOwnerSnapshot).toHaveBeenCalledWith({
      agentId: "worker",
      allowGatewaySubagentBinding: true,
      config,
      readOnly: true,
    });
  });

  it("reads the published read-only generation directly", async () => {
    const config = ownerConfig();
    const loadPublishedPreparedModelCatalogOwnerSnapshot = vi.fn(async () =>
      ownerSnapshot(config, snapshot, "main"),
    );

    await expect(
      loadGatewayModelCatalog({
        getConfig: () => config,
        loadPublishedPreparedModelCatalogOwnerSnapshot,
      }),
    ).resolves.toBe(snapshot.entries);
    expect(loadPublishedPreparedModelCatalogOwnerSnapshot).toHaveBeenCalledWith({
      config,
      readOnly: true,
    });
  });

  it("forwards the requested agent lifecycle owner", async () => {
    const config = ownerConfig("worker");
    const loadPublishedPreparedModelCatalogOwnerSnapshot = vi.fn(async () => ({
      ...ownerSnapshot(config, snapshot, "worker"),
      workspaceDir: "/tmp/gateway-workspace",
    }));

    await expect(
      loadGatewayModelCatalogSnapshot({
        agentId: "worker",
        agentDir: "/tmp/gateway-agent",
        getConfig: () => config,
        loadPublishedPreparedModelCatalogOwnerSnapshot,
        workspaceDir: "/tmp/gateway-workspace",
      }),
    ).resolves.toMatchObject({
      agentId: "worker",
      agentDir: "/tmp/gateway-agent",
      config,
      workspaceDir: "/tmp/gateway-workspace",
    } satisfies Partial<GatewayModelCatalogSnapshot>);

    expect(loadPublishedPreparedModelCatalogOwnerSnapshot).toHaveBeenCalledWith({
      agentId: "worker",
      agentDir: "/tmp/gateway-agent",
      config,
      readOnly: true,
      workspaceDir: "/tmp/gateway-workspace",
    });
  });

  it("rejects an ambiguous owner without an authoritative agent identity", async () => {
    const config = {
      agents: {
        list: [
          {
            id: "main",
            default: true,
            agentDir: "/tmp/gateway-agent",
            workspace: "/tmp/main-workspace",
          },
          {
            id: "worker",
            agentDir: "/tmp/gateway-agent",
            workspace: "/tmp/worker-workspace",
          },
        ],
      },
    } as OpenClawConfig;
    const ambiguousOwner = {
      agentDir: "/tmp/gateway-agent",
      config,
      modelCatalog: snapshot,
    } as unknown as GatewayModelCatalogOwnerSnapshot;
    const loadPublishedPreparedModelCatalogOwnerSnapshot = vi.fn(async () => ambiguousOwner);

    await expect(
      loadGatewayModelCatalogSnapshot({
        agentId: "worker",
        getConfig: () => config,
        loadPublishedPreparedModelCatalogOwnerSnapshot,
      }),
    ).rejects.toThrow("did not identify one configured agent");
  });

  it("returns an equivalent replacement owner without repeating discovery", async () => {
    const initialConfig = ownerConfig("main", { logging: { level: "info" as const } });
    const latestConfig = ownerConfig("main", { logging: { level: "info" as const } });
    const latestSnapshot: ModelCatalogSnapshot = {
      entries: [{ provider: "openai", id: "latest", name: "Latest" }],
      routeVariants: [],
    };
    const loadPublishedPreparedModelCatalogOwnerSnapshot = vi.fn(async () =>
      ownerSnapshot(latestConfig, latestSnapshot, "main"),
    );

    await expect(
      loadGatewayModelCatalogSnapshot({
        getConfig: () => initialConfig,
        loadPublishedPreparedModelCatalogOwnerSnapshot,
      }),
    ).resolves.toMatchObject({ config: latestConfig, entries: latestSnapshot.entries });
    expect(loadPublishedPreparedModelCatalogOwnerSnapshot).toHaveBeenCalledOnce();
  });

  it("selects the full prepared owner when requested", async () => {
    const config = ownerConfig();
    const loadPublishedPreparedModelCatalogOwnerSnapshot = vi.fn(async () =>
      ownerSnapshot(config, snapshot, "main"),
    );

    await expect(
      loadGatewayModelCatalogSnapshot({
        getConfig: () => config,
        loadPublishedPreparedModelCatalogOwnerSnapshot,
        readOnly: false,
      }),
    ).resolves.toMatchObject(snapshot);
    expect(loadPublishedPreparedModelCatalogOwnerSnapshot).toHaveBeenCalledWith({
      config,
      readOnly: false,
    });
  });

  it("does not hide lifecycle publication failures behind stale data", async () => {
    const error = new Error("generation failed");
    const loadPublishedPreparedModelCatalogOwnerSnapshot = vi.fn(async () => {
      throw error;
    });

    await expect(
      loadGatewayModelCatalogSnapshot({ loadPublishedPreparedModelCatalogOwnerSnapshot }),
    ).rejects.toBe(error);
  });
});
