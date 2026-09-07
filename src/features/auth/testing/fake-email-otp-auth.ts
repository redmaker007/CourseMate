import type {
  AuthCodeRequestResult,
  AuthCodeVerificationResult,
  EmailOtpAuthPort,
} from "../email-otp-service";

export class FakeEmailOtpAuth implements EmailOtpAuthPort {
  readonly requestedEmails: string[] = [];
  readonly verificationAttempts: Array<{ email: string; code: string }> = [];
  discardedSessionCount = 0;
  nextResult: AuthCodeRequestResult = { status: "accepted" };
  nextVerificationResult: AuthCodeVerificationResult = { status: "verified" };
  nextError: Error | null = null;

  async requestCode(email: string): Promise<AuthCodeRequestResult> {
    this.requestedEmails.push(email);

    if (this.nextError) throw this.nextError;
    return this.nextResult;
  }

  async verifyCode(
    email: string,
    code: string,
  ): Promise<AuthCodeVerificationResult> {
    this.verificationAttempts.push({ email, code });

    if (this.nextError) throw this.nextError;
    return this.nextVerificationResult;
  }

  async discardSession(): Promise<void> {
    this.discardedSessionCount += 1;
  }
}
