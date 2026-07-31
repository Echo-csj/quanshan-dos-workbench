/* 临时禁用 SW：立即清理所有缓存并卸载自身
 * （解决浏览器顽固缓存问题，恢复为普通网页访问）
 * 后续如需 PWA 离线能力，可恢复正式逻辑。
 */
self.addEventListener('install', function (event) {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { return caches.delete(k); }));
    }).then(function () {
      return self.registration.unregister().then(function () {
        return self.clients.claim();
      });
    })
  );
});

// 不再拦截任何请求，全部走网络
self.addEventListener('fetch', function (event) {
  // 不调用 event.respondWith，浏览器按默认行为处理
});
