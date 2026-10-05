// CourseMate 的 Service Worker：可安装条件、断网离线页、网页推送通知。
// 刻意不缓存任何页面或接口响应：页面内容按登录身份生成，缓存会串号，也会让聊天读到旧数据。
const CACHE = "coursemate-shell-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
});

// 网页推送：通知只带固定文案和一个站内路径，点开后进到对应页面。
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // 载荷不是 JSON 就用默认文案
  }
  const title = typeof data.title === "string" ? data.title : "CourseMate";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "你有新的通知",
      tag: typeof data.tag === "string" ? data.tag : undefined,
      icon: "/icons/icon-192.png",
      data: { url: typeof data.url === "string" ? data.url : "/dashboard" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // 只允许跳本站的页面
  let target = new URL("/dashboard", self.location.origin);
  try {
    const requested = new URL(event.notification.data?.url ?? "/dashboard", self.location.origin);
    if (requested.origin === self.location.origin) target = requested;
  } catch {
    // 地址无效就回大厅
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      for (const client of windows) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(target.href);
          return;
        }
      }
      await self.clients.openWindow(target.href);
    }),
  );
});
