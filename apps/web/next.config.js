/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // proxy api requests to nestjs server
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `http://localhost:${process.env.PORT || 3000}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
