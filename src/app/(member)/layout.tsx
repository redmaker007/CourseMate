import { getCurrentMember } from "@/features/auth/session";
import { AppShell } from "@/features/shell/components/app-shell";
import { loadShellData } from "@/features/shell/queries";

/**
 * 登录后页面共用的导航外壳。
 *
 * 这里只负责展示导航，不做访问控制：每个页面仍然自己调用 getCurrentMember，
 * 并决定跳转登录页还是补全资料页。不能只信 layout，因为客户端导航时 layout 不会重新执行。
 * 未登录或资料未补全时不渲染导航，交给页面去跳转。
 */
export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const member = await getCurrentMember();
  if (!member?.onboardingComplete) return children;

  const data = await loadShellData(member);
  return <AppShell data={data}>{children}</AppShell>;
}
