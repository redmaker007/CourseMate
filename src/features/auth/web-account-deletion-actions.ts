"use server";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { env } from "@/lib/env";
import { serverEnv } from "@/lib/server-env";
import { createIsolatedClient } from "@/lib/supabase/isolated";
import { createClient } from "@/lib/supabase/server";

import type { DeletionDependencies } from "./account-deletion-api";
import { confirmWebDeletion, requestWebDeletionCode } from "./web-account-deletion";
import type { WebDeletionState } from "./web-account-deletion-state";

function dependencies(): DeletionDependencies {
  return {
    createClient: createIsolatedClient,
    getDeletionSecret: () => serverEnv.emailOtpContextSecret,
    createDeletionAdmin: () => createSupabaseClient(env.supabaseUrl, serverEnv.accountDeletionServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }),
  };
}

async function currentAccessToken() {
  try {
    const { data } = await (await createClient()).auth.getSession();
    return data.session?.access_token;
  } catch {
    return undefined;
  }
}

export async function accountDeletionAction(previous: WebDeletionState, formData: FormData): Promise<WebDeletionState> {
  const intent = formData.get("intent");
  const accessToken = await currentAccessToken();
  if (intent === "request") {
    const state = await requestWebDeletionCode(accessToken, dependencies());
    console.info(JSON.stringify({ operation: "web_account_deletion_challenge", outcome: state.status }));
    return state;
  }
  if (intent !== "confirm") return previous;

  const state = await confirmWebDeletion(accessToken, {
    challengeToken: String(formData.get("challengeToken") ?? ""),
    receiptToken: String(formData.get("receiptToken") ?? ""),
    code: String(formData.get("code") ?? ""),
    confirmed: formData.get("confirmed") === "on",
  }, dependencies());
  console.info(JSON.stringify({ operation: "web_account_deletion", outcome: state.status }));
  if (state.status !== "completed") return state;

  // 账号已随 Auth 记录删除；浏览器里残留的会话 Cookie 不能再用，直接清掉再回登录页。
  const store = await cookies();
  for (const cookie of store.getAll()) {
    if (cookie.name.startsWith("sb-")) store.delete(cookie.name);
  }
  redirect("/login?deleted=1");
}
