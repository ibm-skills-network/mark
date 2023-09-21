/** @type {import('next').NextConfig} */

console.log("API_GATEWAY_HOST:", process.env.API_GATEWAY_HOST);
console.log("API_GATEWAY_PORT:", process.env.API_GATEWAY_PORT);

const nextConfig = {
  reactStrictMode: true,
  // proxy api requests to nestjs server
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.API_GATEWAY_HOST || "http://localhost"}:${
          process.env.API_GATEWAY_PORT || 8000
        }/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
