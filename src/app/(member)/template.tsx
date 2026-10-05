/**
 * 每次切换到新的子路由时重新挂载，从而播放一次淡入（见 globals.css 的 .page-enter）。
 * 外壳的内容区是纵向 flex，所以包装层也用 flex-1 + flex-col，页面原有的撑满高度行为不变。
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter flex min-h-0 flex-1 flex-col">{children}</div>;
}
