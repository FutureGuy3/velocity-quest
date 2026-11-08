// 設定(今は仮。単位以外の項目は「設定」の区切りで作る)。開発用の確認情報を下に置く
import { h, icon, mount } from '../dom.js';
import { counts, getDeviceId, IS_PREVIEW } from '../../db/repo.js';
import { back } from '../../router.js';

const LABELS = {
  exercises: '種目', gear: '器具', routines: 'ルーティン', workouts: '練習', sets: 'セット',
  bodyweights: '体重', trials: '試技', goals: '目標', settings: '設定',
};

export async function renderSettings() {
  const c = await counts();
  mount(h('div', {},
    h('header', { class: 'topbar' },
      h('button', { class: 'icon-btn', 'aria-label': '戻る', onclick: () => back() }, icon('back')),
      h('div', { class: 'topbar-title' }, h('span', { class: 'topbar-h' }, '設定'))),
    h('p', { class: 'empty' }, '設定の項目はこれから作ります。'),
    h('div', { class: 'section-head' }, h('h2', {}, 'アプリの情報')),
    h('div', { class: 'stack' },
      h('div', { class: 'card' },
        h('p', { class: 'label' }, '版'),
        h('p', { class: 'num', style: { fontSize: '22px' } }, self.VQ_VERSION, IS_PREVIEW ? '(テスト版)' : ''),
        h('p', { class: 'label', style: { marginTop: '10px' } }, 'データの件数'),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: '8px', marginTop: '6px' } },
          Object.entries(c).map(([k, v]) => h('div', { style: { display: 'flex', flexDirection: 'column' } },
            h('span', { class: 'label' }, LABELS[k] || k),
            h('span', { class: 'num', style: { fontSize: '22px' } }, v)))),
        h('p', { class: 'label', style: { marginTop: '10px' } }, 'この端末の ID'),
        h('p', { style: { fontSize: '12px', wordBreak: 'break-all' } }, getDeviceId())),
      h('a', { class: 'btn btn-ghost btn-block', href: './tests/calc.test.html' }, '計算のテストを開く')),
  ), { showNav: false });
}
