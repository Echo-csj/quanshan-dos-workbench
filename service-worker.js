/* 状元港·泉山校区 DOS 个人工作台 — Service Worker
 * 离线优先缓存策略：预缓存全部静态资源，运行时 cache-first，
 * 导航请求离线时回退到 index.html。后台静默更新。
 */
var CACHE = 'dos-workbench-v1';
var PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './js/store.js',
  './js/baseline.js',
  './js/router.js',
  './js/util.js',
  './js/seed.js',
  './js/importer.js',
  './js/lib/xlsx.full.min.js',
  './js/views/today.js',
  './js/views/timeline.js',
  './js/views/tasks.js',
  './js/views/data.js',
  './js/views/projects.js',
  './js/views/settings.js'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll(PRECACHE);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  // 只处理同源请求
  if (url.origin !== self.location.origin) return;

  // 导航请求：网络优先，失败回退缓存首页（离线可用）
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(function () {
        return caches.match('./index.html');
      })
    );
    return;
  }

  // 其他静态资源：cache-first，缺失则网络拉取并回填
  event.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
