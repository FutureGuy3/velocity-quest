// 指標と目標(今は目標の一覧。試技は後の区切りで足す。推移のグラフは段階2)
import { h, mount } from '../dom.js';
import { listGoals, getGoalBest, localDate, GOAL_METRICS } from '../../db/repo.js';
import { goalTexts } from '../goalFormat.js';

export async function renderMetrics() {
  const today = localDate();
  const goals = await listGoals();
  const bests = await Promise.all(goals.map((g) => getGoalBest(g)));

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
    h('p', { class: 'empty' }, '立ち幅跳び・垂直跳びの試技は、これから作ります。'),
  ), { showNav: true, navKey: 'metrics' });
}

function goalRow(g, best, today) {
  const t = goalTexts(g, best, today);
  const how = GOAL_METRICS[g.metric?.type] || '';
  return h('a', { class: `goal-row${g.pinned ? ' pinned' : ''}`, href: `#/goal/${g.id}`, 'aria-label': `${g.title}を編集` },
    h('div', { class: 'info' },
      g.pinned ? h('span', { class: 'tag' }, 'ホーム上部に表示中') : null,
      h('span', { class: 'title' }, `${g.title} ${t.target}${t.suffix}`),
      h('span', { class: 'sub' }, `${how} · ${t.bestLabel} ${t.best}${t.bestDate ? `(${t.bestDate})` : ''} · あと ${t.remain}`)),
    h('div', { class: 'right' },
      h('span', { class: 'k' }, '期限まで'),
      h('span', { class: 'num' }, t.days)));
}
