export type LatencySample =
  | { status: "ok"; ms: number }
  | { status: "timeout" }
  | { status: "error" }
  | { status: "signed_out" };

type MeasureOptions = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  signal?: AbortSignal;
};

async function measure(
  url: string,
  init: RequestInit,
  {
    fetchImpl = fetch,
    now = () => performance.now(),
    timeoutMs = 5000,
    signal,
  }: MeasureOptions,
): Promise<LatencySample> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortWithCaller = () => controller.abort();
  signal?.addEventListener("abort", abortWithCaller);

  const startedAt = now();
  try {
    const response = await fetchImpl(url, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
    });
    const ms = Math.max(0, Math.round(now() - startedAt));
    // redirect: "manual" 下，被 proxy 挡回登录页的请求在浏览器里就是 opaqueredirect。
    if (response.type === "opaqueredirect") return { status: "signed_out" };
    if (!response.ok) return { status: "error" };
    return { status: "ok", ms };
  } catch {
    return timedOut ? { status: "timeout" } : { status: "error" };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortWithCaller);
  }
}

/**
 * 纯网络往返：HEAD 静态图标。proxy 的 matcher 放行它，由边缘节点直接返回，
 * 不经过任何函数或数据库，所以只反映浏览器到 Vercel 的网络质量。
 */
export function measureNetworkLatency(options: MeasureOptions = {}) {
  return measure("/favicon.ico", { method: "HEAD" }, options);
}

/**
 * 服务往返：GET /api/ping。它会先过 proxy（校验登录状态，要访问 Supabase），
 * 所以数值包含函数与数据库的耗时，等同于打开一个页面之前必付的固定成本。
 */
export function measureServiceLatency(options: MeasureOptions = {}) {
  return measure("/api/ping", { method: "GET", redirect: "manual" }, options);
}
