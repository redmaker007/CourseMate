/**
 * 每次切换到新的子路由时重新挂载，从而播放一次淡入（见 globals.css 的 .page-enter）。
 * 右栏是纵向 flex，所以包装层也用 flex-1 + flex-col，页面原有的撑满高度行为不变。
 *
 * 注意：不要在 (member) 层再包一层同样的包装——外壳内容区底部要给手机标签栏留空，
 * 页面比屏幕高时，被包装层压矮的页面会把这段空白吞掉，导致滑不到最底部。
 * 普通页面直接在根元素上加 page-enter 即可（页面切换时根元素本来就会重新挂载）。
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter flex min-h-0 flex-1 flex-col">{children}</div>;
}
