import { SchoolTestBanner } from "@/features/admin/components/school-test-banner";
import Link from "next/link";
import { setTestSchoolAction } from "@/features/admin/school-test-actions";

import {
  importCatalogBatchAction,
  materializeAction,
  materializeCatalogForSchool,
  saveCatalogCourseAction,
  saveSchoolAction,
} from "@/features/admin/actions";
import {
  AdminForm,
  SchoolSelect,
  TextField,
} from "@/features/admin/components/admin-form";
import { AuditLog } from "@/features/admin/components/audit-log";
import { CatalogImport } from "@/features/admin/components/catalog-import";
import { SchoolCard } from "@/features/admin/components/school-card";
import { StaffList } from "@/features/admin/components/staff-list";
import { isOwner, PLATFORM_ROLE_LABELS } from "@/features/admin/platform-role";
import {
  getAdminOverview,
  requireStaff,
  type AdminOverview,
} from "@/features/admin/queries";
import { Section } from "@/features/dashboard/components/section";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  // 页面层门禁：没有身份的人看到 404。真正的授权在数据库函数里，每次调用都重新校验。
  const { member, role } = await requireStaff();
  const owner = isOwner(role);

  let overview: AdminOverview | null = null;
  try {
    overview = await getAdminOverview();
  } catch {
    overview = null;
  }

  const schoolOptions = (overview?.schools ?? []).map((school) => ({
    id: school.id,
    label: `${school.nameZh}（${school.id}）`,
  }));

  return (
    <div className="min-h-screen bg-slate-50">
      <SchoolTestBanner member={member} />
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
              CourseMate 管理
            </p>
            <p className="mt-1 truncate text-sm text-slate-600">
              <span className="font-medium text-slate-900">
                {PLATFORM_ROLE_LABELS[role]}
              </span>
              <span aria-hidden="true" className="mx-2 text-slate-300">
                ·
              </span>
              {member.email}
            </p>
          </div>
          <Link
            className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
            href="/dashboard"
          >
            返回大厅
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 px-5 py-8">
        {overview ? (
          <>
            <Section
              badge="测试"
              title="切换测试学校"
              description="使用自己的账号测试课程、好友和私聊。操作会写入当前环境，已有选课和聊天记录会保留。"
            >
              <p className="mb-3 text-sm text-slate-600">
                当前学校：{member.schoolId} · 邮箱归属：{member.homeSchoolId ?? member.schoolId}
              </p>
              <AdminForm action={setTestSchoolAction} submitLabel="进入测试学校" pendingLabel="切换中…">
                <SchoolSelect schools={schoolOptions.filter((option) =>
                  overview.schools.some((school) => school.id === option.id && school.enabled)
                )} />
              </AdminForm>
            </Section>
            <Section
              badge="学校"
              description="当前学期决定学生能加入哪些课；邮箱域名决定谁能登录。"
              title="学校与学期"
            >
              <ul className="space-y-3">
                {overview.schools.map((school) => (
                  <SchoolCard key={school.id} owner={owner} school={school} />
                ))}
              </ul>

              {owner ? (
                <div className="mt-5 space-y-2 rounded-2xl border border-dashed border-slate-300 p-4">
                  <h3 className="text-sm font-medium text-slate-800">
                    新增学校，或修改已有学校的名称
                  </h3>
                  <AdminForm action={saveSchoolAction} submitLabel="保存学校">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <TextField
                        label="学校 ID"
                        maxLength={40}
                        name="schoolId"
                        placeholder="uw-madison"
                        required
                      />
                      <TextField
                        label="中文名"
                        maxLength={80}
                        name="nameZh"
                        placeholder="威斯康星大学麦迪逊分校"
                        required
                      />
                      <TextField
                        label="英文名"
                        maxLength={120}
                        name="nameEn"
                        placeholder="University of Wisconsin–Madison"
                        required
                      />
                    </div>
                  </AdminForm>
                </div>
              ) : null}
            </Section>

            <Section
              badge="课程"
              description="上传学校官方公开的课表。写入目录后，会自动建成当前学期学生可以加入的课程。"
              title="课程录入"
            >
              {schoolOptions.length ? (
                <div className="space-y-6">
                  <CatalogImport
                    importBatch={importCatalogBatchAction}
                    materialize={materializeCatalogForSchool}
                    schools={schoolOptions}
                  />

                  <div className="space-y-2 border-t border-slate-100 pt-5">
                    <h3 className="text-sm font-medium text-slate-800">
                      新增或修改单门课
                    </h3>
                    <p className="text-xs leading-5 text-slate-500">
                      课号相同就是修改：会同时更新目录和当前学期的课程名称。
                    </p>
                    <AdminForm
                      action={saveCatalogCourseAction}
                      submitLabel="保存这门课"
                    >
                      <div className="grid gap-3 sm:grid-cols-3">
                        <SchoolSelect schools={schoolOptions} />
                        <TextField
                          label="课号"
                          maxLength={40}
                          name="code"
                          placeholder="EECS 280"
                          required
                        />
                        <TextField
                          label="课名"
                          maxLength={200}
                          name="title"
                          placeholder="Programming and Data Structures"
                          required
                        />
                      </div>
                    </AdminForm>
                  </div>

                  <div className="space-y-2 border-t border-slate-100 pt-5">
                    <h3 className="text-sm font-medium text-slate-800">
                      重新生成当前学期课程
                    </h3>
                    <p className="text-xs leading-5 text-slate-500">
                      按目录补建当前学期缺少的课程，已有的课不受影响。一般不需要手动点，
                      导入课表和切换学期时都会自动执行。
                    </p>
                    <AdminForm
                      action={materializeAction}
                      layout="inline"
                      submitLabel="重新生成"
                    >
                      <SchoolSelect schools={schoolOptions} />
                    </AdminForm>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-600">还没有任何学校。</p>
              )}
            </Section>

            <Section
              badge="团队"
              description="能进入这个管理页的人。"
              title="管理员"
            >
              <StaffList owner={owner} staff={overview.staff} />
            </Section>

            <Section
              badge="记录"
              description="最近 50 条管理操作，时间为 UTC。"
              title="操作记录"
            >
              <AuditLog entries={overview.audit} />
            </Section>
          </>
        ) : (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
            管理数据暂时不可用，请稍后刷新。
          </div>
        )}
      </main>
    </div>
  );
}
