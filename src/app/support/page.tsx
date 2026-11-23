import Link from "next/link";

import { ContactEmail, LegalPage, LegalSection } from "@/features/legal/components/legal-page";

// 公开页面，也是 App Store 的 Support URL。src/proxy.ts 的 matcher 已排除 /support。
export const metadata = {
  title: "帮助与联系",
  description: "CourseMate 常见问题、举报与拉黑、注销账号和联系方式",
};

export default function SupportPage() {
  return (
    <LegalPage
      intro={<p>使用 CourseMate 遇到问题，先看下面的说明；解决不了可以发邮件联系我们。</p>}
      title="帮助与联系"
    >
      <LegalSection id="contact" title="联系我们">
        <p>邮箱：<ContactEmail /></p>
        <p>账号问题、举报跟进、误拦截申诉和隐私请求都可以发到这个邮箱。我们通常在 24–48 小时内回复。</p>
      </LegalSection>

      <LegalSection id="sign-in" title="登录">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>第一次使用请选“验证码登录”，用学校邮箱接收 6 位验证码。收不到时先检查垃圾邮件。</li>
          <li>登录后可以在“我的 → 设置”里设置密码，之后可以用密码登录。</li>
          <li>为了确认你仍是在校学生，每 30 天需要用验证码登录一次。</li>
        </ul>
      </LegalSection>

      <LegalSection id="safety" title="举报与拉黑">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>在消息、好友申请或用户资料旁点“举报”，选择原因提交。举报不会通知对方。</li>
          <li>拉黑后，对方不能再给你发私聊或好友申请。</li>
          <li>平台管理员通常在 24–48 小时内查看举报，并删除违规内容或停用违规账号。</li>
          <li>如果你正常的内容被误拦截，请发邮件告诉我们。</li>
        </ul>
      </LegalSection>

      <LegalSection id="deletion" title="注销账号">
        <p>
          在 iOS App 内或网站“我的 → 设置 → 注销账号”可以永久注销。注销后会删除什么、保留什么，见
          <Link className="font-medium text-accent hover:opacity-80" href="/privacy#deletion">隐私政策第六节</Link>。
        </p>
      </LegalSection>
    </LegalPage>
  );
}
