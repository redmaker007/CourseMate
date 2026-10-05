/**
 * 路由切换时的占位界面。
 *
 * 页面是服务端渲染的，点击链接后要等取数完成才有内容；用 loading.tsx 挂上这个骨架，
 * 点击后立刻有反馈，外壳（导航）保持可操作。只用设计变量，深浅色自动跟随。
 */
function Block({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-lg bg-[var(--panel)] ${className}`} />;
}

export function PageSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-busy="true" aria-label="加载中" className="space-y-4 p-4">
      <Block className="h-8 w-1/3" />
      {Array.from({ length: rows }, (_, index) => (
        <Block key={index} className="h-20 w-full" />
      ))}
    </div>
  );
}
