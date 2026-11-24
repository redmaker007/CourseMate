import Link from "next/link";

import { ContactEmail, LegalPage, LegalSection } from "@/features/legal/components/legal-page";
import { PRIVACY_POLICY_UPDATED_AT } from "@/features/legal/public-contact";

// 公开页面：src/proxy.ts 的 matcher 已排除 /terms。违规处理能力以代码为准：
// 过滤见 docs/runbooks/content-filter.md，举报处理见 docs/runbooks/report-handling.md。
export const metadata = {
  title: "用户协议与社区规范",
  description: "使用 CourseMate 需要遵守的规则，以及违规内容如何处理",
};

export default function TermsPage() {
  return (
    <LegalPage
      intro={
        <p>
          CourseMate 是由个人开发者运营的大学学生项目。使用 CourseMate 网站或 iOS App，即表示你同意本协议和
          <Link className="font-medium text-accent hover:opacity-80" href="/privacy">《隐私政策》</Link>。
        </p>
      }
      title="用户协议与社区规范"
      updatedAt={PRIVACY_POLICY_UPDATED_AT}
    >
      <LegalSection id="eligibility" title="一、谁可以使用">
        <p>只有持有受支持学校邮箱的在校学生可以使用。你需要年满 13 岁。请保管好自己的邮箱和密码，不要把账号借给别人。</p>
      </LegalSection>

      <LegalSection id="rules" title="二、社区规范">
        <p>CourseMate 对以下内容和行为<strong>零容忍</strong>：</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>骚扰、辱骂、霸凌或针对他人的人身攻击；</li>
          <li>基于种族、民族、宗教、性别、性取向、残障等的仇恨或歧视言论；</li>
          <li>威胁、煽动暴力，或鼓励自残、自杀；</li>
          <li>色情、性骚扰内容，以及任何涉及未成年人的性内容；</li>
          <li>垃圾信息、广告、诈骗或钓鱼链接；</li>
          <li>冒充他人，或未经同意公开他人的私人信息；</li>
          <li>违法内容，或协助作弊等违反学术诚信的行为。</li>
        </ul>
      </LegalSection>

      <LegalSection id="enforcement" title="三、我们如何处理违规">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>包含不允许词语的消息、好友申请附言和资料会在发送时被自动拦截。</li>
          <li>你可以举报消息、好友申请和资料，也可以拉黑任何用户。</li>
          <li>平台管理员通常会在 24–48 小时内查看举报，并视情况删除违规内容、停用违规账号。严重违规可能不经警告直接停用。</li>
          <li>举报不会告诉被举报的人是谁举报的。</li>
        </ul>
      </LegalSection>

      <LegalSection id="content" title="四、你发布的内容">
        <p>你对自己发布的内容负责。你发布的内容仍归你所有；你允许 CourseMate 为提供服务而存储、显示和传输这些内容（例如显示给课程群成员或私聊对象）。</p>
      </LegalSection>

      <LegalSection id="account" title="五、注销与停用">
        <p>你可以随时在 App 或网站“我的 → 设置”里永久注销账号。我们可以停用违反本协议的账号。</p>
      </LegalSection>

      <LegalSection id="disclaimer" title="六、免责声明">
        <p>CourseMate 是学生项目，按现状提供，可能出现中断或错误。我们不对用户之间的线下交往负责。</p>
      </LegalSection>

      <LegalSection id="changes" title="七、协议更新">
        <p>本协议有实质变化时，我们会更新本页顶部的日期，并在必要时在服务内提示。</p>
      </LegalSection>

      <LegalSection id="contact" title="八、联系我们">
        <p>对本协议有疑问，或需要申诉，请发邮件至 <ContactEmail />。</p>
      </LegalSection>
    </LegalPage>
  );
}
