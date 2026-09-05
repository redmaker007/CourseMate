import type {
  AuthCodeRequestResult,
  EmailOtpAuthPort,
} from "../email-otp-service";

export class FakeEmailOtpAuth implements EmailOtpAuthPort {
  readonly requestedEmails: string[] = [];
  nextResult: AuthCodeRequestResult = { status: "accepted" };
  nextError: Error | null = null;

  async requestCode(email: string): Promise<AuthCodeRequestResult> {
    this.requestedEmails.push(email);

    if (this.nextError) throw this.nextError;
    return this.nextResult;
  }
}
