import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // 数据库集成测试的 beforeAll 要在 PGlite 里按顺序重放全部迁移；迁移越多、并行跑得越多，
    // 越容易超过默认的 10 秒（表现为随机的 "Hook timed out"）；个别测试在用例里重放迁移链，
    // 同样会超过默认的 5 秒。
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
});
