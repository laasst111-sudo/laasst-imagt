// ============================================================
// sw.js —— Service Worker 离线缓存
// 缓存核心资源，支持 PWA 离线可用
// ============================================================

const CACHE_NAME = 'image-st-v2.3.1';
const CORE_ASSETS = [
  '/scripts/extensions/third-party/image-st/dist/index.js',
  '/scripts/extensions/third-party/image-st/settings.html',
  '/scripts/extensions/third-party/image-st/public/icon-192.png',
  '/scripts/extensions/third-party/image-st/public/icon-512.png',
  '/scripts/extensions/third-party/image-st/worker/lexicon.worker.js',
];

// 安装：预缓存核心资源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CORE_ASSETS).catch((err) => {
        console.warn('[SW] 部分核心资源缓存失败:', err);
      });
    })
  );
  self.skipWaiting();
});

// 激活：清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// 拦截请求：缓存优先，网络兜底
self.addEventListener('fetch', (event) => {
  const { request } = event;
  
  // 只处理 GET 请求
  if (request.method !== 'GET') return;
  
  // 忽略 chrome-extension、data: 等非 http(s) 请求
  const url = new URL(request.url);
  if (!url.protocol.startsWith('http')) return;
  
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      
      return fetch(request).then((networkResponse) => {
        // 只缓存同源且成功的响应
        if (networkResponse.ok && url.origin === location.origin) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone).catch(() => {
              // 忽略缓存失败（配额等）
            });
          });
        }
        return networkResponse;
      }).catch(() => {
        // 离线时无缓存则返回离线页面或错误
        if (request.mode === 'navigate') {
          return caches.match('/scripts/extensions/third-party/image-st/settings.html');
        }
        throw new Error('Network error and no cache');
      });
    })
  );
});

// 消息通信：支持手动清理缓存
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
  if (event.data === 'clearCache') {
    caches.delete(CACHE_NAME).then(() => {
      event.ports[0]?.postMessage({ success: true });
    });
  }
});

export {}; // make it a module