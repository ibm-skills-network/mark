/** @type {import('next').NextConfig} */
if (process.env.NODE_ENV === "production") {
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

  experimental: {
    useDeploymentId: false,
  },
};

module.exports = nextConfig;
