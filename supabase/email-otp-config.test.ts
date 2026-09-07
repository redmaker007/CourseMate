import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const projectFile = (relativePath: string) =>
  path.join(process.cwd(), ...relativePath.split("/"));

describe("Supabase email OTP configuration", () => {
  it("uses a six-digit OTP valid for ten minutes with a 60-second resend interval", async () => {
    const config = await readFile(projectFile("supabase/config.toml"), "utf8");

    expect(config).toMatch(/\[auth\.email\][\s\S]*otp_length\s*=\s*6/);
    expect(config).toMatch(/\[auth\.email\][\s\S]*otp_expiry\s*=\s*600/);
    expect(config).toMatch(
      /\[auth\.email\][\s\S]*max_frequency\s*=\s*"60s"/,
    );
    expect(config).toMatch(
      /\[auth\.email\][\s\S]*enable_confirmations\s*=\s*true/,
    );
  });

  it("keeps SMTP identity and credentials in environment variables", async () => {
    const config = await readFile(projectFile("supabase/config.toml"), "utf8");

    expect(config).toContain('host = "env(SUPABASE_AUTH_SMTP_HOST)"');
    expect(config).toContain('user = "env(SUPABASE_AUTH_SMTP_USER)"');
    expect(config).toContain('pass = "env(SUPABASE_AUTH_SMTP_PASS)"');
    expect(config).toContain(
      'admin_email = "env(SUPABASE_AUTH_SMTP_ADMIN_EMAIL)"',
    );
    expect(config).toContain(
      'sender_name = "env(SUPABASE_AUTH_SMTP_SENDER_NAME)"',
    );
  });

  it("uses a short bilingual code-only email without a magic link", async () => {
    const config = await readFile(projectFile("supabase/config.toml"), "utf8");
    const template = await readFile(
      projectFile("supabase/templates/email-otp.html"),
      "utf8",
    );

    for (const templateKind of ["confirmation", "magic_link"]) {
      expect(config).toMatch(
        new RegExp(
          `\\[auth\\.email\\.template\\.${templateKind}\\]` +
            `[\\s\\S]*?subject = "CourseMate 登录验证码 / Sign-in code"` +
            `[\\s\\S]*?content_path = "\\./supabase/templates/email-otp\\.html"`,
        ),
      );
    }
    expect(template).toContain("{{ .Token }}");
    expect(template).toContain("6 位");
    expect(template).toContain("6-digit");
    expect(template).toContain("10 分钟");
    expect(template).toContain("10 minutes");
    expect(template).toContain("如非本人操作");
    expect(template).toContain("If you did not request this");
    expect(template).not.toContain("{{ .ConfirmationURL }}");
    expect(template).not.toMatch(/<a\b/i);
  });
});
