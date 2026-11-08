// 起動:データベースを開く → 初期データ → テーマ色 → ルーター開始 → Service Worker 登録
import { initRepo, getSettings, getActiveWorkout } from './db/repo.js';
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
    .catch((e) => console.warn('SW 登録に失敗', e));
}

boot();
