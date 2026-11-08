// Service Worker:アプリ本体を事前キャッシュしてオフラインで動かす。
// ファイルを変えたら js/version.js の版を上げること(キャッシュ名に使う)。
importScripts('./js/version.js');
const CACHE_VERSION = self.VQ_VERSION;
const APP_CACHE = `vq-app-${CACHE_VERSION}`;
const FONT_CACHE = 'vq-fonts';

const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/tokens.css',
  './css/base.css',
  './css/components.css',
  './js/version.js',
  './js/app.js',
  './js/router.js',
  './js/db/schema.js',
  './js/db/repo.js',
  './js/db/seed.js',
  './js/domain/recordTypes.js',
  './js/domain/calc.js',
  './js/ui/dom.js',
  './js/ui/screens/home.js',
  './js/ui/screens/placeholder.js',
  './js/ui/screens/settings.js',
  './data/exercises.json',
  './vendor/dexie.mjs',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((k) => k.startsWith('vq-app-') && k !== APP_CACHE)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Fonts:キャッシュを先に返し、裏で更新する
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(req, FONT_CACHE));
    return;
  }

  if (url.origin !== self.location.origin) return;

  // 画面遷移:アプリ本体(./ と index.html)はキャッシュから。
  // それ以外のページ(tests/ など)はネットから取り、つながらなければキャッシュ
  if (req.mode === 'navigate') {
    const scope = new URL(self.registration.scope);
    const isApp = url.pathname === scope.pathname || url.pathname === scope.pathname + 'index.html';
    event.respondWith(isApp
      ? caches.match('./index.html').then((r) => r || fetch(req))
      : fetch(req).catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }

  // それ以外:キャッシュにあればそれを、なければ取得してキャッシュに足す
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => cached || fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(APP_CACHE).then((c) => c.put(req, copy));
      }
      return res;
    })),
  );
});

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const fetching = fetch(req).then((res) => {
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
    return res;
  }).catch(() => cached);
  return cached || fetching;
}
