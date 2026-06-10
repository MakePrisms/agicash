type SparkConfig = {
  /** Breez API key (the web app reads it from its Vite env). */
  apiKey: string;
  /** Gate for spark/Breez debug logging; checked per log call. */
  isDebugLoggingEnabled: () => boolean;
};

let sparkConfig: SparkConfig | undefined;
let debugLoggingOverride: (() => boolean) | undefined;

/**
 * Configures the spark/Breez connection. The host app calls this once at
 * startup (the web app does it at module load of its spark feature, supplying
 * the env-derived API key and the feature-flag-gated debug-log check).
 */
export function configureSpark(config: {
  apiKey: string;
  isDebugLoggingEnabled?: () => boolean;
}): void {
  sparkConfig = { isDebugLoggingEnabled: () => false, ...config };
}

export function getSparkConfig(): SparkConfig {
  if (!sparkConfig) {
    throw new Error('Spark is not configured. Call configureSpark first.');
  }
  return sparkConfig;
}

/**
 * Binds the debug-logging gate separately from configureSpark, in either
 * order. Exists so the host can wire a gate that depends on modules which
 * must not be imported by its SDK-configuration entrypoint (the web's
 * feature-flag module would create an import cycle there).
 */
export function setSparkDebugLogging(isEnabled: () => boolean): void {
  debugLoggingOverride = isEnabled;
}

/** Non-throwing check — debug logging is off while spark is unconfigured. */
export function isSparkDebugLoggingEnabled(): boolean {
  return (
    (debugLoggingOverride ?? sparkConfig?.isDebugLoggingEnabled)?.() ?? false
  );
}

export function sparkDebugLog(message: string, data?: Record<string, unknown>) {
  if (isSparkDebugLoggingEnabled()) {
    console.debug(`[Spark] ${message}`, data ?? '');
  }
}
