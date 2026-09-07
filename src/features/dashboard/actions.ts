"use server";

import { redirect } from "next/navigation";

import { signOutCurrentDeviceAction } from "@/features/auth/actions";

/**
 * 退出登录并回到登录页。
 *
 * 认证模块只负责撤销会话、返回结果，不决定跳去哪个页面——落点是页面层的
 * 职责，所以这层包装放在 dashboard 而不是 auth 里。
 *
 * redirect() 靠抛异常实现，必须写在 try/catch 之外。
 */
export async function signOutAndReturnToLoginAction() {
  const result = await signOutCurrentDeviceAction();

  // 退出失败时不要跳登录页：会话还在，登录页会把人再送回来，形成来回跳。
  if (result.status !== "signed_out") {
    redirect("/dashboard?signout=failed");
  }

  redirect("/login");
}
