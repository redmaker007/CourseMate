import { redirect } from "next/navigation";

import { getCurrentMember } from "@/features/auth/session";

export const dynamic = "force-dynamic";

/**
 * 首页只做分流：已登录进大厅，未登录进登录页。
 *
 * 这里不能渲染登录表单——proxy 把未登录用户往 /login 送，两处各有一份表单
 * 会导致同一个界面出现在两个地址上。
 */
export default async function RootPage() {
  if (await getCurrentMember()) redirect("/dashboard");
  redirect("/login");
}
