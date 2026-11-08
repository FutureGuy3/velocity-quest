// 指標と目標(今は目標の一覧。試技は後の区切りで足す。推移のグラフは段階2)
import { h, mount } from '../dom.js';
import { listGoals, getGoalBest, localDate, GOAL_METRICS, listExercises, listTrials } from '../../db/repo.js';
import { trialStats, fmt } from '../../domain/calc.js';
import { formatDateShort } from '../dom.js';
import { goalTexts } from '../goalFormat.js';

export async function renderMetrics() {
  const today = localDate();
  const goals = await listGoals();
  const bests = await Promise.all(goals.map((g) => getGoalBest(g)));
  const trialExercises = (await listExercises()).filter((e) => e.recordType === 'trials');
  const trialSections = await Promise.all(trialExercises.map(async (ex) => trialSection(ex, await listTrials(ex.id))));

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
