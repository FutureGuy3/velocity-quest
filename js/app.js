// 起動:データベースを開く → 初期データ → テーマ色 → ルーター開始 → Service Worker 登録
import { initRepo, getSettings, getActiveWorkout, IS_PREVIEW } from './db/repo.js';
import { seedIfNeeded } from './db/seed.js';
import { route, fallback, startRouter } from './router.js';
import { h, icon, mount, toast, applyAccent } from './ui/dom.js';
import { renderHome } from './ui/screens/home.js';
import { renderPlaceholder } from './ui/screens/placeholder.js';
import { renderSettings } from './ui/screens/settings.js';
import { renderGoalEdit } from './ui/screens/goalEdit.js';
import { renderMetrics } from './ui/screens/metrics.js';
import { renderRoutineEdit } from './ui/screens/routineEdit.js';
import { renderWorkoutStart, renderWorkout } from './ui/screens/workout.js';
import { renderHistory, renderHistoryDetail } from './ui/screens/history.js';
import { renderTrialEdit } from './ui/screens/trialEdit.js';
import { renderBodyweight } from './ui/screens/bodyweight.js';
import { renderPool } from './ui/screens/pool.js';

/** テスト版だけ、画面の上に目立つ帯を出す(本番と見間違えないように) */
function previewBanner() {
  if (!IS_PREVIEW) return;
  document.body.prepend(h('div', { class: 'preview-banner', role: 'note' }, `テスト版 ${self.VQ_VERSION}(本番とは別のデータ)`));
}

function buildNav() {
  const nav = document.getElementById('nav');
  const items = [
    ['home', '#/home', 'ホーム', 'home'],
    ['workout', '#/workout', 'トレーニング', 'dumbbell'],
    ['metrics', '#/metrics', '指標', 'chart'],
    ['history', '#/history', '履歴', 'calendar'],
  ];
  nav.replaceChildren(...items.map(([key, href, label, ic]) =>
    h('a', { href, 'data-key': key }, icon(ic, 22), label)));
}

function registerRoutes() {
  route('/home', () => renderHome());
  route('/workout', () => renderWorkoutStart());
  route('/workout/:id', (r) => renderWorkout(r));
  route('/metrics', () => renderMetrics());
  route('/history', () => renderHistory());
  route('/history/:id', (r) => renderHistoryDetail(r));
  route('/settings', () => renderSettings());
  route('/bodyweight', () => renderBodyweight());
  route('/pool/:id', (r) => renderPool(r));
  route('/routine/new', (r) => renderRoutineEdit(r));
  route('/routine/:id', (r) => renderRoutineEdit(r));
  route('/trial/new', (r) => renderTrialEdit(r));
  route('/trial/:id', (r) => renderTrialEdit(r));
  route('/goal/new', (r) => renderGoalEdit(r));
  route('/goal/:id', (r) => renderGoalEdit(r));
  fallback(() => renderPlaceholder('ページが見つかりません', null));
}

function showFatal(err) {
  console.error(err);
  mount(h('div', { class: 'empty' },
    h('p', {}, '起動できませんでした。'),
    h('p', { class: 'muted' }, String(err?.message || err))), { showNav: false });
}

async function boot() {
  buildNav();
  previewBanner();
  try {
    await initRepo();
    await seedIfNeeded();
    const settings = await getSettings();
    applyAccent(settings.accent);
  } catch (err) {
    showFatal(err);
    return;
  }
  registerRoutes();
  startRouter();

  registerServiceWorker();
}

// 新しい版が届いたら読み込み直す(1回目に開いたときから新しい版を見られるように)。
// ただしトレーニング記録中は勝手に読み込み直さず、知らせるだけにする。
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', async () => {
    if (!hadController || reloading) return; // 初回の登録では読み込み直さない
    if (await getActiveWorkout()) {
      toast('新しい版があります。トレーニングを終えてから開き直してください');
      return;
    }
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
    .then((reg) => reg.update())
    .catch((e) => console.warn('SW 登録に失敗', e))
    .then(() => ensureLatest());
}

/**
 * 公開中の版の番号を確かめ、この端末の版より新しければ入れ替える。
 * スマホのブラウザは Service Worker の更新を確かめないことがあり、古い版のままになるため。
 * 記録中のトレーニングがあるときと、電波がないときは何もしない。同じ版への入れ替えは1回だけ試す
 */
async function ensureLatest() {
  try {
    const res = await fetch(`./js/version.js?check=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const latest = ((await res.text()).match(/'([0-9.]+)'/) || [])[1];
    if (!latest || latest === self.VQ_VERSION) return;
    const tried = `vq.update.tried.${latest}`;
    if (sessionStorage.getItem(tried)) return;
    sessionStorage.setItem(tried, '1');
    if (await getActiveWorkout()) { toast(`新しい版(${latest})があります。トレーニングを終えてから開き直してください`); return; }
    const scope = new URL('./', location.href).href;
    for (const r of await navigator.serviceWorker.getRegistrations()) if (r.scope === scope) await r.unregister();
    const prefix = `vq-app-${new URL(scope).pathname}-`;
    for (const k of await caches.keys()) if (k.startsWith(prefix)) await caches.delete(k);
    location.replace(`${location.pathname}?v=${latest}${location.hash}`);
  } catch { /* 電波がないときなどは何もしない */ }
}

boot();
