/** Structured error reason used while gateway startup sidecars are still initializing. */
export const GATEWAY_STARTUP_UNAVAILABLE_REASON = "startup-sidecars";
/** Structured reason used while a prepared model catalog is atomically reloading. */
export const GATEWAY_PREPARED_CATALOG_RELOADING_REASON = "prepared-catalog-reloading";
/** Internal close cause that distinguishes startup retry closes from generic disconnects. */
export const GATEWAY_STARTUP_PENDING_CLOSE_CAUSE = "startup-sidecars-pending";
/** WebSocket close code for temporary gateway unavailability. */
export const GATEWAY_STARTUP_CLOSE_CODE = 1013;
/** Human-readable WebSocket close reason for temporary gateway startup unavailability. */
export const GATEWAY_STARTUP_CLOSE_REASON = "gateway starting";
/** Default retry-after hint sent with startup-unavailable handshake errors. */
export const GATEWAY_STARTUP_RETRY_AFTER_MS = 500;
const GATEWAY_STARTUP_RETRY_MIN_MS = 100;
const GATEWAY_STARTUP_RETRY_MAX_MS = 2_000;

/** Details payload attached to retryable startup-unavailable gateway errors. */
type GatewayStartupUnavailableDetails = {
  reason: typeof GATEWAY_STARTUP_UNAVAILABLE_REASON;
};

type GatewayPreparedCatalogReloadingDetails = {
  reason: typeof GATEWAY_PREPARED_CATALOG_RELOADING_REASON;
};

/** Builds the canonical startup-unavailable details payload. */
export function gatewayStartupUnavailableDetails(): GatewayStartupUnavailableDetails {
  return { reason: GATEWAY_STARTUP_UNAVAILABLE_REASON };
}

/** Builds the canonical prepared-catalog reload details payload. */
export function gatewayPreparedCatalogReloadingDetails(): GatewayPreparedCatalogReloadingDetails {
  return { reason: GATEWAY_PREPARED_CATALOG_RELOADING_REASON };
}

function isGatewayStartupUnavailableDetails(
  details: unknown,
): details is GatewayStartupUnavailableDetails {
  return (
    typeof details === "object" &&
    details !== null &&
    (details as { reason?: unknown }).reason === GATEWAY_STARTUP_UNAVAILABLE_REASON
  );
}

function isGatewayPreparedCatalogReloadingDetails(
  details: unknown,
): details is GatewayPreparedCatalogReloadingDetails {
  return (
    typeof details === "object" &&
    details !== null &&
    (details as { reason?: unknown }).reason === GATEWAY_PREPARED_CATALOG_RELOADING_REASON
  );
}

function isRetryableUnavailableWithDetails(
  error: unknown,
  matchesDetails: (details: unknown) => boolean,
): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const shaped = error as {
    code?: unknown;
    gatewayCode?: unknown;
    retryable?: unknown;
    details?: unknown;
  };
  const code = shaped.gatewayCode ?? shaped.code;
  return code === "UNAVAILABLE" && shaped.retryable === true && matchesDetails(shaped.details);
}

/** Detects the structured retryable error emitted while startup sidecars are pending. */
export function isRetryableGatewayStartupUnavailableError(error: unknown): boolean {
  return isRetryableUnavailableWithDetails(error, isGatewayStartupUnavailableDetails);
}

/** Detects a structured retryable error emitted during prepared-catalog reload. */
export function isRetryableGatewayPreparedCatalogReloadingError(error: unknown): boolean {
  return isRetryableUnavailableWithDetails(error, isGatewayPreparedCatalogReloadingDetails);
}

function resolveBoundedRetryAfterMs(error: unknown): number {
  const retryAfterMs = (error as { retryAfterMs?: unknown }).retryAfterMs;
  const raw =
    typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs)
      ? retryAfterMs
      : GATEWAY_STARTUP_RETRY_AFTER_MS;
  return Math.min(
    Math.max(Math.floor(raw), GATEWAY_STARTUP_RETRY_MIN_MS),
    GATEWAY_STARTUP_RETRY_MAX_MS,
  );
}

/** Resolves a bounded retry-after delay from a startup-unavailable error. */
export function resolveGatewayStartupRetryAfterMs(error: unknown): number | null {
  if (!isRetryableGatewayStartupUnavailableError(error)) {
    return null;
  }
  return resolveBoundedRetryAfterMs(error);
}

/** Resolves a bounded retry delay for a prepared-catalog reload error. */
export function resolveGatewayPreparedCatalogReloadRetryAfterMs(error: unknown): number | null {
  if (!isRetryableGatewayPreparedCatalogReloadingError(error)) {
    return null;
  }
  return resolveBoundedRetryAfterMs(error);
}
