import {
  addDomainAction,
  removeDomainAction,
  setCurrentTermAction,
  setSchoolEnabledAction,
} from "../actions";
import type { AdminSchool } from "../queries";
import { AdminForm, TextField } from "./admin-form";

type SchoolCardProps = {
  school: AdminSchool;
  /** 学校与域名只有所有者能改。只影响显示哪些表单，真正的限制在数据库。 */
  owner: boolean;
};

export function SchoolCard({ school, owner }: SchoolCardProps) {
  return (
    <li className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-slate-950">
            {school.nameZh}
            <span className="ml-2 text-sm font-normal text-slate-500">
              {school.nameEn}
            </span>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            ID：{school.id} · 成员 {school.memberCount} 人 · 目录{" "}
            {school.catalogCount} 门 · 当前学期课程 {school.currentCourseCount} 门
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            school.enabled
              ? "bg-emerald-50 text-emerald-700"
              : "bg-slate-100 text-slate-600"
          }`}
        >
          {school.enabled ? "开放中" : "未开放"}
        </span>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-slate-800">
            当前学期：{school.currentTerm ?? "未设置"}
          </h4>
          <p className="text-xs leading-5 text-slate-500">
            切换后，本校旧学期的课程群会归档成只读，并按目录建出新学期的课程。
            切回原学期可以恢复归档。
          </p>
          <AdminForm
            action={setCurrentTermAction}
            pendingLabel="正在切换…"
            submitLabel="切换学期"
            tone="danger"
          >
            <input name="schoolId" type="hidden" value={school.id} />
            <TextField
              label="新学期"
              name="term"
              placeholder="2027-spring"
              required
            />
            <TextField
              label="再输入一遍确认"
              name="confirmation"
              placeholder="2027-spring"
              required
            />
          </AdminForm>
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-medium text-slate-800">邮箱域名</h4>
          {school.domains.length ? (
            <ul className="space-y-1.5">
              {school.domains.map((domain) => (
                <li
                  className="flex items-center justify-between gap-2 text-sm text-slate-700"
                  key={domain}
                >
                  <span>@{domain}</span>
                  {owner ? (
                    <AdminForm
                      action={removeDomainAction}
                      layout="inline"
                      submitLabel="删除"
                      tone="quiet"
                    >
                      <input name="domain" type="hidden" value={domain} />
                    </AdminForm>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">还没有域名。</p>
          )}

          {owner ? (
            <div className="space-y-3 pt-1">
              <AdminForm
                action={addDomainAction}
                layout="inline"
                submitLabel="添加域名"
              >
                <input name="schoolId" type="hidden" value={school.id} />
                <TextField
                  label="新域名（只填 @ 后面的部分）"
                  name="domain"
                  placeholder="wisc.edu"
                  required
                />
              </AdminForm>
              <AdminForm
                action={setSchoolEnabledAction}
                submitLabel={school.enabled ? "关闭学校" : "开放学校"}
                tone={school.enabled ? "danger" : "primary"}
              >
                <input name="schoolId" type="hidden" value={school.id} />
                <input
                  name="enabled"
                  type="hidden"
                  value={school.enabled ? "false" : "true"}
                />
              </AdminForm>
              {school.enabled ? (
                <p className="text-xs leading-5 text-slate-500">
                  关闭后该校邮箱不能再登录；已登录的成员不会被踢出，但退出后就进不来了。
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-slate-500">学校与域名只有所有者能修改。</p>
          )}
        </div>
      </div>
    </li>
  );
}
