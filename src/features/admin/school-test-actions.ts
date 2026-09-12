"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import type { AdminActionState } from "./admin-action-state";
import { adminErrorMessage } from "./admin-errors";

/** 权限与目标学校校验在 RPC 中完成；不能信任页面传来的角色或学校。 */
export async function setTestSchoolAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const selected = formData.get("schoolId");
  if (typeof selected !== "string" || selected.trim().length > 40) {
    return { status: "error", message: "请选择学校。" };
  }
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("admin_set_test_school", {
      target_school: selected.trim(),
    });
    if (error) return { status: "error", message: adminErrorMessage(error) };
  } catch {
    return { status: "error", message: adminErrorMessage(null) };
  }
  revalidatePath("/", "layout");
  redirect("/dashboard");
}
