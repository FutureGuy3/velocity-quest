// 指標と目標:目標の一覧、選んだ種目のベストの推移、試技(立ち幅跳び・垂直跳び)
// 複数の指標を重ねるグラフは段階2
import { h, icon, mount, toast } from '../dom.js';
import {
  listGoals, getGoalBest, localDate, GOAL_METRICS, listExercises, listTrials,
  getSettings, saveSettings, getExerciseMap, getExerciseProgress,
} from '../../db/repo.js';
import { openPicker } from '../components/picker.js';
import { actionSheet } from '../components/overlay.js';
import { formatSet } from '../setFormat.js';
import { trialStats, fmt } from '../../domain/calc.js';
import { formatDateShort } from '../dom.js';
import { goalTexts } from '../goalFormat.js';

export async function renderMetrics() {
  const today = localDate();
  const goals = await listGoals();
  const bests = await Promise.all(goals.map((g) => getGoalBest(g)));
  const trialExercises = (await listExercises()).filter((e) => e.recordType === 'trials');
  const trialSections = await Promise.all(trialExercises.map(async (ex) => trialSection(ex, await listTrials(ex.id))));
  const settings = await getSettings();
  const exMap = await getExerciseMap();
  const tracked = (settings.trackedExercises || []).map((id) => exMap.get(id)).filter(Boolean);
  const progress = await Promise.all(tracked.map((ex) => getExerciseProgress(ex.id)));

  async function addTracked() {
    openPicker({
      context: '推移を見る種目',
      onDone: async (ids) => {
        const skipped = ids.filter((id) => exMap.get(id)?.recordType === 'trials');
        const cur = settings.trackedExercises || [];
        const next = [...cur, ...ids.filter((id) => !cur.includes(id) && !skipped.includes(id))];
        await saveSettings({ trackedExercises: next });
        if (skipped.length) toast('立ち幅跳び・垂直跳びは下の「試技」に出ています');
        renderMetrics();
      },
    });
  }
  async function untrack(id) {
    await saveSettings({ trackedExercises: (settings.trackedExercises || []).filter((x) => x !== id) });
    renderMetrics();
  }

  mount(h('div', {},
    h('header', { class: 'topbar' },
      h('div', { class: 'topbar-title' }, h('h1', { class: 'topbar-h' }, '指標と目標'))),
    h('div', { class: 'section-head', style: { paddingTop: '8px' } },
      h('h2', {}, '目標'),
      h('a', { href: '#/goal/new' }, '+ 目標を作る')),
    h('div', { class: 'stack' },
      goals.length
        ? goals.map((g, i) => goalRow(g, bests[i], today))
        : h('p', { class: 'empty', style: { padding: '8px 4px' } }, '目標はまだありません。「+ 目標を作る」から作れます。')),
    h('div', { class: 'section-head' },
      h('h2', {}, '種目のベストの推移'),
      h('button', { class: 'link-btn', type: 'button', onclick: addTracked }, '+ 種目を追加')),
    h('div', { class: 'stack' },
      tracked.length
        ? tracked.map((ex, i) => progressCard(ex, progress[i], () => actionSheet({
          title: ex.name, actions: [{ label: '推移の一覧から外す', danger: true, onSelect: () => untrack(ex.id) }],
        })))
        : h('p', { class: 'empty', style: { padding: '8px 4px' } }, '加重懸垂やルーマニアンデッドリフトなど、ベストの推移を見たい種目を「+ 種目を追加」で選んでください。')),
    h('div', { class: 'section-head' }, h('h2', {}, '試技')),
    trialSections,
  ), { showNav: true, navKey: 'metrics' });
}

function goalRow(g, best, today) {
  const t = goalTexts(g, best, today);
  const how = GOAL_METRICS[g.metric?.type] || '';
  return h('a', { class: `goal-row${g.pinned ? ' pinned' : ''}`, href: `#/goal/${g.id}`, 'aria-label': `${g.title}を編集` },
    h('div', { class: 'info' },
      g.pinned ? h('span', { class: 'tag' }, 'ホームに表示中') : null,
      h('span', { class: 'title' }, `${g.title} ${t.target}${t.suffix}`),
      h('span', { class: 'sub' }, `${how} · ${t.bestLabel} ${t.best}${t.bestDate ? `(${t.bestDate})` : ''} · あと ${t.remain}`)),
    h('div', { class: 'right' },
      h('span', { class: 'k' }, '期限まで'),
      h('span', { class: 'num' }, t.days)));
}

/** 試技の種目ごとの欄:最新の各試技、最高・平均、前回の平均、過去の記録 */
function trialSection(ex, records) {
  const unit = ex.unit || '';
  const latest = records[0];
  const prev = records[1];
  const st = latest ? trialStats(latest.attempts) : null;
  const prevSt = prev ? trialStats(prev.attempts) : null;
  const d = (v) => (v == null ? '—' : `${fmt(v, 2)}${unit}`);
  return h('section', { class: 'card trial-card', style: { margin: '12px var(--gutter) 0' }, 'aria-label': ex.name },
    h('div', { class: 'trial-head' },
      h('h2', {}, ex.name),
      h('span', { class: 'label' }, latest ? `${formatDateShort(latest.date)} · ${latest.attempts.length}試技` : '記録なし')),
    latest ? h('a', { class: 'trial-chips', href: `#/trial/${latest.id}`, 'aria-label': '最新の記録を編集' },
      latest.attempts.map((a, i) => h('div', { class: `trial-chip${a.foul ? ' foul' : ''}${!a.foul && a.value === st.best ? ' best' : ''}` },
        h('span', { class: 'n' }, `${i + 1}本目`),
        h('span', { class: 'v' }, a.foul ? 'ファウル' : fmt(a.value, 2))))) : null,
    latest ? h('div', { class: 'calc-box' },
      h('div', { class: 'cb' }, h('span', { class: 'k' }, '最高'), h('span', { class: 'num big' }, d(st.best))),
      h('div', { class: 'cb' }, h('span', { class: 'k' }, `平均(有効${st.validCount}本)`), h('span', { class: 'num big' }, d(st.average))),
      h('div', { class: 'cb' }, h('span', { class: 'k' }, '前回の平均'), h('span', { class: 'num' }, d(prevSt?.average)))) : null,
    records.length > 1 ? h('div', { class: 'trial-past' },
      records.slice(1, 6).map((r) => {
        const s = trialStats(r.attempts);
        return h('a', { href: `#/trial/${r.id}` }, h('span', {}, formatDateShort(r.date)), h('span', { class: 'num' }, `最高 ${d(s.best)} · 平均 ${d(s.average)}`));
      })) : null,
    h('a', { class: 'btn btn-ghost btn-block', href: `#/trial/new?ex=${encodeURIComponent(ex.id)}` }, '+ 記録する'));
}

/* ---------- 種目のベストの推移 ---------- */

const SCORE = {
  weight_reps: { label: '推定1RM', unit: 'kg', digits: 1 },
  bw_plus: { label: '推定1RM(体重+加重)', unit: 'kg', digits: 1 },
  bw_minus: { label: '推定1RM(体重−アシスト)', unit: 'kg', digits: 1 },
  reps: { label: '最多回数', unit: '回', digits: 0 },
  time: { label: '最長', unit: '秒', digits: 0 },
  height_reps: { label: '最高の台', unit: 'cm', digits: 0 },
  contacts: { label: '最多の接地回数', unit: '回', digits: 0 },
  distance_band: { label: '最長', unit: 'm', digits: 1 },
};

function progressCard(ex, rows, onMenu) {
  const sc = SCORE[ex.recordType] || { label: 'ベスト', unit: '', digits: 1 };
  const f = (v) => (v == null ? '—' : `${fmt(v, sc.digits)}${sc.unit}`);
  const best = rows.reduce((b, r) => (!b || r.score > b.score ? r : b), null);
  const last = rows[rows.length - 1];
  const first = rows[0];
  const recent = rows.slice(-6).reverse();
  return h('section', { class: 'card trial-card', 'aria-label': `${ex.name}の推移` },
    h('div', { class: 'trial-head' },
      h('h2', {}, ex.name),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': `${ex.name}のメニュー`, onclick: onMenu }, icon('more'))),
    rows.length ? [
      h('div', { class: 'calc-box' },
        h('div', { class: 'cb' }, h('span', { class: 'k' }, `ベスト(${sc.label})`), h('span', { class: 'num big' }, f(best.score)),
          h('span', { class: 'k' }, `${formatDateShort(best.date)} · ${formatSet(ex.recordType, best.set)}`)),
        h('div', { class: 'cb' }, h('span', { class: 'k' }, '最初から'), h('span', { class: 'num' }, rows.length > 1 ? signed(last.score - first.score, sc) : '—'),
          h('span', { class: 'k' }, `${rows.length}回分`))),
      rows.length > 1 ? sparkline(rows) : null,
      h('div', { class: 'trial-past' },
        recent.map((r, i) => {
          const prev = rows[rows.length - 1 - i - 1];
          return h('a', { href: `#/history/${r.workoutId}` },
            h('span', {}, formatDateShort(r.date), r === best ? h('span', { class: 'tag-mini accent', style: { marginLeft: '6px' } }, 'ベスト') : null),
            h('span', { class: 'num' }, `${formatSet(ex.recordType, r.set)} → ${f(r.score)}${prev ? `(${signed(r.score - prev.score, sc)})` : ''}`));
        })),
    ] : h('p', { class: 'hint' }, 'まだ記録がありません。トレーニングで完了したセットから出します。'));
}

function signed(d, sc) {
  const v = Number(d.toFixed(sc.digits));
  if (v === 0) return '±0';
  return `${v > 0 ? '+' : '−'}${fmt(Math.abs(v), sc.digits)}${sc.unit}`;
}

/** 練習ごとのベストを結んだ小さな折れ線(複数の指標を重ねるグラフは段階2) */
function sparkline(rows) {
  const W = 320, H = 64, P = 6;
  const pts = rows.slice(-20);
  const vals = pts.map((r) => r.score);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const xy = pts.map((r, i) => [P + (i * (W - 2 * P)) / Math.max(1, pts.length - 1), H - P - ((r.score - min) / span) * (H - 2 * P)]);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'sparkline');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `直近${pts.length}回のベストの推移`);
  svg.innerHTML = `<polyline points="${xy.map((p) => p.join(',')).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`
    + xy.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" fill="var(--accent)"/>`).join('');
  return svg;
}
