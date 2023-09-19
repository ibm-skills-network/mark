/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // ignore typescript errors
  // typescript: {
  //   ignoreBuildErrors: true,
  // },
  // proxy api requests to nestjs server
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `http://localhost:${
          process.env.API_GATEWAY_PORT || 8000
        }/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
