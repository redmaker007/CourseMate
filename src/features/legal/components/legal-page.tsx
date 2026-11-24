import Link from "next/link";
import type { ReactNode } from "react";

import { PUBLIC_CONTACT_EMAIL } from "../public-contact";

/** 公开页面（隐私政策、用户协议、帮助）的共用外壳；这些页面不读会话，未登录也能看。 */
export function LegalPage({
  title,
  updatedAt,
  intro,
  footer,
  children,
  lang = "zh",
}: {
  title: string;
  updatedAt?: string;
  intro?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  lang?: "zh" | "en";
}) {
  return (
    <main className="min-h-dvh bg-canvas px-4 py-10" lang={lang === "en" ? "en" : "zh-CN"}>
      <article className="mx-auto w-full max-w-2xl space-y-8 rounded-3xl bg-card p-6 shadow-xl shadow-black/5 sm:p-9">
        <header className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">CourseMate</p>
          <h1 className="text-2xl font-bold text-ink">{title}</h1>
          {updatedAt ? (
            <p className="text-sm text-muted">{lang === "en" ? `Last updated: ${updatedAt}` : `最后更新：${updatedAt}`}</p>
          ) : null}
          {intro ? <div className="text-sm leading-6 text-ink">{intro}</div> : null}
        </header>
        {children}
        <footer className="flex flex-wrap gap-x-4 gap-y-2 border-t border-line pt-4 text-sm">
          {footer ?? (
            <>
              <Link className="font-medium text-accent hover:opacity-80" href="/support">帮助与联系</Link>
              <Link className="font-medium text-accent hover:opacity-80" href="/terms">用户协议与社区规范</Link>
              <Link className="font-medium text-accent hover:opacity-80" href="/privacy">隐私政策</Link>
              <Link className="font-medium text-accent hover:opacity-80" href="/login">返回登录</Link>
            </>
          )}
        </footer>
      </article>
    </main>
  );
}

export function LegalSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-2">
      <h2 className="text-base font-semibold text-ink" id={id}>
        {title}
      </h2>
      <div className="space-y-2 text-sm leading-6 text-ink">{children}</div>
    </section>
  );
}

export function ContactEmail({ lang = "zh" }: { lang?: "zh" | "en" }) {
  if (!PUBLIC_CONTACT_EMAIL) {
    return <span>{lang === "en" ? "(our public contact email will be posted here soon)" : "（公开联系邮箱尚未公布，公布后会写在这里）"}</span>;
  }
  return (
    <a className="font-medium text-accent underline" href={`mailto:${PUBLIC_CONTACT_EMAIL}`}>
      {PUBLIC_CONTACT_EMAIL}
    </a>
  );
}
