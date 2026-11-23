import Link from "next/link";

import { ContactEmail, LegalPage, LegalSection } from "@/features/legal/components/legal-page";
import { PRIVACY_POLICY_UPDATED_AT } from "@/features/legal/public-contact";

// English translation of ../page.tsx. Keep both in sync; the Chinese version is the source of truth.
export const metadata = {
  title: "Privacy Policy",
  description: "What CourseMate collects, how it is used and kept, and how to permanently delete your account",
};

export default function PrivacyPageEn() {
  return (
    <LegalPage
      footer={
        <>
          <Link className="font-medium text-accent hover:opacity-80" href="/privacy">中文版</Link>
          <Link className="font-medium text-accent hover:opacity-80" href="/support">Help &amp; contact (Chinese)</Link>
          <Link className="font-medium text-accent hover:opacity-80" href="/login">Sign in</Link>
        </>
      }
      intro={
        <p>
          CourseMate is a course-based social app for current university students: after signing in with a school email
          you can join course group chats, add friends and send direct messages. It is a university student project run by
          an individual developer and published on the App Store under that individual developer account (&ldquo;we&rdquo;
          below means that developer). This policy covers the CourseMate website and iOS app and explains what we collect,
          how we use it, how long we keep it, and how you can permanently delete your account. If this translation differs
          from the Chinese version, the Chinese version applies.
        </p>
      }
      lang="en"
      title="Privacy Policy"
      updatedAt={PRIVACY_POLICY_UPDATED_AT}
    >
      <LegalSection id="collect" title="1. Data we collect">
        <ul className="list-disc space-y-1.5 pl-5">
          <li><strong>School email address</strong>: used to send sign-in codes and to confirm which school you attend. It is not shown to other students.</li>
          <li>
            <strong>Account and sign-in data</strong>: account ID, school, sign-up time, and the last time you confirmed your
            email with a code. If you set a password, the sign-in service stores only a hash of it; we never see the password.
          </li>
          <li><strong>Profile</strong>: display name (required); major and graduation year (optional).</li>
          <li><strong>Courses and friends</strong>: the courses you join; friend requests (including the note), friendships, the nicknames and hide settings you set for friends, and your block list.</li>
          <li><strong>Messages</strong>: what you send in course group chats and direct messages, when you sent it, your read position, and when you cleared a direct chat.</li>
          <li><strong>Reports</strong>: reports you submit (reason and details), and a snapshot of the reported content saved automatically at the time (for example the reported message text, friend request note, or public profile).</li>
          <li><strong>Push notifications</strong>: if you allow notifications, the iOS app registers the device push token, an installation ID and the sign-in session ID; web push stores the subscription endpoint and keys provided by your browser.</li>
          <li><strong>Abuse prevention and security records</strong>: counts of actions such as friend requests (for rate limiting); an audit log of administrator actions.</li>
          <li><strong>Cookies and technical data</strong>: the website uses cookies to keep you signed in and remember your theme. Our hosting providers record IP addresses, request times and similar technical data in their access logs.</li>
        </ul>
        <p>We do <strong>not</strong> collect location, contacts, photos or payment information, do not use advertising or third-party analytics tools, and do not sell your data.</p>
      </LegalSection>

      <LegalSection id="use" title="2. How we use it">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>To verify your school and keep the service limited to students of the same school.</li>
          <li>To provide course group chats, friends and direct messages, and to notify you of new messages.</li>
          <li>To keep the community safe: automatically blocking messages, friend request notes and profiles that contain disallowed words; handling reports, blocks and violating content; and preventing abuse such as request spamming. Blocked content is not stored.</li>
          <li>To troubleshoot problems and keep the service running securely.</li>
        </ul>
      </LegalSection>

      <LegalSection id="visibility" title="3. Who can see your information">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Display name, major and graduation year: visible to students at your school, classmates in shared courses, and friends on the relevant pages.</li>
          <li>Course group messages: visible to current members of that course chat. Direct messages: visible only to the two participants.</li>
          <li>Reports: the reported person cannot see who reported them. Only the platform administrators who handle reports can see report contents and evidence.</li>
          <li>Platform administrators may see an account&rsquo;s email address when performing administrative actions (such as granting admin rights).</li>
        </ul>
      </LegalSection>

      <LegalSection id="third-parties" title="4. Third-party services">
        <ul className="list-disc space-y-1.5 pl-5">
          <li><strong>Supabase</strong>: database and sign-in service that stores the data above; servers are in the United States.</li>
          <li><strong>Vercel</strong>: hosts the website and the app&rsquo;s backend API, and keeps access logs.</li>
          <li><strong>Brevo</strong>: sends sign-in code emails and therefore receives your school email address and the email content.</li>
          <li><strong>Apple Push Notification service (APNs)</strong>: delivers notifications to iOS devices. A notification contains only the sender&rsquo;s display name and &ldquo;sent you a message&rdquo;, never the message text.</li>
          <li><strong>Browser push services</strong>: if you turn on notifications on the website, your browser vendor&rsquo;s push service relays them.</li>
        </ul>
      </LegalSection>

      <LegalSection id="retention" title="5. How long we keep data">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Your account, profile, friendships and messages are kept while you use the service, until you permanently delete your account.</li>
          <li>If you leave a course, the messages you sent in that course chat remain visible to its other members.</li>
          <li>The content text in report evidence (for example the original reported message) is deleted one year after the report is resolved; only the report category and outcome are kept. When you delete your account, related reports are kept without your account ID or profile, so that nobody can erase reports against them by deleting their account; their content text is likewise deleted one year after resolution.</li>
          <li>Our hosting providers keep access logs and backups for a period set by their own policies and then delete them.</li>
        </ul>
      </LegalSection>

      <LegalSection id="deletion" title="6. Permanently deleting your account">
        <p>You can permanently delete your account in the CourseMate iOS app, or on the website under 我的 (Me) → 设置 (Settings) → 注销账号 (Delete account). To prevent mistakes, you must enter a code sent to your school email. After deletion:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Your sign-in account, profile, course memberships, friendships, nicknames, block list and push registrations are deleted, and you are signed out on all devices.</li>
          <li>The text of messages you sent is replaced with &ldquo;[消息已删除]&rdquo; (message deleted) and no longer linked to you; other people&rsquo;s messages are not affected.</li>
          <li>Friend requests involving you are deleted.</li>
          <li>Reports are kept anonymously as described above.</li>
        </ul>
        <p>Deletion cannot be undone. Signing in again with the same email creates a brand-new account.</p>
      </LegalSection>

      <LegalSection id="safety" title="7. Reporting, blocking and enforcement">
        <p>
          You can report direct messages, course group messages, friend requests and profiles, and you can block other users.
          Reports are not shown to the reported person and do not automatically penalize anyone. Platform administrators usually
          review reports within 24–48 hours and may remove violating content or suspend violating accounts.
        </p>
      </LegalSection>

      <LegalSection id="security" title="8. Security">
        <p>Data is transmitted over HTTPS, and the database enforces row-level permissions so each user can read only what they are allowed to see. No system can be guaranteed to be completely secure.</p>
      </LegalSection>

      <LegalSection id="minors" title="9. Children">
        <p>CourseMate is intended for university students. It is not directed to children under 13, and we do not knowingly collect their information.</p>
      </LegalSection>

      <LegalSection id="changes" title="10. Changes">
        <p>When this policy changes materially, we will update the date at the top of this page and, where appropriate, notify you in the service.</p>
      </LegalSection>

      <LegalSection id="contact" title="11. Contact us">
        <p>For privacy questions, data requests, report follow-ups or account issues, email <ContactEmail lang="en" />.</p>
      </LegalSection>
    </LegalPage>
  );
}
