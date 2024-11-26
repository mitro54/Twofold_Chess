import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "socket.io-client": require.resolve("socket.io-client"),
    };
    return config;
  },
};

export default nextConfig;