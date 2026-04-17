/** @type {import('next').NextConfig} */
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
};

module.exports = nextConfig;
