// 設定:テーマの色、器具(バーの重さ)、種目の管理、書き出し・読み込み、アプリの情報
import { h, icon, mount, toast, applyAccent } from '../dom.js';
import { openPicker } from '../components/picker.js';
import { actionSheet } from '../components/overlay.js';
import {
  counts, getDeviceId, IS_PREVIEW, getSettings, saveSettings, listGear, saveGear, deleteGear,
  exportAll, importAll, localDate,
} from '../../db/repo.js';
import { parseNumber, fmt } from '../../domain/calc.js';
import { back } from '../../router.js';

const ACCENTS = [
  ['#FF6A1A', 'オレンジ'], ['#FFB020', 'イエロー'], ['#3DDC97', 'グリーン'], ['#4DA3FF', 'ブルー'],
];
const LABELS = {
  exercises: '種目', gear: '器具', routines: 'ルーティン', workouts: '練習', sets: 'セット',
  bodyweights: '体重', trials: '試技', goals: '目標', settings: '設定',
};

export async function renderSettings() {
  const [settings, gear, c] = await Promise.all([getSettings(), listGear(), counts()]);

  const section = (title, ...children) => [
    h('div', { class: 'section-head' }, h('h2', {}, title)),
    h('div', { class: 'stack settings-group' }, ...children),
  ];

  /* ---------- テーマの色 ---------- */
  const swatches = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'テーマの色' },
    ACCENTS.map(([color, name]) => h('button', {
      class: 'swatch', type: 'button', role: 'radio', 'aria-label': name, 'aria-checked': String(settings.accent === color),
      style: { background: color },
      onclick: async () => { await saveSettings({ accent: color }); applyAccent(color); renderSettings(); },
    })));

  /* ---------- 器具 ---------- */
  const gearRows = gear.map((g) => {
    const name = h('input', { class: 'input', value: g.name, 'aria-label': '器具の名前', onchange: async (e) => { const v = e.target.value.trim(); if (v) await saveGear({ ...g, name: v }); } });
    const bar = h('input', {
      class: 'input num-input', inputmode: 'decimal', value: fmt(g.barWeight), 'aria-label': `${g.name}のバーの重さ kg`,
      onchange: async (e) => {
        const v = parseNumber(e.target.value);
        if (v == null || v < 0 || v > 100) { toast('バーの重さは 0〜100 の数字で入れてください'); e.target.value = fmt(g.barWeight); return; }
        await saveGear({ ...g, barWeight: v }); toast('保存しました');
      },
    });
    return h('div', { class: 'gear-row' }, name, bar,
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': `${g.name}を削除`, onclick: async () => {
        if (!confirm(`「${g.name}」を削除しますか?この器具を使う種目は、重さの内訳が出なくなります。`)) return;
        await deleteGear(g.id); renderSettings();
      } }, icon('trash', 18)));
  });

  /* ---------- 書き出し・読み込み ---------- */
  async function doExport() {
    const data = await exportAll();
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const name = `velocity-quest-${localDate().replace(/-/g, '')}.json`;
    const file = new File([blob], name, { type: 'application/json' });
    // スマホでは共有シートから保存できるようにする(使えなければダウンロード)
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('書き出しました');
  }

  const fileInput = h('input', {
    type: 'file', accept: 'application/json,.json', class: 'sr-only', 'aria-hidden': 'true', tabindex: '-1',
    onchange: async (e) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (!f) return;
      let data;
      try { data = JSON.parse(await f.text()); } catch { toast('ファイルを読めませんでした'); return; }
      const run = async (mode) => {
        if (mode === 'replace' && !confirm('この端末のデータをすべて消して、ファイルの内容に置き換えます。よろしいですか?')) return;
        try {
          const rep = await importAll(data, { mode });
          const added = Object.values(rep).reduce((s, r) => s + r.added + r.updated, 0);
          toast(added ? `読み込みました(追加・更新 ${added}件)` : '読み込みました(新しいデータはありませんでした)');
          const st = await getSettings(); applyAccent(st.accent);
          renderSettings();
        } catch (err) { toast(err.message); }
      };
      actionSheet({
        title: '読み込み方を選んでください',
        actions: [
          { label: '統合(同じデータは新しい方を残す)', onSelect: () => run('merge') },
          { label: '置き換え(この端末のデータを消す)', danger: true, onSelect: () => run('replace') },
        ],
      });
    },
  });

  mount(h('div', {},
    h('header', { class: 'topbar' },
      h('button', { class: 'icon-btn', 'aria-label': '戻る', onclick: () => back('/home') }, icon('back')),
      h('div', { class: 'topbar-title' }, h('span', { class: 'topbar-h' }, '設定'))),

    section('テーマの色', h('div', { class: 'card' }, swatches)),

    section('器具とバーの重さ',
      h('p', { class: 'hint' }, 'バーのある種目は、トレーニング中に「バー+プレート片側×2」で合計を出します。'),
      h('div', { class: 'gear-row label' }, h('span', {}, '名前'), h('span', {}, 'バー kg'), h('span', {})),
      gearRows,
      h('button', { class: 'btn btn-ghost btn-block', onclick: async () => { await saveGear({ name: '新しいバー', barWeight: 20 }); renderSettings(); } }, '+ 器具を追加')),

    section('種目',
      h('button', { class: 'btn btn-ghost btn-block', onclick: () => openPicker({ mode: 'manage', context: '登録・編集・非表示' }) }, '種目の管理(登録・編集・非表示)')),

    section('バックアップ',
      h('p', { class: 'hint' }, 'すべての記録を1つのファイルに書き出します。機種変更や、もしものときに読み込んで戻せます。'),
      h('button', { class: 'btn btn-light btn-block', onclick: doExport }, '書き出す'),
      h('button', { class: 'btn btn-ghost btn-block', onclick: () => fileInput.click() }, '読み込む'),
      fileInput),

    section('アプリの情報',
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
    h('div', { style: { height: '24px' } }),
  ), { showNav: false });
}
