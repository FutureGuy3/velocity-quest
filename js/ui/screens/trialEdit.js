// 試技の入力(立ち幅跳び・垂直跳び など、記録の型が「試技」の種目)
import { h, icon, mount, toast } from '../dom.js';
import { getTrial, saveTrial, deleteTrial, getExercise, localDate } from '../../db/repo.js';
import { trialStats, parseNumber, fmt } from '../../domain/calc.js';
import { back } from '../../router.js';

export async function renderTrialEdit({ params, query }) {
  const existing = params.id ? await getTrial(params.id) : null;
  if (params.id && !existing) { toast('記録が見つかりません'); back('/metrics'); return; }
  const ex = await getExercise(existing?.exerciseId || query.ex);
  if (!ex) { toast('種目が見つかりません'); back('/metrics'); return; }
  const unit = ex.unit || 'cm';
  const st = {
    date: existing?.date || localDate(),
    attempts: existing?.attempts?.length
      ? existing.attempts.map((a) => ({ ...a }))
      : Array.from({ length: unit === 'm' ? 5 : 3 }, () => ({ value: null, foul: false })),
    memo: existing?.memo || '',
  };

  const stats = h('div', { class: 'calc-box' });
  const updateStats = () => {
    const s = trialStats(st.attempts.filter((a) => a.value != null || a.foul));
    stats.replaceChildren(
      h('div', { class: 'cb' }, h('span', { class: 'k' }, '最高'), h('span', { class: 'num big' }, s.best != null ? `${fmt(s.best, 2)}${unit}` : '—')),
      h('div', { class: 'cb' }, h('span', { class: 'k' }, `平均(有効${s.validCount}本)`), h('span', { class: 'num big' }, s.average != null ? `${fmt(s.average, 2)}${unit}` : '—')));
  };

  const grid = h('div', { class: 'attempts' });
  const drawGrid = () => grid.replaceChildren(...st.attempts.map((a, k) => h('div', { class: `attempt${a.foul ? ' foul' : ''}` },
    h('span', { class: 'k' }, `${k + 1}本目`),
    h('input', {
      class: 'cell-input', inputmode: 'decimal', value: a.value ?? '', placeholder: '—', 'aria-label': `${k + 1}本目 ${unit}`,
      oninput: (e) => { a.value = parseNumber(e.target.value); updateStats(); },
    }),
    h('button', { class: 'foul-btn', type: 'button', 'aria-pressed': String(!!a.foul), onclick: () => { a.foul = !a.foul; drawGrid(); updateStats(); } }, 'ファウル'))));

  async function onSave() {
    const attempts = st.attempts.filter((a) => a.value != null || a.foul);
    if (!attempts.length) { toast('1本以上入れてください'); return; }
    await saveTrial({ ...(existing || {}), exerciseId: ex.id, date: st.date || localDate(), attempts, memo: st.memo });
    toast('記録しました');
    back('/metrics');
  }
  async function onDelete() {
    if (!confirm('この記録を削除しますか?')) return;
    await deleteTrial(existing.id);
    toast('削除しました');
    back('/metrics');
  }

  drawGrid();
  updateStats();
  mount(h('div', {},
    h('header', { class: 'topbar' },
      h('button', { class: 'icon-btn', 'aria-label': '戻る', onclick: () => back('/metrics') }, icon('back')),
      h('div', { class: 'topbar-title' }, h('span', { class: 'topbar-sub' }, '試技'), h('span', { class: 'topbar-h' }, ex.name)),
      h('button', { class: 'btn btn-primary', onclick: onSave }, '保存')),
    h('div', { class: 'form' },
      h('div', { class: 'field' },
        h('label', { for: 'tr-date' }, '日付'),
        h('input', { id: 'tr-date', class: 'input', type: 'date', value: st.date, max: localDate(), onchange: (e) => { st.date = e.target.value; } })),
      h('div', { class: 'field' }, h('span', { class: 'label' }, `各試技(${unit})`), grid),
      h('button', { class: 'btn btn-ghost btn-block', type: 'button', onclick: () => { st.attempts.push({ value: null, foul: false }); drawGrid(); } }, '+ 試技を足す'),
      stats,
      h('div', { class: 'field' },
        h('label', { for: 'tr-memo' }, 'メモ'),
        h('input', { id: 'tr-memo', class: 'input', value: st.memo, oninput: (e) => { st.memo = e.target.value; } })),
      existing ? h('button', { class: 'btn btn-danger btn-block', type: 'button', onclick: onDelete }, 'この記録を削除') : null),
  ), { showNav: false });
}
