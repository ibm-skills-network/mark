/** @type {import('next').NextConfig} */

const nextConfig = {
  reactStrictMode: true,
  // proxy api requests to nestjs server
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.API_GATEWAY_HOST || "http://localhost:8080"}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
