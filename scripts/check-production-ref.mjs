import { pathToFileURL } from "node:url";

// Vercel 构建前置检查：生产构建只允许来自 main。
// 后台对功能分支预览点 Promote / Redeploy 到生产时也会重新构建，此时本检查让构建失败，生产域名保持原版本。
// 2026-10-27 曾把未合并、依赖未上线迁移的 PR #61 预览 Promote 到生产，导致全员无法登录。

export const PRODUCTION_BRANCH = "main";

export function checkProductionRef(env) {
  if (env.VERCEL_ENV !== "production") return { ok: true };
  const ref = env.VERCEL_GIT_COMMIT_REF ?? "";
  if (ref === PRODUCTION_BRANCH) return { ok: true };
  return {
    ok: false,
    message:
      `拒绝生产构建：来源分支是 "${ref || "(未知)"}"，只允许 "${PRODUCTION_BRANCH}"。` +
      "先合并到 main，并确认所需迁移已在生产库应用，再从干净的 main 执行 npx vercel deploy --prod。" +
      "见 docs/runbooks/deploy.md。",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = checkProductionRef(process.env);
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
}
