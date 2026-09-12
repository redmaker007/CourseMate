import Link from "next/link";

import type { CurrentMember } from "@/features/auth/session";
import { setTestSchoolAction } from "../school-test-actions";
import { AdminForm } from "./admin-form";

export function SchoolTestBanner({ member }: { member: CurrentMember }) {
  if (!member.homeSchoolId || member.homeSchoolId === member.schoolId) return null;
  return (
    <aside aria-label="跨校测试状态" className="mx-auto my-3 w-full max-w-5xl rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-950">
      <p className="font-semibold">正在测试：{member.schoolId} · 账号归属：{member.homeSchoolId}</p>
      <p className="my-2 text-xs leading-5">
        课程、好友和私聊使用当前测试学校；写入和消息会保留。切换对这个账号的所有设备生效。
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <AdminForm action={setTestSchoolAction} submitLabel="返回本校" pendingLabel="返回中…" tone="quiet" layout="inline">
          <input name="schoolId" type="hidden" value="" />
        </AdminForm>
        <Link className="font-medium underline" href="/admin">选择其他学校</Link>
      </div>
    </aside>
  );
}
