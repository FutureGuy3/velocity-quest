// 体重:推移のグラフ、記録の一覧、日付を選んで記録、直す・削除
import { h, icon, mount, toast, formatDateJa, formatDateShort } from '../dom.js';
import { listBodyweights, saveBodyweight, deleteBodyweight, localDate } from '../../db/repo.js';
import { parseNumber, daysBetween } from '../../domain/calc.js';
import { actionSheet } from '../components/overlay.js';
import { miniChart } from '../components/miniChart.js';
import { back } from '../../router.js';

const RANGES = [[30, '30日'], [90, '90日'], [365, '1年'], [0, 'すべて']];
const RANGE_KEY = 'vq.bw.range';

export async function renderBodyweight() {
  const today = localDate();
  const all = await listBodyweights(); // 古い順
  let range = 90;
  try { range = Number(sessionStorage.getItem(RANGE_KEY) ?? 90); } catch { /* 何もしない */ }
  const shown = range ? all.filter((b) => daysBetween(b.date, today) <= range) : all;
  const latest = all[all.length - 1];
  const kg = (v) => `${Number(v).toFixed(1)}kg`;
  const diff = (a, b) => { const d = Math.round((a - b) * 10) / 10; return d === 0 ? '±0' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}`; };

  // 範囲の最初と最後の差、最高・最低
  const first = shown[0];
  const max = shown.reduce((m, b) => (m == null || b.kg > m.kg ? b : m), null);
  const min = shown.reduce((m, b) => (m == null || b.kg < m.kg ? b : m), null);

  /* ---------- 記録する(日付を選べる) ---------- */
  const dateIn = h('input', { id: 'bw-date', class: 'input', type: 'date', value: today, max: today });
  const kgIn = h('input', { id: 'bw-kg', class: 'input num-input', inputmode: 'decimal', placeholder: latest ? latest.kg.toFixed(1) : '00.0' });
  async function onAdd(e) {
    e.preventDefault();
    const v = parseNumber(kgIn.value);
    if (v == null || v < 20 || v > 300) { toast('体重は 20〜300 の数字で入れてください'); kgIn.focus(); return; }
    const d = dateIn.value || today;
    await saveBodyweight(d, Math.round(v * 10) / 10);
    toast(`${formatDateShort(d)} の体重を記録しました`);
    renderBodyweight();
  }

  function rowMenu(b) {
    actionSheet({
      title: `${formatDateJa(b.date)} ${kg(b.kg)}`,
      actions: [
        { label: '値を直す', onSelect: () => { dateIn.value = b.date; kgIn.value = b.kg.toFixed(1); kgIn.focus(); kgIn.scrollIntoView({ block: 'center' }); } },
        { label: 'この記録を削除', danger: true, onSelect: async () => {
          if (!confirm(`${formatDateJa(b.date)} の体重 ${kg(b.kg)} を削除しますか?`)) return;
          await deleteBodyweight(b.id); toast('削除しました'); renderBodyweight();
        } },
      ],
    });
  }

  const list = all.slice().reverse();
  mount(h('div', {},
    h('header', { class: 'topbar' },
      h('button', { class: 'icon-btn', 'aria-label': '戻る', onclick: () => back('/home') }, icon('back')),
      h('div', { class: 'topbar-title' }, h('span', { class: 'topbar-h' }, '体重'))),

    h('div', { class: 'stack' },
      h('section', { class: 'card trial-card', 'aria-label': '体重の推移' },
        h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': '期間' },
          RANGES.map(([d, label]) => h('button', {
            type: 'button', role: 'radio', 'aria-checked': String(range === d),
            onclick: () => { try { sessionStorage.setItem(RANGE_KEY, String(d)); } catch { /* 何もしない */ } renderBodyweight(); },
          }, label))),
        shown.length ? [
          h('div', { class: 'calc-box' },
            h('div', { class: 'cb' }, h('span', { class: 'k' }, '最新'), h('span', { class: 'num big' }, kg(latest.kg)), h('span', { class: 'k' }, formatDateShort(latest.date))),
            h('div', { class: 'cb' }, h('span', { class: 'k' }, '期間の変化'), h('span', { class: 'num' }, shown.length > 1 ? `${diff(shown[shown.length - 1].kg, first.kg)}kg` : '—')),
            h('div', { class: 'cb' }, h('span', { class: 'k' }, '最高 / 最低'), h('span', { class: 'num' }, `${max.kg.toFixed(1)} / ${min.kg.toFixed(1)}`))),
          shown.length > 1
            ? miniChart({ points: shown.map((b) => ({ date: b.date, value: b.kg })), today, format: (v) => v.toFixed(1), label: '体重の推移' })
            : h('p', { class: 'hint' }, '2日分以上の記録があると、グラフを出します。'),
        ] : h('p', { class: 'hint' }, 'この期間の記録はありません。')),

      h('form', { class: 'card form', style: { padding: '14px 16px' }, onsubmit: onAdd, 'aria-label': '体重を記録' },
        h('div', { class: 'row2' },
          h('div', { class: 'field' }, h('label', { for: 'bw-date' }, '日付'), dateIn),
          h('div', { class: 'field' }, h('label', { for: 'bw-kg' }, '体重 kg'), kgIn)),
        h('p', { class: 'hint', style: { marginTop: '-8px' } }, '同じ日にもう一度記録すると上書きします。'),
        h('button', { class: 'btn btn-light btn-block', type: 'submit' }, '記録する'))),

    h('div', { class: 'section-head' }, h('h2', {}, `記録(${all.length})`)),
    h('div', { class: 'stack' },
      list.length ? list.map((b, i) => {
        const prev = list[i + 1];
        return h('button', { class: 'bw-item', type: 'button', onclick: () => rowMenu(b), 'aria-label': `${formatDateJa(b.date)} ${kg(b.kg)} のメニュー` },
          h('span', { class: 'd' }, formatDateJa(b.date)),
          h('span', { class: 'num v' }, kg(b.kg)),
          h('span', { class: 'diff' }, prev ? diff(b.kg, prev.kg) : ''));
      }) : h('p', { class: 'empty' }, 'まだ記録がありません。')),
    h('div', { style: { height: '24px' } }),
  ), { showNav: false });
}

