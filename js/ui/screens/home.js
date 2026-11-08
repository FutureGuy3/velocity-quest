// ホーム(土台の段階:データベースの状態を確認する仮の画面。次の区切りで本来のホームに置き換える)
import { h, icon, mount, formatDateJa } from '../dom.js';
import { counts, getDeviceId, localDate, listExercises } from '../../db/repo.js';
import { navigate } from '../../router.js';

const LABELS = {
  exercises: '種目', gear: '器具', routines: 'ルーティン', workouts: '練習', sets: 'セット',
  bodyweights: '体重', trials: '試技', goals: '目標', settings: '設定',
};

export async function renderHome() {
  const c = await counts();
  const visible = await listExercises();
  mount(h('div', {},
    h('header', { class: 'topbar' },
      h('div', { class: 'topbar-title' },
        h('span', { class: 'brand' }, 'VELOCITY QUEST'),
        h('span', { class: 'topbar-sub' }, formatDateJa(localDate()))),
      h('button', { class: 'icon-btn', 'aria-label': '設定', onclick: () => navigate('/settings') }, icon('settings'))),
    h('div', { class: 'section-head' }, h('h2', {}, '土台の確認')),
    h('div', { class: 'stack' },
      h('div', { class: 'card' },
        h('p', { class: 'label' }, 'データベースの件数'),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: '8px', marginTop: '8px' } },
          Object.entries(c).map(([k, v]) => h('div', { style: { display: 'flex', flexDirection: 'column' } },
            h('span', { class: 'label' }, LABELS[k] || k),
            h('span', { class: 'num', style: { fontSize: '26px' } }, v))))),
      h('div', { class: 'card' },
        h('p', { class: 'label' }, '表示中の種目(非表示を除く)'),
        h('p', { class: 'num', style: { fontSize: '26px' } }, visible.length),
        h('p', { class: 'label', style: { marginTop: '8px' } }, 'この端末の ID'),
        h('p', { style: { fontSize: '12px', wordBreak: 'break-all' } }, getDeviceId())),
      h('a', { class: 'btn btn-ghost btn-block', href: './tests/calc.test.html' }, '計算のテストを開く'),
    )), { showNav: true, navKey: 'home' });
}
