/* eslint-disable @typescript-eslint/no-var-requires, unicorn/prefer-module --
   lazily require()s the heavy Traceloop SDK only when enabled */
/**
 * Gen AI observability bootstrap (Instana / OpenLLMetry).
 *
 * Side-effect module: importing it initializes Traceloop's OpenTelemetry layer
 * so that gen_ai.* spans are emitted for auto-instrumented LLM libraries.
 *
 * Gated behind INSTANA_GENAI_ENABLED — a no-op unless the flag is "true".
 * Must be imported before any LLM library loads so instrumentation patches
 * those modules at require time; main.ts enforces that ordering.
 *
 * The OTLP endpoint and headers are read from the environment by the SDK
 * (TRACELOOP_BASE_URL / TRACELOOP_HEADERS / OTEL_EXPORTER_OTLP_ENDPOINT); they
 * are not passed explicitly here.
 */
if (process.env.INSTANA_GENAI_ENABLED === "true") {
  try {
    // Lazy require so the SDK and its instrumentation only load when enabled.
    const traceloop =
      require("@traceloop/node-server-sdk") as typeof import("@traceloop/node-server-sdk");
    traceloop.initialize({
      appName: process.env.OTEL_SERVICE_NAME || "mark-api",
      disableBatch: process.env.NODE_ENV !== "production",
      traceContent: process.env.TRACELOOP_TRACE_CONTENT === "true",
    });
  } catch (error) {
    // Telemetry must never crash boot. console is acceptable here because this
    // runs at bootstrap before the Nest/winston logger exists.
    // eslint-disable-next-line no-console
    console.warn("[gen-ai] instrumentation init failed", error);
  }
}
