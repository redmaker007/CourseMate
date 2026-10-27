import { createServer, connect } from "node:http2";
import { generateKeyPairSync, verify } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createApnsSender } from "./apns";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const config = { keyId: "ABCDEFGHIJ", teamId: "KLMNOPQRST", bundleId: "edu.example.coursemate", environment: "sandbox" as const,
  privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
const server = createServer();
let address: string;
let status = 200, reason = "";
let received: { headers: Record<string, unknown>; payload: unknown }[] = [];
beforeAll(async () => {
  server.on("stream", (stream, headers) => {
    let body = "";
    stream.on("data", chunk => { body += chunk; });
    stream.on("end", () => {
      received.push({ headers, payload: JSON.parse(body) });
      stream.respond({ ":status": status });
      stream.end(status === 200 ? undefined : JSON.stringify({ reason }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
const job = { job_id: "11111111-1111-4111-8111-111111111111", lease: "22222222-2222-4222-8222-222222222222",
  device_token: "ab".repeat(32), recipient_id: "33333333-3333-4333-8333-333333333333",
  conversation_id: "44444444-4444-4444-8444-444444444444", sender_name: "同学" };

it("真实 HTTP/2 发送只带发送者＋固定提示，以 ES256 签名并复用 provider token", async () => {
  status = 200; received = [];
  const send = createApnsSender(config, () => connect(address));
  expect(await send(job)).toBe("sent");
  expect(await send(job)).toBe("sent");
  const { headers, payload } = received[0];
  expect(headers[":path"]).toBe(`/3/device/${job.device_token}`);
  expect(headers["apns-topic"]).toBe(config.bundleId);
  expect(headers["apns-push-type"]).toBe("alert");
  expect(headers["apns-expiration"]).toBe("0");
  expect(headers["apns-id"]).toBe(job.job_id);
  expect(payload).toEqual({ aps: { alert: { title: "同学", body: "发来一条消息" }, sound: "default" },
    type: "direct_message", recipientId: job.recipient_id, conversationId: job.conversation_id, notificationId: job.job_id });
  const jwt = String(headers.authorization).slice(7).split(".");
  expect(JSON.parse(Buffer.from(jwt[0], "base64url").toString())).toEqual({ alg: "ES256", kid: config.keyId });
  expect(JSON.parse(Buffer.from(jwt[1], "base64url").toString()).iss).toBe(config.teamId);
  expect(verify("sha256", Buffer.from(jwt.slice(0,2).join(".")), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(jwt[2], "base64url"))).toBe(true);
  expect(received[1].headers.authorization).toBe(headers.authorization);
});

it.each([[410,"Unregistered","invalid_token"],[400,"BadDeviceToken","invalid_token"],
  [400,"DeviceTokenNotForTopic","failed"],[403,"InvalidProviderToken","failed"],
  [403,"ExpiredProviderToken","retry"],[429,"TooManyRequests","retry"],[503,"ServiceUnavailable","retry"]] as const)(
  "APNs %s/%s 分类为 %s，配置错误不误删设备", async (code, message, expected) => {
    status = code; reason = message;
    expect(await createApnsSender(config, () => connect(address))(job)).toBe(expected);
  });
