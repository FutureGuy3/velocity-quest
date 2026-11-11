// Service Worker:アプリ本体を事前キャッシュしてオフラインで動かす。
// ファイルを変えたら js/version.js の版を上げること(キャッシュ名に使う)。
importScripts('./js/version.js');
const CACHE_VERSION = self.VQ_VERSION;
// 本番(/velocity-quest/)とテスト版(/velocity-quest/preview/)は同じサイトにあるので、
// キャッシュ名に配信場所を入れて、互いのキャッシュを消さないようにする
const SCOPE_TAG = new URL(self.registration.scope).pathname;
const APP_PREFIX = `vq-app-${SCOPE_TAG}-`;
const APP_CACHE = `${APP_PREFIX}${CACHE_VERSION}`;
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
  './js/ui/screens/goalEdit.js',
  './js/ui/screens/metrics.js',
  './js/ui/goalFormat.js',
  './js/ui/setFormat.js',
  './js/ui/screens/routineEdit.js',
  './js/ui/screens/workout.js',
  './js/ui/screens/history.js',
  './js/ui/screens/trialEdit.js',
  './js/ui/components/overlay.js',
  './js/ui/components/picker.js',
  './js/ui/components/exerciseForm.js',
  './js/ui/components/restTimer.js',
  './js/ui/components/wakeLock.js',
  './js/ui/components/reorder.js',
  './js/ui/components/pads.js',
  './js/domain/presets.js',
  './js/ui/components/miniChart.js',
  './js/ui/screens/bodyweight.js',
  './js/ui/screens/pool.js',
  './js/ui/screens/compare.js',
  './js/ui/components/overlayChart.js',
  './js/domain/swim.js',
  './data/exercises.json',
  './vendor/dexie.mjs',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

/**
 * 自分の配信場所のキャッシュだけから探す。
 * caches.match はサイト全体のキャッシュを探すので、本番のキャッシュに残った古いテスト版の部品を返してしまうことがある
 */
function ownMatch(req) {
  return caches.open(APP_CACHE).then((c) => c.match(req, { ignoreSearch: true }));
}

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
        // 自分の配信場所の古い版と、場所を入れる前の名前(vq-app-0.x.x)だけを消す
        .filter((k) => (k.startsWith(APP_PREFIX) && k !== APP_CACHE) || /^vq-app-\d/.test(k))
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

  // 版の確かめ(app.js の ensureLatest)は、キャッシュを使わず必ずネットに聞く
  if (url.searchParams.has('check')) return;

  // 本番の Service Worker は、中にあるテスト版(preview/)の部品を扱わない(テスト版の古い部品を抱え込まないように)
  const scopePath = new URL(self.registration.scope).pathname;
  if (!scopePath.endsWith('/preview/') && url.pathname.startsWith(`${scopePath}preview/`)) return;
  // 更新用のページはいつもネットから
  if (url.pathname.endsWith('/update.html')) return;

  // 画面遷移:アプリ本体(./ と index.html)はキャッシュから。
  // それ以外のページ(tests/ など)はネットから取り、つながらなければキャッシュ
  if (req.mode === 'navigate') {
    const scope = new URL(self.registration.scope);
    const isApp = url.pathname === scope.pathname || url.pathname === scope.pathname + 'index.html';
    event.respondWith(isApp
      ? ownMatch('./index.html').then((r) => r || fetch(req))
      : fetch(req).catch(() => ownMatch(req)));
    return;
  }

  // それ以外:キャッシュにあればそれを、なければ取得してキャッシュに足す
  event.respondWith(
    ownMatch(req).then((cached) => cached || fetch(req).then((res) => {
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
