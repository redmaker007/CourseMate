"use client";

import { Bell } from "lucide-react";
import { useEffect, useState } from "react";

import { removePushSubscriptionAction, savePushSubscriptionAction } from "../actions";
import { urlBase64ToUint8Array } from "../vapid-key";

type State =
  | "checking"
  | "unsupported"
  | "needs-install"
  | "denied"
  | "off"
  | "on"
  | "busy";

/**
 * 个人资料页的「新消息通知」开关。只有服务端配好推送（传入公钥）时才会渲染。
 * iPhone 必须先把网页添加到主屏幕才有推送能力，在 Safari 标签页里没有 PushManager。
 */
export function PushCard({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<State>("checking");
  const [error, setError] = useState("");

  useEffect(() => {
    async function detect() {
      const hasPush =
        "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!hasPush) {
        setState(/iPhone|iPad|iPod/i.test(navigator.userAgent) ? "needs-install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setState("denied");
        return;
      }
      try {
        const registration = await navigator.serviceWorker.ready;
        setState((await registration.pushManager.getSubscription()) ? "on" : "off");
      } catch {
        setState("unsupported");
      }
    }
    // 挂载后才能读浏览器能力，服务端渲染时没有
    void detect();
  }, []);

  async function enable() {
    setError("");
    setState("busy");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }));
      const json = subscription.toJSON();
      const result = await savePushSubscriptionAction({
        endpoint: subscription.endpoint,
        keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
      });
      if (result.status !== "saved") {
        await subscription.unsubscribe();
        setError("开启失败，请稍后重试。");
        setState("off");
        return;
      }
      setState("on");
    } catch {
      setError("开启失败，请稍后重试。");
      setState("off");
    }
  }

  async function disable() {
    setError("");
    setState("busy");
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await removePushSubscriptionAction(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setState("off");
    } catch {
      setError("关闭失败，请稍后重试。");
      setState("on");
    }
  }

  if (state === "checking" || state === "unsupported") return null;

  return (
    <section aria-labelledby="push-notifications" className="rounded-xl border border-line bg-card p-4">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink" id="push-notifications">
        <Bell size={15} strokeWidth={1.75} />
        新消息通知
      </h2>
      {state === "needs-install" ? (
        <p className="mt-1.5 text-xs leading-5 text-muted">
          iPhone 需要先把 CourseMate 添加到主屏幕，再从主屏幕打开，才能开启通知。
        </p>
      ) : null}
      {state === "denied" ? (
        <p className="mt-1.5 text-xs leading-5 text-muted">
          通知已被系统或浏览器关闭，请到系统设置里允许 CourseMate 发送通知后再回来开启。
        </p>
      ) : null}
      {state === "off" || state === "on" || state === "busy" ? (
        <>
          <p className="mt-1.5 text-xs leading-5 text-muted">
            收到私聊或好友申请时提醒你。通知里不会显示消息内容。
          </p>
          <button
            className="mt-3 h-10 rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-hover disabled:opacity-60"
            disabled={state === "busy"}
            onClick={state === "on" ? disable : enable}
            type="button"
          >
            {state === "on" ? "关闭通知" : "开启通知"}
          </button>
        </>
      ) : null}
      {error ? (
        <p className="mt-2 text-xs text-badge" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
