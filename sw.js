const CACHE_NAME = 'niannian-app-shell-20260824-shell-align-r2';
// 与 index.html 实际引用保持一致（改页面资源版本号时必须同步这里）
const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.css?v=20260802-home-header-recovery-r2',
  '/product.css?v=20260804-workbench-clarity-r2',
  '/product-system.css?v=20260810-workbench-team-docs-r1',
  '/hero-oil-paint.css?v=20260727-step02-public-projection-r1',
  '/amber-authority.css?v=20260802-unified-header-r3',
  '/director-desk.css?v=20260805-owned-canvas-director-import-r2',
  '/step04-delivery.css?v=20260802-step04-word-delivery-r3',
  '/vendor/gsap-3.13.0.min.js?v=3.13.0',
  '/vendor/gsap-flip-3.13.0.min.js?v=3.13.0',
  '/app.js?v=20260810-workbench-team-docs-r1',
  '/mvp-step02-r13.js?v=20260810-project-library-rows-r1',
  '/mvp-step03-r1.js?v=20260727-step02-public-projection-r1',
  '/mvp-step01-ledger-r1.js?v=20260727-step02-public-projection-r1',
  '/mvp-step01-story-r1.js?v=20260727-step02-public-projection-r1',
  '/mvp-source-truth-r1.js?v=20260727-step02-public-projection-r1',
  '/manifest.webmanifest'
];

function isProjectOrMediaRequest(url) {
  return url.pathname.startsWith('/api/') || url.pathname.startsWith('/assets/') || url.pathname.startsWith('/studio/assets/');
}

self.addEventListener('install', event => {
  // 单个预缓存条目失败不应让整个 Service Worker 安装失败（历史上 APP_SHELL 与
  // 页面实际版本漂移过，addAll 一旦 404 会导致新 SW 永远装不上）。
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => Promise.all(
      APP_SHELL.map(url => cache.add(new Request(url, {cache: 'reload'})).catch(error => {
        console.warn('[sw] precache failed:', url, String(error));
      }))
    )).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isProjectOrMediaRequest(url)) {
    event.respondWith(fetch(request));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/index.html')));
    return;
  }
  // stale-while-revalidate：先回缓存保证速度，同时后台更新，避免"改了文件没升 ?v=
  // 用户永远看到旧版"。带 ?v= 的请求内容不可变时后台刷新只是廉价的一次条件请求。
  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request).then(response => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone)).catch(() => {});
        }
        return response;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
