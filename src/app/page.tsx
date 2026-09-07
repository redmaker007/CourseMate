import {
  requestEmailCodeAction,
  verifyEmailCodeAction,
} from "@/features/auth/actions";
import { RequestEmailCodeForm } from "@/features/auth/components/request-email-code-form";
import { getEnabledSchools, type EnabledSchool } from "@/features/auth/queries";

export const dynamic = "force-dynamic";

export default async function Home() {
  let schools: EnabledSchool[] = [];
  let schoolsUnavailable = false;

  try {
    schools = await getEnabledSchools();
  } catch {
    schoolsUnavailable = true;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-12">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-xl shadow-slate-200/60 sm:p-9">
        <div className="mb-8">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
            CourseMate
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">
            使用学校邮箱登录
          </h1>
          <p className="mt-3 leading-7 text-slate-600">
            选择学校并验证邮箱，快速进入属于你的校园社区。
          </p>
        </div>

        {schoolsUnavailable || schools.length === 0 ? (
          <p className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            学校列表暂时不可用，请稍后刷新重试。
          </p>
        ) : null}

        <RequestEmailCodeForm
          requestAction={requestEmailCodeAction}
          schools={schools}
          verifyAction={verifyEmailCodeAction}
        />
      </section>
    </main>
  );
}
