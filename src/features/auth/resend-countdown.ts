export const EMAIL_RESEND_INTERVAL_SECONDS = 60;

export type ResendCountdown = {
  remainingSeconds: number;
  canResend: boolean;
};

export function getResendCountdown(
  sentAtMilliseconds: number,
  nowMilliseconds: number,
): ResendCountdown {
  const elapsedMilliseconds = Math.max(0, nowMilliseconds - sentAtMilliseconds);
  const remainingMilliseconds = Math.max(
    0,
    EMAIL_RESEND_INTERVAL_SECONDS * 1_000 - elapsedMilliseconds,
  );
  const remainingSeconds = Math.ceil(remainingMilliseconds / 1_000);

  return {
    remainingSeconds,
    canResend: remainingSeconds === 0,
  };
}
