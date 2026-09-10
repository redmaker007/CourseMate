import { grantAdminAction, revokeAdminAction } from "../actions";
import { PLATFORM_ROLE_LABELS } from "../platform-role";
import type { StaffMember } from "../queries";
import { AdminForm, TextField } from "./admin-form";

type StaffListProps = {
  staff: StaffMember[];
  /** 任命与撤销只有所有者能做。只影响显示哪些表单，真正的限制在数据库。 */
  owner: boolean;
};

export function StaffList({ staff, owner }: StaffListProps) {
  return (
    <div className="space-y-4">
      <ul className="space-y-2">
        {staff.map((person) => (
          <li
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3"
            key={person.userId}
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900">
                {person.displayName ?? "未填写名称"}
                <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                  {PLATFORM_ROLE_LABELS[person.role]}
                </span>
              </p>
              <p className="mt-0.5 truncate text-xs text-slate-500">
                {person.email}
              </p>
            </div>
            {owner && person.role === "admin" ? (
              <AdminForm
                action={revokeAdminAction}
                layout="inline"
                submitLabel="撤销管理员"
                tone="quiet"
              >
                <input name="userId" type="hidden" value={person.userId} />
              </AdminForm>
            ) : null}
          </li>
        ))}
      </ul>

      {owner ? (
        <div className="space-y-2">
          <AdminForm
            action={grantAdminAction}
            layout="inline"
            submitLabel="任命为管理员"
          >
            <TextField
              label="对方的学校邮箱"
              name="email"
              placeholder="name@wisc.edu"
              required
              type="email"
            />
          </AdminForm>
          <p className="text-xs leading-5 text-slate-500">
            对方需要先用学校邮箱登录一次。管理员能录课、切换学期、查看操作记录；
            不能改学校和域名，也不能任命别人。
          </p>
        </div>
      ) : (
        <p className="text-xs text-slate-500">任命与撤销管理员只有所有者能操作。</p>
      )}
    </div>
  );
}
