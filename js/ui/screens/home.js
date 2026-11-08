// ホーム:目標の常時表示、今日の体重、記録中のトレーニング、ルーティン一覧と開始
import { h, icon, mount, toast, formatDateJa, formatDateShort } from '../dom.js';
import {
  localDate, IS_PREVIEW,
  getPinnedGoal, getGoalBest,
  getBodyweightOn, getLatestBodyweight, saveBodyweight,
  listRoutines, getRoutineLastDates,
  getActiveWorkout, startWorkout, deleteWorkout,
} from '../../db/repo.js';
import { goalProgress, fmt } from '../../domain/calc.js';
import { navigate } from '../../router.js';

export async function renderHome() {
  const today = localDate();
  const [goal, active, routines, lastDates, todayBw, latestBw] = await Promise.all([
    getPinnedGoal(), getActiveWorkout(), listRoutines(), getRoutineLastDates(),
    getBodyweightOn(today), getLatestBodyweight(),
  ]);
  const goalBest = goal ? await getGoalBest(goal) : null;

  mount(h('div', {},
    h('header', { class: 'topbar' },
      h('div', { class: 'topbar-title' },
        h('span', { class: 'brand' }, 'VELOCITY QUEST', IS_PREVIEW ? h('span', { class: 'badge-test' }, 'テスト版') : null),
        h('span', { class: 'topbar-sub' }, formatDateJa(today))),
      h('button', { class: 'icon-btn', 'aria-label': '設定', onclick: () => navigate('/settings') }, icon('settings'))),

    goal ? goalCard(goal, goalBest, today) : goalEmpty(),
    bodyweightCard(today, todayBw, latestBw),
    active ? activeCard(active) : null,

    h('div', { class: 'section-head' },
      h('h2', {}, 'ルーティン'),
      h('a', { href: '#/routine/new' }, '+ 新規作成')),
    h('div', { class: 'stack' },
      routines.length
        ? routines.map((r) => routineRow(r, lastDates.get(r.id), active))
        : h('p', { class: 'empty', style: { padding: '8px 4px' } }, 'ルーティンはまだありません。「+ 新規作成」から作れます。'),
      h('button', { class: 'btn btn-dashed btn-block', onclick: () => start(null, active) }, 'ルーティンなしで開始')),

    h('p', { class: 'version-note' }, `版 ${self.VQ_VERSION}`),
  ), { showNav: true, navKey: 'home' });
}

/* ---------- 目標 ---------- */

const UNIT_DIGITS = { '秒': 2, 'm': 2, 'cm': 1, 'kg': 1 };

function fmtGoalValue(v, unit) {
  if (v == null) return '—';
  const d = UNIT_DIGITS[unit];
  return d != null ? Number(v).toFixed(d) : fmt(v, 2);
}

function goalCard(goal, best, today) {
  const p = goalProgress(goal, best, today);
  const unit = goal.unit || '';
  const lower = goal.direction === 'lower';
  const bestLabel = best?.source === 'latest' ? '現在' : 'ベスト';

  let remain = '—';
  if (p.achieved) remain = '達成';
  else if (p.remaining != null) remain = fmtGoalValue(p.remaining, unit) + unit;

  let days = '—';
  if (p.daysLeft != null) days = p.daysLeft >= 0 ? `${p.daysLeft}日` : '期限切れ';

  return h('a', { class: 'goal-card', href: '#/metrics', 'aria-label': '目標の詳細へ' },
    h('div', { class: 'goal-head' },
      h('span', { class: 'goal-title' }, `目標|${goal.title || ''}`),
      h('span', { role: 'img', 'aria-label': '上部に固定中' }, icon('pin', 16, 2.2))),
    h('div', { class: 'goal-target' },
      h('span', { class: 'num' }, fmtGoalValue(goal.target, unit)),
      h('span', { class: 'suffix' }, lower ? `${unit}切り` : `${unit}`)),
    h('div', { class: 'goal-bar', role: 'progressbar', 'aria-label': '目標までの進み具合',
      'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': p.progress == null ? 0 : Math.round(p.progress * 100) },
    h('div', { style: { width: `${p.progress == null ? 0 : Math.round(p.progress * 100)}%` } })),
    h('div', { class: 'goal-stats' },
      h('div', {},
        h('span', { class: 'k' }, bestLabel),
        h('span', { class: 'v' }, best ? fmtGoalValue(best.value, unit) : '記録なし'),
        best?.date ? h('span', { class: 'd' }, formatDateShort(best.date)) : null),
      h('div', {}, h('span', { class: 'k' }, 'あと'), h('span', { class: 'v' }, remain)),
      h('div', {}, h('span', { class: 'k' }, '期限まで'), h('span', { class: 'v' }, days))));
}

function goalEmpty() {
  return h('div', { class: 'goal-empty' },
    h('span', {}, '目標を作ると、ここに常に表示されます'),
    h('a', { class: 'btn btn-ghost', href: '#/goal/new' }, '目標を作る'));
}

/* ---------- 体重 ---------- */

function bodyweightCard(today, todayBw, latestBw) {
  const prev = todayBw ? null : latestBw; // 今日の記録がなければ直近の記録を「前回」として出す
  const input = h('input', {
    id: 'bw', class: 'big-input', inputmode: 'decimal', autocomplete: 'off', enterkeyhint: 'done',
    value: todayBw ? todayBw.kg.toFixed(1) : '', placeholder: prev ? prev.kg.toFixed(1) : '00.0',
    'aria-describedby': 'bw-note',
  });
  const btn = h('button', { class: 'btn btn-light', type: 'submit' }, todayBw ? '更新' : '記録');

  async function onSubmit(e) {
    e.preventDefault();
    const raw = input.value.trim().replace(',', '.');
    const kg = Number(raw);
    if (!raw || !Number.isFinite(kg) || kg < 20 || kg > 300) {
      toast('体重は 20〜300 の数字で入れてください');
      input.focus();
      return;
    }
    await saveBodyweight(today, Math.round(kg * 10) / 10);
    input.blur();
    toast(`${kg.toFixed(1)}kg を記録しました`);
    renderHome();
  }

  return h('form', { class: 'bw-card', 'aria-label': '今日の体重', onsubmit: onSubmit },
    h('div', { class: 'bw-main' },
      h('label', { for: 'bw', class: 'label' }, '今日の体重'),
      h('div', { class: 'bw-row' },
        input,
        h('span', { class: 'muted' }, 'kg'),
        h('span', { id: 'bw-note', class: 'label', style: { marginLeft: '6px' } },
          todayBw ? '今日は記録済み' : prev ? `前回 ${prev.kg.toFixed(1)}(${formatDateShort(prev.date)})` : ''))),
    btn);
}

/* ---------- 記録中のトレーニング ---------- */

function activeCard(w) {
  const t = new Date(w.startedAt);
  const hhmm = `${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`;
  const dateNote = w.date === localDate() ? '' : `${formatDateShort(w.date)} `;
  return h('section', { class: 'active-card', 'aria-label': '記録中のトレーニング' },
    h('div', {},
      h('p', { class: 'label', style: { color: 'var(--accent)', fontWeight: 700 } }, '記録中'),
      h('p', { style: { fontSize: '15px', fontWeight: 700 } }, w.title || 'トレーニング'),
      h('p', { class: 'label' }, `${dateNote}${hhmm} 開始 · ${w.items.length}種目`)),
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-primary', onclick: () => navigate(`/workout/${w.id}`) }, '再開'),
      h('button', { class: 'btn btn-ghost', onclick: () => discard(w) }, '破棄')));
}

async function discard(w) {
  if (!confirm('記録中のトレーニングを破棄しますか?入力したセットも消えます。')) return;
  await deleteWorkout(w.id);
  toast('破棄しました');
  renderHome();
}

/* ---------- ルーティン ---------- */

function routineRow(r, lastDate, active) {
  const meta = `${r.items.length}種目 · ${lastDate ? `前回 ${formatDateShort(lastDate)}` : '未実施'}`;
  return h('div', { class: 'routine-row' },
    h('a', { class: 'info', href: `#/routine/${r.id}`, 'aria-label': `${r.name}を編集` },
      h('span', { class: 'name' }, r.name),
      h('span', { class: 'meta' }, meta)),
    h('button', { class: 'play-btn', 'aria-label': `${r.name}を開始`, onclick: () => start(r.id, active) }, icon('play')));
}

async function start(routineId, active) {
  if (active) {
    if (confirm('記録中のトレーニングがあります。そちらを開きますか?')) navigate(`/workout/${active.id}`);
    return;
  }
  const w = await startWorkout({ routineId });
  navigate(`/workout/${w.id}`);
}
