import Link from "next/link";
import type { ReactNode } from "react";

import {
  PRIVACY_POLICY_UPDATED_AT,
  PUBLIC_CONTACT_EMAIL,
} from "@/features/legal/public-contact";

// 公开页面：src/proxy.ts 的 matcher 已排除 /privacy，未登录也能访问，不读取会话。
// 内容以代码和迁移为准（见 docs/policies/privacy-policy-sources.md），改功能时同步核对。
export const metadata = {
  title: "隐私政策",
  description: "CourseMate 收集哪些数据、如何使用与保留、如何永久注销账号",
};

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-2">
      <h2 className="text-base font-semibold text-ink" id={id}>
        {title}
      </h2>
      <div className="space-y-2 text-sm leading-6 text-ink">{children}</div>
    </section>
  );
}

function ContactLine() {
  if (PUBLIC_CONTACT_EMAIL) {
    return (
      <p>
        隐私问题、数据请求、举报跟进或账号问题，请发邮件至{" "}
        <a className="font-medium text-accent underline" href={`mailto:${PUBLIC_CONTACT_EMAIL}`}>
          {PUBLIC_CONTACT_EMAIL}
        </a>
        。
      </p>
    );
  }
  return <p>公开联系邮箱尚未公布，公布后会写在这里。</p>;
}

export default function PrivacyPage() {
  return (
    <main className="min-h-dvh bg-canvas px-4 py-10">
      <article className="mx-auto w-full max-w-2xl space-y-8 rounded-3xl bg-card p-6 shadow-xl shadow-black/5 sm:p-9">
        <header className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">CourseMate</p>
          <h1 className="text-2xl font-bold text-ink">隐私政策</h1>
          <p className="text-sm text-muted">最后更新：{PRIVACY_POLICY_UPDATED_AT}</p>
          <p className="text-sm leading-6 text-ink">
            CourseMate 是只对在校学生开放的课程社交服务：用学校邮箱登录后，可以加入课程群聊、添加好友和私聊。
            本政策适用于 CourseMate 网站和 iOS App，说明我们收集什么、怎么用、保留多久，以及你如何永久注销账号。
          </p>
        </header>

        <Section id="collect" title="一、我们收集的数据">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong>学校邮箱</strong>：用于发送登录验证码、确认你属于哪所学校。邮箱不会展示给其他同学。
            </li>
            <li>
              <strong>账号与登录信息</strong>：账号编号、所属学校、注册时间、最近一次用验证码确认邮箱的时间。
              如果你设置了密码，登录服务只保存密码的加密哈希，我们看不到密码原文。
            </li>
            <li>
              <strong>个人资料</strong>：显示名（必填），专业、毕业年份（选填）。
            </li>
            <li>
              <strong>课程与好友关系</strong>：你加入的课程；好友申请（含附言）、好友关系、你给好友的备注与隐藏设置、拉黑名单。
            </li>
            <li>
              <strong>消息</strong>：你在课程群聊和私聊里发送的内容、发送时间，以及已读位置和你清空私聊的记录。
            </li>
            <li>
              <strong>举报记录</strong>：你提交的举报（原因、补充说明），以及系统在举报当时自动保存的被举报内容快照
              （例如被举报的消息正文、好友申请附言或公开资料）。
            </li>
            <li>
              <strong>推送通知</strong>：如果你允许通知，iOS App 会登记设备的推送令牌、安装编号和登录会话编号；
              网页推送会保存浏览器提供的推送订阅地址和密钥。
            </li>
            <li>
              <strong>防滥用与安全记录</strong>：好友申请等操作的次数统计（用于限流）；管理员操作的审计记录。
            </li>
            <li>
              <strong>Cookie 与技术信息</strong>：网站用 Cookie 保存登录状态和主题偏好。托管服务商会在访问日志中记录
              IP 地址、请求时间等技术信息。
            </li>
          </ul>
          <p>
            我们<strong>不</strong>收集位置、通讯录、照片或支付信息，不使用广告或第三方统计分析工具，也不出售你的数据。
          </p>
        </Section>

        <Section id="use" title="二、我们如何使用这些数据">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>验证你的学校身份，只让同校学生使用服务。</li>
            <li>提供课程群聊、好友和私聊功能，并向你推送新消息通知。</li>
            <li>处理举报、拉黑和违规内容，维护社区安全；防止刷申请等滥用行为。</li>
            <li>排查故障、保障服务安全运行。</li>
          </ul>
        </Section>

        <Section id="visibility" title="三、谁能看到你的信息">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>显示名、专业和毕业年份：同校同学、同课程同学和好友在相关页面可以看到。</li>
            <li>课程群消息：该课程群的当前成员可以看到；私聊消息只有双方可以看到。</li>
            <li>举报：被举报的人看不到是谁举报了他；只有负责处理举报的项目成员能查看举报内容和证据。</li>
            <li>平台管理员在执行管理操作（如授予管理员权限）时可能接触到相关账号的邮箱。</li>
          </ul>
        </Section>

        <Section id="third-parties" title="四、我们使用的第三方服务">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong>Supabase</strong>：数据库与登录服务，存储上述账号、资料、消息等数据；服务器位于美国。
            </li>
            <li>
              <strong>Vercel</strong>：网站与 App 后端接口的托管服务，会产生访问日志。
            </li>
            <li>
              <strong>Brevo</strong>：发送登录验证码邮件，会收到你的学校邮箱地址和邮件内容。
            </li>
            <li>
              <strong>Apple 推送通知服务（APNs）</strong>：向 iOS 设备投递通知。通知内容只有发送者的显示名和
              “发来一条消息”，不包含消息正文。
            </li>
            <li>
              <strong>浏览器推送服务</strong>：如果你在网页上开启通知，你的浏览器厂商提供的推送服务会转发通知。
            </li>
          </ul>
        </Section>

        <Section id="retention" title="五、数据保留多久">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>账号、资料、好友关系和消息在你使用期间一直保留，直到你永久注销账号。</li>
            <li>你退出课程后，你在该课程群里发过的消息仍会留给其他成员看。</li>
            <li>
              举报记录和证据快照在注销后仍会保留，但会去掉指向你的账号编号和资料，只保留举报原因、说明和被举报内容，
              以免有人通过注销抹掉别人对他的举报。
            </li>
            <li>托管服务商的访问日志和备份按其自身策略保留一段时间后删除。</li>
          </ul>
        </Section>

        <Section id="deletion" title="六、永久注销账号">
          <p>
            你可以在 CourseMate iOS App 内永久注销账号。为防止误操作，注销前需要输入发送到你学校邮箱的验证码。注销后：
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>你的登录账号、资料、课程成员关系、好友关系、备注、拉黑记录和推送登记会被删除，所有设备上的登录都会失效。</li>
            <li>你发过的消息正文会被替换为“[消息已删除]”，不再关联到你；其他人发的消息不受影响。</li>
            <li>涉及你的好友申请会被删除。</li>
            <li>举报记录按上一节的方式匿名保留。</li>
          </ul>
          <p>注销无法撤销。之后用同一邮箱登录会成为一个全新的账号。</p>
        </Section>

        <Section id="safety" title="七、举报与拉黑">
          <p>
            你可以举报私聊消息、课程群消息、好友申请和用户资料，也可以拉黑其他用户。举报不会通知被举报的人，也不会自动处罚对方。
          </p>
        </Section>

        <Section id="security" title="八、数据安全">
          <p>
            数据通过 HTTPS 传输；数据库启用行级权限控制，每个用户只能读取自己有权查看的内容。不过任何系统都无法保证绝对安全。
          </p>
        </Section>

        <Section id="minors" title="九、未成年人">
          <p>CourseMate 面向大学在校学生，不面向 13 岁以下儿童，也不会有意收集他们的信息。</p>
        </Section>

        <Section id="changes" title="十、政策更新">
          <p>本政策有实质变化时，我们会更新本页顶部的日期，并在必要时在服务内提示。</p>
        </Section>

        <Section id="contact" title="十一、联系我们">
          <ContactLine />
        </Section>

        <footer className="border-t border-line pt-4 text-sm">
          <Link className="font-medium text-accent hover:opacity-80" href="/login">
            返回登录
          </Link>
        </footer>
      </article>
    </main>
  );
}
