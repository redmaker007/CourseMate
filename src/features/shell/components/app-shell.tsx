import type { ReactNode } from "react";

import type { ShellData } from "@/features/shell/queries";

import { AppRail } from "./app-rail";
import { MobileTabBar } from "./mobile-tab-bar";

/**
 * 登录后页面的外壳：桌面端左侧导航栏 + 右侧内容；手机端内容 + 底部标签栏。
 * 内容区自己滚动，导航栏始终可见。
 */
export function AppShell({ data, children }: { data: ShellData; children: ReactNode }) {
  return (
    <div className="flex h-dvh w-full overflow-hidden bg-canvas" data-app-shell="">
      <div className="hidden shrink-0 md:block">
        <AppRail {...data} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto pb-[var(--tab-bar-height)] md:pb-0">
        {children}
      </div>
      <MobileTabBar directUnread={data.directUnread} />
    </div>
  );
}
