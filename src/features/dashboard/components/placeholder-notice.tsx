export function PlaceholderNotice() {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
      <p className="text-sm font-semibold text-amber-900">
        这是占位界面，课程与群聊尚未接入数据库
      </p>
      <p className="mt-1.5 text-sm leading-6 text-amber-800">
        登录、学校准入和成员绑定是真实的，下面看到的课程都是写死的假数据。
        课程与群聊相关的表还没进数据库。
      </p>
    </div>
  );
}
