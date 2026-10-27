import { createPrivateKey, sign } from "node:crypto";
import { connect, type ClientHttp2Session } from "node:http2";

export type ApnsConfig = {
  keyId: string; teamId: string; bundleId: string; privateKey: string;
  environment: "sandbox" | "production";
};
export type MobilePushJob = {
  job_id: string; lease: string; device_token: string; recipient_id: string;
  conversation_id: string; sender_name: string;
};
export type PushOutcome = "sent" | "retry" | "invalid_token" | "failed";

// 每次创建发送器也复用 JWT，避免按消息刷新 provider token 被 APNs 限流。
let cached: { configKey: string; issuedAt: number; token: string } | undefined;
export function createApnsSender(config: ApnsConfig, open?: () => ClientHttp2Session) {
  const key = createPrivateKey(config.privateKey);
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("Invalid APNs key");
  const configKey = JSON.stringify([config.keyId, config.teamId, config.privateKey]);
  return async (job: MobilePushJob): Promise<PushOutcome> => {
    const now = Math.floor(Date.now() / 1000);
    if (!cached || cached.configKey !== configKey || now - cached.issuedAt >= 25 * 60 || now < cached.issuedAt) {
      const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: config.keyId })).toString("base64url");
      const claims = Buffer.from(JSON.stringify({ iss: config.teamId, iat: now })).toString("base64url");
      const unsigned = `${header}.${claims}`;
      cached = { configKey, issuedAt: now, token: `${unsigned}.${sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" }).toString("base64url")}` };
    }
    const token = cached.token;
    return new Promise(resolve => {
      let client: ClientHttp2Session | undefined;
      let settled = false;
      const timer = setTimeout(() => done("retry"), 5_000);
      function done(outcome: PushOutcome) {
        if (settled) return;
        settled = true; clearTimeout(timer); client?.destroy(); resolve(outcome);
      }
      try {
        client = open ? open() : connect(config.environment === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com");
        client.on("error", () => done("retry"));
        const stream = client.request({ ":method": "POST", ":path": `/3/device/${job.device_token}`,
          authorization: `bearer ${token}`, "apns-topic": config.bundleId, "apns-push-type": "alert",
          "apns-priority": "10", "apns-expiration": "0", "apns-id": job.job_id, "apns-collapse-id": job.job_id });
        let status = 0, response = "";
        stream.on("response", headers => { status = Number(headers[":status"]); });
        stream.setEncoding("utf8");
        stream.on("data", chunk => { response += chunk; if (response.length > 16_384) done("retry"); });
        stream.on("error", () => done("retry"));
        stream.on("end", () => {
          if (status === 200) return done("sent");
          let reason: string;
          try { reason = JSON.parse(response).reason; } catch { return done("retry"); }
          if (status === 410 && reason === "Unregistered" || status === 400 && reason === "BadDeviceToken") return done("invalid_token");
          if (reason === "ExpiredProviderToken") { cached = undefined; return done("retry"); }
          done(status === 429 || status >= 500 ? "retry" : "failed");
        });
        stream.end(JSON.stringify({ aps: { alert: { title: job.sender_name, body: "发来一条消息" }, sound: "default" },
          type: "direct_message", recipientId: job.recipient_id, conversationId: job.conversation_id, notificationId: job.job_id }));
      } catch { done("retry"); }
    });
  };
}
