// 指標:推移を重ねて見る(最大5系統)と、練習タイムの系統の一覧
import { h, icon, toast } from '../dom.js';
import { openOverlay } from '../components/overlay.js';
import { overlayChart, lineSwatch } from '../components/overlayChart.js';
import {
  getSettings, saveSettings, listSeries, getSeriesProgress, getSeriesSummary, saveSeries, getExerciseMap,
  listExerciseIdsWithRecords, getExerciseProgress, listTrials, listBodyweights, listGoals, localDate,
} from '../../db/repo.js';
import { fmt, formatSeconds, trialStats, daysBetween } from '../../domain/calc.js';
import { toShape, toRate, changeOf, isSparse, conditionsText, SERIES_COLORS } from '../../domain/swim.js';
import { fmtGoalValue } from '../goalFormat.js';

export const MAX_LINES = 5;
const OTHER_COLORS = ['#FF8A4C', '#3DDC97', '#E58BF0', '#F5C542', '#5AB4FF', '#A3E635'];
const MODES = [
  { key: 'shape', label: '推移の形', note: '各系統の最初の値を0、期間内の最も良い値を100として並べます。どれが先に伸びたかを見る表示です。伸び幅は下の一覧で確かめます。' },
  { key: 'rate', label: '改善率', note: '期間の最初の値からの改善率(%)です。タイムは縮むほど、重さは増えるほどプラス。伸び幅の大小を比べる表示です。' },
  { key: 'real', label: '実数', note: '秒(左の目盛り、上ほど速い)と、もう1つの単位(右の目盛り)の2軸で表示します。読みやすいのは2〜3系統までです。' },
];
const RANGES = [[90, '3か月'], [180, '6か月'], [365, '1年'], [0, 'すべて']];
const keyOf = (it) => `${it.type}:${it.id ?? ''}`;

/* ---------- 候補と、その値の読み込み ---------- */

async function candidates() {
  const exMap = await getExerciseMap();
  const out = [];
  for (const s of await listSeries()) out.push({ type: 'series', id: s.id, name: s.name, sub: conditionsText(s.conditions), group: '練習タイム' });
  for (const id of await listExerciseIdsWithRecords()) {
    const ex = exMap.get(id);
    if (ex && ex.recordType !== 'trials') out.push({ type: 'exercise', id, name: ex.name, sub: scoreLabel(ex.recordType), group: '種目' });
  }
  for (const ex of [...exMap.values()].filter((e) => e.recordType === 'trials')) {
    if ((await listTrials(ex.id)).length) out.push({ type: 'trial', id: ex.id, name: ex.name, sub: '試技の最高', group: '試技' });
  }
  if ((await listBodyweights()).length) out.push({ type: 'bodyweight', id: null, name: '体重', sub: '', group: '体重' });
  for (const g of await listGoals()) out.push({ type: 'goal', id: g.id, name: `目標:${g.title}`, sub: '目標値の履歴(実数の表示で出します)', group: '目標' });
  return out;
}

function scoreLabel(rt) {
  return { weight_reps: '推定1RM', bw_plus: '推定1RM(体重+加重)', bw_minus: '推定1RM(体重−アシスト)', reps: '最多回数', time: '最長(秒)', height_reps: '最高の台', contacts: '最多の接地回数', distance_band: '最長(m)' }[rt] || 'ベスト';
}
function scoreUnit(rt) {
  return { reps: '回', time: '秒(時間)', height_reps: 'cm', contacts: '回', distance_band: 'm' }[rt] || 'kg';
}

/** 1つの項目の値を読む → { name, sub, unit, better, color, points:[{date,value}], step }
 * color は練習タイムの系統なら系統の色、それ以外は呼び出し側が渡す(重ねた系統と色がかぶらないように) */
async function load(item, rep, color, exMap, seriesMap, goals) {
  if (item.type === 'series') {
    const s = seriesMap.get(item.id);
    if (!s) return null;
    return { name: s.name, sub: conditionsText(s.conditions), unit: '秒', better: 'lower', color: s.color, dash: 'solid', points: await getSeriesProgress(s.id, rep) };
  }
  if (item.type === 'exercise') {
    const ex = exMap.get(item.id);
    if (!ex) return null;
    const pts = (await getExerciseProgress(ex.id)).map((p) => ({ date: p.date, value: p.score }));
    return { name: ex.name, sub: scoreLabel(ex.recordType), unit: scoreUnit(ex.recordType), better: 'higher', color, dash: 'dash', points: pts };
  }
  if (item.type === 'trial') {
    const ex = exMap.get(item.id);
    if (!ex) return null;
    const pts = (await listTrials(ex.id)).map((t) => ({ date: t.date, value: trialStats(t.attempts).best })).filter((p) => p.value != null).reverse();
    return { name: ex.name, sub: '試技の最高', unit: ex.unit || 'cm', better: 'higher', color, dash: 'dot', points: pts };
  }
  if (item.type === 'bodyweight') {
    return { name: '体重', sub: '', unit: 'kg', better: 'higher', color, dash: 'dot', points: (await listBodyweights()).map((b) => ({ date: b.date, value: b.kg })) };
  }
  if (item.type === 'goal') {
    const g = goals.find((x) => x.id === item.id);
    if (!g) return null;
    const pts = (g.targets || [{ value: g.target, setOn: localDate() }]).filter((t) => t.value != null && t.setOn).map((t) => ({ date: t.setOn, value: t.value }));
    return { name: `目標:${g.title}`, sub: '目標値の履歴', unit: g.unit || '', better: g.direction === 'lower' ? 'lower' : 'higher', color: 'var(--text-2)', step: true, points: pts };
  }
  return null;
}

/* ---------- 重ねるグラフの欄 ---------- */

export async function compareSection(rerender) {
  const settings = await getSettings();
  const ov = { items: [], mode: 'shape', range: 180, rep: 'best', hidden: [], ...(settings.overlay || {}) };
  const save = async (patch) => { await saveSettings({ overlay: { ...ov, ...patch } }); rerender(); };
  const exMap = await getExerciseMap();
  const seriesMap = new Map((await listSeries()).map((s) => [s.id, s]));
  const goals = await listGoals();
  const today = localDate();

  // 練習タイムの系統は自分の色。ほかの項目は、選んだ系統の色と重ならない色を順に使う
  const used = new Set(ov.items.filter((it) => it.type === 'series').map((it) => seriesMap.get(it.id)?.color).filter(Boolean));
  const free = [...OTHER_COLORS, ...SERIES_COLORS].filter((c, i, a) => !used.has(c) && a.indexOf(c) === i);
  let fi = 0;
  const colors = ov.items.map((it) => (it.type === 'series' ? null : free[fi++ % free.length]));
  const loaded = (await Promise.all(ov.items.map((it, i) => load(it, ov.rep, colors[i], exMap, seriesMap, goals))))
    .map((d, i) => (d ? { ...d, key: keyOf(ov.items[i]), item: ov.items[i] } : null)).filter(Boolean);

  // 期間で絞り、表示方法に合わせて値を直す
  const inRange = (p) => !ov.range || daysBetween(p.date, today) <= ov.range;
  const realLeftUnit = '秒';
  const realRightUnit = loaded.find((d) => d.unit !== '秒' && !ov.hidden.includes(d.key))?.unit ?? null;
  const notes = [];
  const lines = [];
  const legend = loaded.map((d) => {
    const pts = d.points.filter(inRange);
    const visible = !ov.hidden.includes(d.key);
    const change = d.step ? null : changeOf(pts, d.better);
    let chartPts = null, axis = 'left', invert = false;
    if (ov.mode === 'real') {
      if (d.unit === realLeftUnit) { axis = 'left'; invert = true; } else if (d.unit === realRightUnit) axis = 'right';
      else { axis = null; if (visible) notes.push(`${d.name} は単位が違うので、実数の表示では出せません。`); }
      if (axis) chartPts = pts.map((p) => ({ date: p.date, y: p.value }));
    } else if (d.step) {
      if (visible) notes.push(`${d.name} は「実数」の表示で出します。`);
    } else {
      chartPts = (ov.mode === 'shape' ? toShape(pts, d.better) : toRate(pts, d.better)).map((p) => ({ date: p.date, y: p.y }));
    }
    if (visible && chartPts) lines.push({ ...d, points: chartPts, axis, invert, pointsOnly: !d.step && isSparse(pts) });
    return { d, pts, visible, change };
  });
  // 実数で左に秒の系統がなければ、右の単位を左に
  if (ov.mode === 'real' && !lines.some((l) => l.axis === 'left')) lines.forEach((l) => { if (l.axis === 'right') l.axis = 'left'; });
  const hasRight = lines.some((l) => l.axis === 'right');
  const leftIsSec = lines.some((l) => l.axis === 'left' && l.unit === '秒');

  const axes = ov.mode === 'real'
    ? {
      left: { label: leftIsSec ? '秒' : (realRightUnit || ''), format: (v) => (leftIsSec ? formatSeconds(v) : fmt(v, 1)) },
      right: hasRight ? { label: realRightUnit, format: (v) => fmt(v, 1) } : null,
    }
    : { left: { label: ov.mode === 'shape' ? '' : '%', format: (v) => (ov.mode === 'shape' ? fmt(v, 0) : `${fmt(v, 1)}`) }, right: null };

  const changeText = (c, d) => {
    if (!c) return '—';
    if (d.unit === '秒') return `${c.diff > 0 ? '+' : c.diff < 0 ? '−' : '±'}${formatSeconds(Math.abs(c.diff))}秒`;
    return c.rate == null ? '—' : `${c.rate > 0 ? '+' : c.rate < 0 ? '−' : '±'}${fmt(Math.abs(c.rate), 1)}%`;
  };

  const seg = (opts, cur, onPick, label) => h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label },
    opts.map(([k, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(cur === k), onclick: () => onPick(k) }, l)));

  return h('section', { class: 'card compare-card', 'aria-label': '推移を重ねて見る' },
    h('div', { class: 'trial-head' },
      h('h2', {}, '推移を重ねて見る'),
      h('span', { class: 'label' }, `${loaded.length} / ${MAX_LINES} 系統`)),
    seg(MODES.map((m) => [m.key, m.label]), ov.mode, (k) => save({ mode: k }), '表示方法'),
    h('p', { class: 'hint' }, MODES.find((m) => m.key === ov.mode).note),
    loaded.length ? overlayChart({ lines, axes, zeroLine: ov.mode === 'rate', label: `${loaded.map((d) => d.name).join('、')}の推移` })
      : h('p', { class: 'empty', style: { padding: '24px 8px' } }, '下の「系統を選ぶ」で、練習タイムの系統・種目・試技・体重・目標を最大5つまで選んでください。'),
    notes.length ? h('p', { class: 'hint' }, notes.join(' ')) : null,
    seg(RANGES, ov.range, (k) => save({ range: k }), '期間'),
    loaded.some((d) => d.item.type === 'series')
      ? h('div', { class: 'rep-row' }, h('span', { class: 'label' }, '1回の練習の代表値'),
        seg([['best', '最高'], ['average', '有効な本数の平均']], ov.rep, (k) => save({ rep: k }), '代表値'))
      : null,
    h('ul', { class: 'legend' },
      legend.map(({ d, visible, change, pts }) => h('li', {},
        h('button', {
          type: 'button', class: 'legend-row', 'aria-pressed': String(visible),
          onclick: () => save({ hidden: visible ? [...ov.hidden, d.key] : ov.hidden.filter((k) => k !== d.key) }),
        },
        lineSwatch({ color: d.color, dash: d.dash, step: d.step, pointsOnly: !d.step && isSparse(pts) }),
        h('span', { class: 'info' }, h('span', { class: 'name' }, d.name), h('span', { class: 'sub' }, [d.sub, d.step ? '' : `${pts.length}回分`].filter(Boolean).join(' · '))),
        h('span', { class: 'num delta' }, d.step ? '' : changeText(change, d)))))),
    h('button', { class: 'btn btn-ghost btn-block', type: 'button', onclick: () => chooseItems(ov, save) }, `系統を選ぶ(最大${MAX_LINES})`),
    h('p', { class: 'caution' }, '同時に伸びていても因果とは限りません。期分けや技術練習の記録と合わせて判断してください。'));
}

/** 重ねる系統を選ぶ(最大5) */
async function chooseItems(ov, save) {
  const list = await candidates();
  let chosen = ov.items.map(keyOf);
  openOverlay({
    title: '重ねる系統を選ぶ',
    subtitle: `最大${MAX_LINES}つ`,
    render(api) {
      const wrap = h('div', {});
      const draw = () => {
        const groups = [...new Set(list.map((c) => c.group))];
        wrap.replaceChildren(...[
          ...groups.flatMap((g) => [
            h('h3', { class: 'month-head' }, g),
            h('ul', { class: 'ex-list' }, list.filter((c) => c.group === g).map((c) => {
              const k = keyOf(c);
              const on = chosen.includes(k);
              return h('li', { class: `ex-item${on ? ' selected' : ''}` },
                h('button', {
                  class: 'info', type: 'button',
                  onclick: () => {
                    if (on) chosen = chosen.filter((x) => x !== k);
                    else if (chosen.length >= MAX_LINES) { toast(`重ねられるのは${MAX_LINES}つまでです`); return; }
                    else chosen = [...chosen, k];
                    draw();
                  },
                }, h('span', { class: 'name' }, c.name), c.sub ? h('span', { class: 'meta' }, c.sub) : null),
                h('span', { class: 'check-btn', 'aria-hidden': 'true', 'aria-pressed': String(on) }, icon(on ? 'check' : 'plus', 18, 2.8)));
            })),
          ]),
          list.length ? null : h('p', { class: 'empty' }, 'まだ選べる記録がありません。'),
          h('div', { class: 'picker-bar' },
            h('button', {
              class: 'btn btn-primary', type: 'button',
              onclick: () => {
                const items = chosen.map((k) => list.find((c) => keyOf(c) === k)).filter(Boolean).map((c) => ({ type: c.type, id: c.id }));
                api.close();
                save({ items, hidden: [] });
              },
            }, `${chosen.length}つを重ねる`)),
        ].filter(Boolean));
      };
      draw();
      return wrap;
    },
  });
}

/* ---------- 練習タイムの系統の一覧(名前と色を変える) ---------- */

export async function seriesSection(rerender) {
  const series = await listSeries();
  if (!series.length) return h('p', { class: 'empty', style: { padding: '8px 4px' } }, 'スイム記録でタイムを入れると、条件ごとに系統ができます。');
  const sums = await Promise.all(series.map((s) => getSeriesSummary(s.id)));
  return h('div', { class: 'stack' }, series.map((s, i) => h('button', {
    type: 'button', class: 'goal-row', style: { textAlign: 'left', width: '100%' }, onclick: () => editSeries(s, rerender),
    'aria-label': `${s.name} の名前と色を変える`,
  },
  h('span', { class: 'series-dot', style: { background: s.color } }),
  h('div', { class: 'info' },
    h('span', { class: 'title' }, s.name),
    h('span', { class: 'sub' }, conditionsText(s.conditions))),
  h('div', { class: 'right' },
    h('span', { class: 'k' }, `${sums[i].sessions}回 · ベスト`),
    h('span', { class: 'num' }, sums[i].best ? formatSeconds(sums[i].best.value) : '—')))));
}

function editSeries(s, rerender) {
  openOverlay({
    title: '系統の名前と色',
    subtitle: conditionsText(s.conditions),
    render(api) {
      let color = s.color;
      const nameIn = h('input', { id: 'series-name', class: 'input', value: s.name });
      const sw = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': '色' });
      const drawSw = () => sw.replaceChildren(...SERIES_COLORS.map((c) => h('button', {
        type: 'button', class: 'swatch', role: 'radio', 'aria-checked': String(c === color), 'aria-label': c, style: { background: c },
        onclick: () => { color = c; drawSw(); },
      })));
      drawSw();
      return h('form', {
        class: 'form', novalidate: true,
        onsubmit: async (e) => {
          e.preventDefault();
          const name = nameIn.value.trim();
          if (!name) { toast('名前を入れてください'); return; }
          await saveSeries({ ...s, name, color });
          toast('保存しました'); api.close(); rerender();
        },
      },
      h('div', { class: 'field' }, h('label', { for: 'series-name' }, '表示名(例:ホーム25m)'), nameIn),
      h('div', { class: 'field' }, h('span', { class: 'label' }, '色'), sw),
      h('p', { class: 'hint' }, '条件は変えられません。条件が違うタイムは別の系統になります。'),
      h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, '保存'));
    },
  });
}

