import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // 客户端路由缓存：30 秒内回到已访问过的动态页面时直接用缓存，不再等服务端取数。
    // 代价是这 30 秒内页面里非实时的数据（如未读数）可能略旧；聊天消息走 Realtime，不受影响。
    // 写操作的 Server Action 仍会让相关缓存失效。
    staleTimes: { dynamic: 30 },
  },
};

export default nextConfig;
