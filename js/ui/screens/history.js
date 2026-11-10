// 履歴:日付ごとの一覧と、練習の詳細
import { h, icon, mount, toast, faceIcon, formatDateJa, FACE_COLORS } from '../dom.js';
import {
  listWorkouts, getWorkout, listSets, getExerciseMap, getWorkoutTrial, deleteWorkout,
} from '../../db/repo.js';
import { trialStats, fmt } from '../../domain/calc.js';
import { FACES } from '../../domain/recordTypes.js';
import { formatSet } from '../setFormat.js';
import { navigate, back } from '../../router.js';

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

function minutesBetween(a, b) {
  if (!a || !b) return null;
  return Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000));
}
function hhmm(iso) {
  const d = new Date(iso);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export async function renderHistory() {
  const workouts = await listWorkouts();
  const counts = await Promise.all(workouts.map(async (w) => {
    const sets = await listSets(w.id);
    return { sets: sets.filter((x) => x.done && !x.warmup).length };
  }));

  const groups = [];
  workouts.forEach((w, i) => {
    const [y, m] = w.date.split('-');
    const key = `${y}年${Number(m)}月`;
    if (!groups.length || groups[groups.length - 1].key !== key) groups.push({ key, rows: [] });
    groups[groups.length - 1].rows.push([w, counts[i]]);
  });

  mount(h('div', {},
    h('header', { class: 'topbar' }, h('div', { class: 'topbar-title' }, h('h1', { class: 'topbar-h' }, '履歴'))),
    workouts.length ? groups.map((g) => [
      h('h2', { class: 'month-head' }, g.key),
      h('div', { class: 'stack' }, g.rows.map(([w, c]) => {
        const [y, m, d] = w.date.split('-').map(Number);
        const wd = WEEK[new Date(y, m - 1, d).getDay()];
        const mins = minutesBetween(w.startedAt, w.endedAt);
        return h('a', { class: 'hist-row', href: `#/history/${w.id}` },
          h('div', { class: 'hist-date' }, h('span', { class: 'd' }, String(d)), h('span', { class: 'w' }, `${m}月 ${wd}`)),
          h('div', { class: 'info' },
            h('span', { class: 'name' }, w.title || 'トレーニング'),
            h('span', { class: 'meta' }, [`${w.items.length}種目`, `${c.sets}セット`, mins != null ? `${mins}分` : null].filter(Boolean).join(' · '))),
          h('span', { style: { color: 'var(--faint)', display: 'inline-flex', flexShrink: '0' } }, icon('forward', 18)));
      })),
    ]) : h('p', { class: 'empty' }, 'まだ記録がありません。トレーニングを終了すると、ここに日付ごとに並びます。'),
  ), { showNav: true, navKey: 'history' });
}

export async function renderHistoryDetail({ params }) {
  const w = await getWorkout(params.id);
  if (!w) { toast('練習が見つかりません'); navigate('/history', { replace: true }); return; }
  const exMap = await getExerciseMap();
  const sets = (await listSets(w.id)).filter((x) => x.done || w.status === 'active');
  const mins = minutesBetween(w.startedAt, w.endedAt);
  const workCount = sets.filter((x) => !x.warmup).length;

  const blocks = [];
  for (const it of w.items) {
    const ex = exMap.get(it.exerciseId);
    if (!ex) continue;
    if (ex.recordType === 'trials') {
      const t = await getWorkoutTrial(w.id, it.key);
      if (!t || !t.attempts.length) continue;
      const st = trialStats(t.attempts);
      const unit = ex.unit || '';
      blocks.push(h('div', { class: 'card detail-ex' },
        h('h3', {}, ex.name),
        h('p', { class: 'val num', style: { fontSize: '16px' } }, t.attempts.map((a) => (a.foul ? 'F' : fmt(a.value, 2))).join(' / ')),
        h('p', { class: 'hint' }, `最高 ${fmt(st.best, 2)}${unit} · 平均 ${fmt(st.average, 2)}${unit}(有効${st.validCount}本)`)));
      continue;
    }
    const mine = sets.filter((x) => x.itemKey === it.key);
    if (!mine.length) continue;
    let n = 0;
    blocks.push(h('div', { class: 'card detail-ex' },
      h('h3', {}, ex.name, it.pap ? h('span', { class: 'tag-mini accent' }, 'PAP') : null),
      mine.map((s) => {
        const lbl = s.warmup ? 'W' : String(++n);
        return h('div', { class: 'detail-set' },
          h('span', { class: `lbl${s.warmup ? ' w' : ''}` }, lbl),
          h('span', { class: 'val' }, formatSet(ex.recordType, s) || '—'),
          s.face ? h('span', { class: 'face', role: 'img', 'aria-label': `感触:${FACES[s.face - 1]}`, style: { '--fc': FACE_COLORS[s.face - 1] } }, faceIcon(s.face, 22)) : h('span', {}),
          s.memo ? h('span', { class: 'memo' }, s.memo) : null);
      })));
  }

  async function onDelete() {
    if (!confirm('この練習を削除しますか?')) return;
    await deleteWorkout(w.id);
    toast('削除しました');
    navigate('/history', { replace: true });
  }

  mount(h('div', {},
    h('header', { class: 'topbar' },
      h('button', { class: 'icon-btn', 'aria-label': '戻る', onclick: () => back('/history') }, icon('back')),
      h('div', { class: 'topbar-title' },
        h('span', { class: 'topbar-h' }, w.title || 'トレーニング'),
        h('span', { class: 'topbar-sub' }, formatDateJa(w.date))),
      h('button', { class: 'btn btn-ghost', onclick: () => navigate(`/workout/${w.id}`) }, '編集')),
    h('div', { class: 'stack' },
      h('div', { class: 'card detail-stats' },
        h('div', {}, h('span', { class: 'k' }, '時間'), h('span', { class: 'num' }, w.endedAt ? `${hhmm(w.startedAt)}–${hhmm(w.endedAt)}` : hhmm(w.startedAt)),
          mins != null ? h('span', { class: 'k' }, `${mins}分`) : null),
        h('div', {}, h('span', { class: 'k' }, '本番セット'), h('span', { class: 'num' }, String(workCount))),
        h('div', {}, h('span', { class: 'k' }, '体重'), h('span', { class: 'num' }, w.bodyweight != null ? `${Number(w.bodyweight).toFixed(1)}kg` : '—'))),
      w.memo ? h('div', { class: 'card' }, h('p', { class: 'label' }, 'メモ'), h('p', {}, w.memo)) : null,
      blocks.length ? blocks : h('p', { class: 'empty' }, '完了したセットはありません。'),
      h('button', { class: 'btn btn-danger btn-block', onclick: onDelete }, 'この練習を削除')),
  ), { showNav: false });
}
