// 起動:データベースを開く → 初期データ → テーマ色 → ルーター開始 → Service Worker 登録
import { initRepo, getSettings } from './db/repo.js';
import { seedIfNeeded } from './db/seed.js';
import { route, fallback, startRouter } from './router.js';
import { h, icon, mount } from './ui/dom.js';
import { renderHome } from './ui/screens/home.js';
import { renderPlaceholder } from './ui/screens/placeholder.js';

export function applyAccent(color) {
  document.documentElement.style.setProperty('--accent', color);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#0B0B0C');
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
  route('/workout', () => renderPlaceholder('トレーニング', 'workout'));
  route('/workout/:id', () => renderPlaceholder('トレーニング記録', null));
  route('/metrics', () => renderPlaceholder('指標と目標', 'metrics'));
  route('/history', () => renderPlaceholder('履歴', 'history'));
  route('/history/:id', () => renderPlaceholder('練習の詳細', null));
  route('/settings', () => renderPlaceholder('設定', null));
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

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW 登録に失敗', e));
  }
}

boot();
