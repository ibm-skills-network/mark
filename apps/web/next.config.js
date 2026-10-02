/** @type {import('next').NextConfig} */
if (
  process.env.NODE_ENV === "production" &&
  process.env.INSTANA_ENABLED !== "false"
) {
  const instana = require("@instana/collector");
  instana({
    level: "warn",
    tracing: {
      stackTraceLength: 20,
      http: {
        captureAsyncContext: true,
        extraHttpHeadersToCapture: [
          "user-agent",
          "x-request-id",
          "x-correlation-id",
        ],
      },
    },
  });
}
const nextConfig = {
  reactStrictMode: true,
  // Workspace package shipped as TypeScript source; Next has to compile it
  // rather than treating it as a prebuilt node_module.
  // rich-text ships TypeScript source; lowlight and its deps are ESM-only and
  // have no CommonJS build. Declaring them here covers both the production
  // build and next/jest, which derives its transform exceptions from this list.
  transpilePackages: ["rich-text", "lowlight", "devlop", "highlight.js"],
  compiler: {
    styledComponents: true,
  },

  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination:
          process.env.NODE_ENV === "production"
            ? "http://{API_GATEWAY_HOST}/api/:path*"
            : `${process.env.API_GATEWAY_HOST}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
