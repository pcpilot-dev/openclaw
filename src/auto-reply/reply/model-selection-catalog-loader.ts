import { resolveAgentDir, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import type { ModelCatalogEntry, ModelCatalogSnapshot } from "../../agents/model-catalog.types.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { createLazyImportLoader } from "../../shared/lazy-promise.js";

const modelCatalogRuntimeLoader = createLazyImportLoader(
  () => import("../../agents/model-catalog.runtime.js"),
);

function loadPreparedModelCatalogRuntime() {
  return modelCatalogRuntimeLoader.load();
}

export function createModelSelectionCatalogLoader(params: {
  config: OpenClawConfig;
  agentId: string | undefined;
  preparedModelCatalog: ModelCatalogSnapshot | undefined;
  loadFullModelCatalog: (() => Promise<ModelCatalogSnapshot>) | undefined;
}) {
  const catalogAgentId = params.agentId ?? resolveDefaultAgentId(params.config);
  const catalogScope = {
    config: params.config,
    agentId: catalogAgentId,
    agentDir: resolveAgentDir(params.config, catalogAgentId),
  };
  const loadRuntimeModelCatalogSnapshot = async (): Promise<ModelCatalogSnapshot> =>
    params.preparedModelCatalog ??
    (await (
      await loadPreparedModelCatalogRuntime()
    ).loadPreparedModelCatalogSnapshot(catalogScope));
  let fullModelCatalogPromise: Promise<ModelCatalogSnapshot> | undefined;
  const loadExpandedModelCatalogSnapshot = (): Promise<ModelCatalogSnapshot> => {
    if (!params.loadFullModelCatalog) {
      return loadRuntimeModelCatalogSnapshot();
    }
    fullModelCatalogPromise ??= params.loadFullModelCatalog();
    return fullModelCatalogPromise;
  };
  const loadManifestModelCatalog = async (): Promise<ModelCatalogEntry[]> =>
    (await loadPreparedModelCatalogRuntime()).loadManifestModelCatalog({
      config: params.config,
      fallbackToMetadataScan: false,
    });

  return {
    loadExpandedModelCatalogSnapshot,
    loadManifestModelCatalog,
    loadRuntimeModelCatalogSnapshot,
  };
}
