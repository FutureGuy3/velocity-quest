// ホーム:目標の常時表示、今日の体重、記録中のトレーニング、ルーティン一覧と開始
import { h, icon, mount, toast, formatDateJa, formatDateShort } from '../dom.js';
import {
  localDate, IS_PREVIEW,
  getPinnedGoals, getGoalBest,
  getBodyweightOn, getLatestBodyweight, saveBodyweight,
  listRoutines, getRoutineLastDates,
  getActiveWorkout, startWorkout, deleteWorkout,
} from '../../db/repo.js';
import { goalTexts } from '../goalFormat.js';
import { navigate } from '../../router.js';
import { startPool } from './pool.js';
import { getActivePoolSession } from '../../db/repo.js';
import { actionSheet } from '../components/overlay.js';
import { PRESETS } from '../../domain/presets.js';
import { createRoutineFromPreset } from '../../db/repo.js';

/** 水泳選手向けのプリセットから、ルーティンを作って編集画面を開く */
export function choosePreset() {
  actionSheet({
    title: 'プリセットからルーティンを作ります(作ったあと自由に直せます)',
    actions: PRESETS.map((p) => ({
      label: `${p.name}:${p.note}`,
      onSelect: async () => {
        const r = await createRoutineFromPreset(p);
        toast(`「${p.name}」を作りました`);
        navigate(`/routine/${r.id}`);
      },
    })),
  });
}

export async function renderHome() {
  const today = localDate();
  const [goals, active, routines, lastDates, todayBw, latestBw, activePool] = await Promise.all([
    getPinnedGoals(), getActiveWorkout(), listRoutines(), getRoutineLastDates(),
    getBodyweightOn(today), getLatestBodyweight(), getActivePoolSession(),
  ]);
  const bests = await Promise.all(goals.map((g) => getGoalBest(g)));

  mount(h('div', {},
    h('header', { class: 'topbar' },
      h('div', { class: 'topbar-title' },
        h('span', { class: 'brand' }, 'VELOCITY QUEST', IS_PREVIEW ? h('span', { class: 'badge-test' }, 'テスト版') : null),
        h('span', { class: 'topbar-sub' }, formatDateJa(today))),
      h('button', { class: 'icon-btn', 'aria-label': '設定', onclick: () => navigate('/settings') }, icon('settings'))),

    goals.length ? goalCarousel(goals, bests, today) : goalEmpty(),
    bodyweightCard(today, todayBw, latestBw),
    active ? activeCard(active) : null,
    activePool ? h('section', { class: 'active-card', 'aria-label': '記録中のプール練習' },
      h('div', {},
        h('p', { class: 'label', style: { color: '#4DA3FF', fontWeight: 700 } }, '記録中のプール練習'),
        h('p', { style: { fontSize: '15px', fontWeight: 700 } }, formatDateJa(activePool.date))),
      h('div', { class: 'row' }, h('button', { class: 'btn btn-primary', onclick: () => navigate(`/pool/${activePool.id}`) }, '再開'))) : null,

    h('div', { class: 'section-head' },
      h('h2', {}, 'ルーティン'),
      h('div', { style: { display: 'flex', gap: '16px' } },
        h('button', { class: 'link-btn', type: 'button', onclick: choosePreset }, 'プリセット'),
        h('a', { href: '#/routine/new' }, '+ 新規作成'))),
    h('div', { class: 'stack' },
      routines.length
        ? routines.map((r) => routineRow(r, lastDates.get(r.id), active))
        : h('p', { class: 'empty', style: { padding: '8px 4px' } }, 'ルーティンはまだありません。「+ 新規作成」から作れます。'),
      h('button', { class: 'btn btn-dashed btn-block', onclick: () => start(null, active) }, 'ルーティンなしで開始')),
    h('div', { class: 'section-head' }, h('h2', {}, 'プール')),
    h('div', { class: 'stack' },
      h('button', { class: 'btn btn-ghost btn-block pool-start', onclick: startPool }, activePool ? 'プール練習を再開' : 'プール練習を始める(タイム入力)')),

    h('p', { class: 'version-note' }, `版 ${self.VQ_VERSION}`),
  ), { showNav: true, navKey: 'home' });
}

/* ---------- 目標 ---------- */

const GOAL_INDEX_KEY = 'vq.home.goalIndex';

/** 上部に表示する目標を横に並べ、左右のスワイプで切り替える */
function goalCarousel(goals, bests, today) {
  const track = h('div', { class: 'goal-track', role: 'group', 'aria-label': '目標(左右にスワイプで切り替え)' },
    goals.map((g, i) => h('div', { class: 'goal-slide', 'aria-roledescription': 'スライド', 'aria-label': `${i + 1} / ${goals.length}` },
      goalCard(g, bests[i], today))));
  if (goals.length === 1) return h('div', { class: 'goal-carousel' }, track);

  const dots = goals.map(() => h('span', { class: 'goal-dot' }, h('span', {})));
  const setActive = (i) => dots.forEach((d, j) => d.setAttribute('aria-current', String(i === j)));

  let raf = 0;
  track.addEventListener('scroll', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      setActive(i);
      try { sessionStorage.setItem(GOAL_INDEX_KEY, String(i)); } catch { /* 何もしない */ }
    });
  }, { passive: true });

  // 前に見ていた目標を表示する
  let start = 0;
  try { start = Math.min(goals.length - 1, Number(sessionStorage.getItem(GOAL_INDEX_KEY)) || 0); } catch { /* 何もしない */ }
  setActive(start);
  requestAnimationFrame(() => { track.scrollLeft = start * track.clientWidth; });

  return h('div', { class: 'goal-carousel' }, track, h('div', { class: 'goal-dots', 'aria-hidden': 'true' }, dots));
}

function goalCard(goal, best, today) {
  const t = goalTexts(goal, best, today);
  return h('a', { class: 'goal-card', href: '#/metrics', 'aria-label': '目標の一覧へ' },
    h('div', { class: 'goal-head' },
      h('span', { class: 'goal-title' }, `目標|${goal.title || ''}`),
      h('span', { role: 'img', 'aria-label': '上部に固定中' }, icon('pin', 16, 2.2))),
    h('div', { class: 'goal-target' },
      h('span', { class: 'num' }, t.target),
      h('span', { class: 'suffix' }, t.suffix)),
    h('div', { class: 'goal-stats' },
      h('div', {},
        h('span', { class: 'k' }, t.bestLabel),
        h('span', { class: 'v' }, t.best),
        t.bestDate ? h('span', { class: 'd' }, t.bestDate) : null),
      h('div', {}, h('span', { class: 'k' }, 'あと'), h('span', { class: 'v' }, t.remain)),
      h('div', {}, h('span', { class: 'k' }, '期限まで'), h('span', { class: 'v' }, t.days))));
}

function goalEmpty() {
  return h('div', { class: 'goal-empty' },
    h('span', {}, '目標を作ると、ここに常に表示されます'),
    h('a', { class: 'btn btn-ghost', href: '#/goal/new' }, '目標を作る'));
}

/* ---------- 体重 ---------- */

/**
 * 今日の体重。初めてのときはキーボードで入れる。
 * 一度でも記録があれば、前回の値から −0.1/+0.1 のボタンで調整して記録する(数字を押すとキーボードでも入れられる)
 */
function bodyweightCard(today, todayBw, latestBw, { keyboard = false } = {}) {
  const prev = todayBw ? null : latestBw; // 今日の記録がなければ直近の記録を「前回」として出す
  const base = todayBw || latestBw;
  const head = h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '-10px', marginBottom: '-8px' } },
    h('label', { for: 'bw', class: 'label' }, '今日の体重'),
    h('a', { class: 'bw-link', href: '#/bodyweight' }, '推移・一覧'));
  const note = h('span', { id: 'bw-note', class: 'label' },
    todayBw ? '今日は記録済み' : prev ? `前回 ${prev.kg.toFixed(1)}(${formatDateShort(prev.date)})` : '');

  async function save(kg) {
    if (!Number.isFinite(kg) || kg < 20 || kg > 300) { toast('体重は 20〜300 の数字で入れてください'); return false; }
    await saveBodyweight(today, Math.round(kg * 10) / 10);
    toast(`${kg.toFixed(1)}kg を記録しました`);
    renderHome();
    return true;
  }

  /* ---- 初めて、または数字を押したとき:キーボード ---- */
  if (!base || keyboard) {
    const input = h('input', {
      id: 'bw', class: 'big-input', inputmode: 'decimal', autocomplete: 'off', enterkeyhint: 'done',
      value: base ? base.kg.toFixed(1) : '', placeholder: '00.0', 'aria-describedby': 'bw-note',
    });
    if (keyboard) setTimeout(() => { input.focus(); input.select(); }, 50);
    return h('form', {
      class: 'bw-card', 'aria-label': '今日の体重',
      onsubmit: async (e) => {
        e.preventDefault();
        const raw = input.value.trim().replace(',', '.');
        if (!(await save(raw ? Number(raw) : NaN))) input.focus();
      },
    },
    h('div', { class: 'bw-main' }, head,
      h('div', { class: 'bw-row' }, input, h('span', { class: 'muted' }, 'kg'), note)),
    h('button', { class: 'btn btn-light', type: 'submit' }, todayBw ? '更新' : '記録'));
  }

  /* ---- 2回目から:前回の値を −0.1/+0.1 で調整 ---- */
  let v = Math.round(base.kg * 10) / 10;
  const num = h('button', {
    id: 'bw', type: 'button', class: 'bw-value num', 'aria-label': `体重 ${v.toFixed(1)}kg(押すとキーボードで入れられます)`,
    onclick: (e) => e.currentTarget.closest('.bw-card').replaceWith(bodyweightCard(today, todayBw, latestBw, { keyboard: true })),
  }, v.toFixed(1));
  const stepBtn = (d) => h('button', {
    type: 'button', class: 'bw-step', 'aria-label': `${d > 0 ? '0.1増やす' : '0.1減らす'}`,
    onclick: () => { v = Math.round((v + d) * 10) / 10; num.textContent = v.toFixed(1); num.setAttribute('aria-label', `体重 ${v.toFixed(1)}kg(押すとキーボードで入れられます)`); },
  }, d > 0 ? '+0.1' : '−0.1');
  return h('section', { class: 'bw-card', 'aria-label': '今日の体重' },
    h('div', { class: 'bw-main' }, head,
      h('div', { class: 'bw-adjust' }, stepBtn(-0.1), h('span', { class: 'bw-num' }, num, h('span', { class: 'muted' }, 'kg')), stepBtn(0.1)),
      note),
    h('button', { class: 'btn btn-light', type: 'button', onclick: () => save(v) }, todayBw ? '更新' : '記録'));
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
