import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // 後台課程圖片走 server action 上傳，放寬 body 上限（預設 1MB）
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
