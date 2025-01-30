/** @type {import('next').NextConfig} */

const nextConfig = {
  reactStrictMode: true, // for development
  compiler: {
    styledComponents: true,
  },
  // ignore typescript errors
  // typescript: {
  //   ignoreBuildErrors: true,
  // },
  // proxy api requests to nestjs server
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
