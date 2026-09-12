"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

import type { CatalogRecord } from "../../../scripts/course-catalog-parse.mts";
import type { AdminActionState } from "./admin-action-state";
import { adminErrorMessage, type DatabaseErrorLike } from "./admin-errors";

/*
 * 管理操作的 Server Action。
 *
 * 这里不重复做身份校验：每个动作都以当前成员自己的会话调用数据库函数，函数第一句
 * 就校验调用者身份。Server Action 是任何人都能直接 POST 的公开入口，靠页面不渲染
 * 表单挡不住，所以授权必须落在数据库里——没有身份的请求在那里被拒，这里只负责把
 * 结果翻成人话。
 */

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;
type RpcResponse = { data: unknown; error: DatabaseErrorLike };

type MaterializeResult = {
  materialized_term: string;
  created_count: number;
  existing_count: number;
  invalid_count: number;
};

export type ImportBatchResult =
  | { ok: true; written: number }
  | { ok: false; message: string };

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function rejected(message: string): AdminActionState {
  return { status: "error", message };
}

async function perform(
  call: (supabase: SupabaseClient) => PromiseLike<RpcResponse>,
  describe: (data: unknown) => string,
): Promise<AdminActionState> {
  let response: RpcResponse;
  try {
    const supabase = await createClient();
    response = await call(supabase);
  } catch {
    return rejected(adminErrorMessage(null));
  }
  if (response.error) return rejected(adminErrorMessage(response.error));

  revalidatePath("/admin");
  return { status: "success", message: describe(response.data) };
}

function describeMaterialized(prefix: string) {
  return (data: unknown) => {
    const row = Array.isArray(data)
      ? (data[0] as MaterializeResult | undefined)
      : undefined;
    if (!row) return `${prefix}完成。`;
    const skipped =
      row.invalid_count > 0
        ? `另有 ${row.invalid_count} 门因课号超过 20 字或课名超过 120 字没有生成（目录里保留原文）。`
        : "";
    return `${prefix}${row.materialized_term}：新建 ${row.created_count} 门课程，已存在 ${row.existing_count} 门。${skipped}`;
  };
}

// ---------------------------------------------------------------------------
// 团队（仅所有者）
// ---------------------------------------------------------------------------

export async function grantAdminAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const email = field(formData, "email");
  if (!email) return rejected("请填写对方的学校邮箱。");
  return perform(
    (supabase) => supabase.rpc("admin_grant_admin", { target_email: email }),
    () => "已任命为管理员。对方刷新页面后就能在大厅看到管理入口。",
  );
}

export async function revokeAdminAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const userId = field(formData, "userId");
  if (!userId) return rejected("缺少要撤销的成员。");
  return perform(
    (supabase) => supabase.rpc("admin_revoke_admin", { target_user: userId }),
    () => "已撤销管理员身份，立即生效。",
  );
}

// ---------------------------------------------------------------------------
// 学校与邮箱域名（仅所有者）
// ---------------------------------------------------------------------------

export async function saveSchoolAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  return perform(
    (supabase) =>
      supabase.rpc("admin_save_school", {
        target_school: field(formData, "schoolId"),
        new_name_zh: field(formData, "nameZh"),
        new_name_en: field(formData, "nameEn"),
      }),
    () => "学校已保存。新学校默认不开放：添加邮箱域名、设置学期后再开放。",
  );
}

export async function setSchoolEnabledAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const enable = field(formData, "enabled") === "true";
  return perform(
    (supabase) =>
      supabase.rpc("admin_set_school_enabled", {
        target_school: field(formData, "schoolId"),
        should_enable: enable,
      }),
    () =>
      enable
        ? "学校已开放，该校邮箱现在可以登录。"
        : "学校已关闭，该校邮箱不能再登录；已登录的成员退出后就进不来了。",
  );
}

export async function addDomainAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  return perform(
    (supabase) =>
      supabase.rpc("admin_add_school_domain", {
        target_school: field(formData, "schoolId"),
        new_domain: field(formData, "domain"),
      }),
    () => "域名已添加。",
  );
}

export async function removeDomainAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  return perform(
    (supabase) =>
      supabase.rpc("admin_remove_school_domain", {
        target_domain: field(formData, "domain"),
      }),
    () => "域名已删除。",
  );
}

// ---------------------------------------------------------------------------
// 学期与课程（管理员）
// ---------------------------------------------------------------------------

/**
 * 切换学期会把本校所有旧学期课程群归档，所以要求再输入一遍新学期名称——
 * 手滑点错按钮不应该造成这种规模的影响。
 */
export async function setCurrentTermAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const term = field(formData, "term");
  if (!term) return rejected("请填写新学期，例如 2027-spring。");
  if (field(formData, "confirmation").toLowerCase() !== term.toLowerCase()) {
    return rejected("确认框里要再输入一遍相同的新学期，防止误操作。");
  }
  return perform(
    (supabase) =>
      supabase.rpc("admin_set_current_term", {
        target_school: field(formData, "schoolId"),
        new_term: term,
      }),
    describeMaterialized("已切换到 "),
  );
}

/** 把目录物化成当前学期的课程。课表导入完成后由导入组件直接调用。 */
export async function materializeCatalogForSchool(
  schoolId: string,
): Promise<AdminActionState> {
  if (typeof schoolId !== "string" || !schoolId) return rejected("请选择学校。");
  return perform(
    (supabase) =>
      supabase.rpc("admin_materialize_catalog", { target_school: schoolId }),
    describeMaterialized("已生成 "),
  );
}

export async function materializeAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  return materializeCatalogForSchool(field(formData, "schoolId"));
}

const SAVE_COURSE_MESSAGES: Record<string, string> = {
  created: "已加入目录，并建好了当前学期的课程，学生现在就能搜到。",
  updated: "已更新目录和当前学期的课程。",
  catalog_only:
    "已加入目录，但没有建出当前学期的课程：学校还没设学期，或课号超过 20 字、课名超过 120 字。",
};

export async function saveCatalogCourseAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  return perform(
    (supabase) =>
      supabase.rpc("admin_save_catalog_course", {
        target_school: field(formData, "schoolId"),
        course_code: field(formData, "code"),
        course_title: field(formData, "title"),
      }),
    (outcome) =>
      (typeof outcome === "string" && SAVE_COURSE_MESSAGES[outcome]) ||
      "已保存。",
  );
}

/**
 * 写入一批课表。由浏览器端的导入组件分批调用，不刷新页面——整份导完再物化、再刷新。
 *
 * 参数来自客户端、不可信：这里只挡住明显不对的形状，逐项校验在数据库函数里。
 */
export async function importCatalogBatchAction(
  schoolId: string,
  entries: CatalogRecord[],
): Promise<ImportBatchResult> {
  if (
    typeof schoolId !== "string" ||
    !Array.isArray(entries) ||
    entries.length === 0 ||
    entries.length > 500
  ) {
    return { ok: false, message: "导入数据格式不对。" };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("admin_import_catalog_batch", {
      target_school: schoolId,
      entries,
    });
    if (error) return { ok: false, message: adminErrorMessage(error) };
    return { ok: true, written: data ?? 0 };
  } catch {
    return { ok: false, message: adminErrorMessage(null) };
  }
}
