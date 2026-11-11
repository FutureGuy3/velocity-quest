// 履歴:日付ごとの一覧と、練習の詳細
import { h, icon, mount, toast, faceIcon, formatDateJa, formatDateShort, FACE_COLORS } from '../dom.js';
import {
  listHistory, listSwimTimes, getWorkout, listSets, getExerciseMap, getWorkoutTrial, deleteWorkout, createRoutineFromWorkout,
} from '../../db/repo.js';
import { trialStats, fmt, workoutTotals } from '../../domain/calc.js';
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
  const rows = await listHistory();
  const exMap = await getExerciseMap();
  const recordTypeOf = (id) => exMap.get(id)?.recordType;
  const metas = await Promise.all(rows.map(async (r) => {
    if (r.kind === 'gym') {
      const t = workoutTotals(await listSets(r.item.id), recordTypeOf, r.item.bodyweight);
      const mins = r.item.backfill ? null : minutesBetween(r.item.startedAt, r.item.endedAt);
      return [`${fmt(t.volume, 0)}kg`, `${t.exercises}種目`, `${t.sets}セット`, `${t.reps}回`, mins != null ? `${mins}分` : null].filter(Boolean).join(' · ');
    }
    const times = await listSwimTimes(r.item.id);
    const series = new Set(times.map((t) => t.seriesId));
    return `${times.length}本 · ${series.size}系統`;
  }));

  const groups = [];
  rows.forEach((r, i) => {
    const [y, m] = r.date.split('-');
    const key = `${y}年${Number(m)}月`;
    if (!groups.length || groups[groups.length - 1].key !== key) groups.push({ key, rows: [] });
    groups[groups.length - 1].rows.push([r, metas[i]]);
  });

  mount(h('div', {},
    h('header', { class: 'topbar' }, h('div', { class: 'topbar-title' }, h('h1', { class: 'topbar-h' }, '履歴'))),
    rows.length ? groups.map((g) => [
      h('h2', { class: 'month-head' }, g.key),
      h('div', { class: 'stack' }, g.rows.map(([r, meta]) => {
        const [y, m, d] = r.date.split('-').map(Number);
        const wd = WEEK[new Date(y, m - 1, d).getDay()];
        const gym = r.kind === 'gym';
        return h('a', { class: 'hist-row', href: gym ? `#/history/${r.item.id}` : `#/pool/${r.item.id}` },
          h('div', { class: 'hist-date' }, h('span', { class: 'd' }, String(d)), h('span', { class: 'w' }, `${m}月 ${wd}`)),
          h('div', { class: 'info' },
            h('span', { class: 'name' }, h('span', { class: `kind ${r.kind}` }, gym ? 'ジム' : 'スイム'), gym ? (r.item.title || 'ジム') : 'スイム記録'),
            h('span', { class: 'meta' }, meta)),
          h('span', { style: { color: 'var(--faint)', display: 'inline-flex', flexShrink: '0' } }, icon('forward', 18)));
      })),
    ]) : h('p', { class: 'empty' }, 'まだ記録がありません。ジムやスイムの記録を終えると、ここに日付ごとに並びます。'),
  ), { showNav: true, navKey: 'history' });
}

export async function renderHistoryDetail({ params }) {
  const w = await getWorkout(params.id);
  if (!w) { toast('練習が見つかりません'); navigate('/history', { replace: true }); return; }
  const exMap = await getExerciseMap();
  const sets = (await listSets(w.id)).filter((x) => x.done || w.status === 'active');
  const mins = w.backfill ? null : minutesBetween(w.startedAt, w.endedAt);
  const totals = workoutTotals(sets, (id) => exMap.get(id)?.recordType, w.bodyweight);

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
          s.face ? h('span', { class: 'face', role: 'img', 'aria-label': `感触:${FACES[s.face - 1]}`, style: { '--fc': FACE_COLORS[s.face - 1] } }, faceIcon(s.face, 22)) : h('span', {}));
      }),
      it.memo ? h('p', { class: 'detail-memo' }, it.memo) : null));
  }

  /** この練習の種目・セット(重さ・回数・休憩)を、新しいルーティンとして保存する */
  async function saveAsRoutine() {
    const name = prompt('ルーティンの名前', w.title && w.title !== 'フリー' ? `${w.title}(${formatDateShort(w.date)})` : `${formatDateShort(w.date)} の練習`);
    if (!name || !name.trim()) return;
    const r = await createRoutineFromWorkout(w.id, name.trim());
    toast(`ルーティン「${r.name}」を作りました`);
    navigate(`/routine/${r.id}`);
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
        h('div', {}, h('span', { class: 'k' }, '総挙上重量'), h('span', { class: 'num' }, `${fmt(totals.volume, 0)}kg`)),
        h('div', {}, h('span', { class: 'k' }, '総種目数'), h('span', { class: 'num' }, String(totals.exercises))),
        h('div', {}, h('span', { class: 'k' }, '総セット数'), h('span', { class: 'num' }, String(totals.sets))),
        h('div', {}, h('span', { class: 'k' }, '総レップ数'), h('span', { class: 'num' }, String(totals.reps))),
        h('div', {}, h('span', { class: 'k' }, '時間'), h('span', { class: 'num' }, mins != null ? `${mins}分` : '—'),
          !w.backfill && w.endedAt ? h('span', { class: 'k' }, `${hhmm(w.startedAt)}–${hhmm(w.endedAt)}`) : null),
        h('div', {}, h('span', { class: 'k' }, '体重'), h('span', { class: 'num' }, w.bodyweight != null ? `${Number(w.bodyweight).toFixed(1)}kg` : '—'))),
      h('p', { class: 'hint', style: { padding: '0 4px' } }, '総挙上重量は、本番のセットの「重さ×回数」の合計(片側は左右を足す。自重+加重は体重+加重)。'),
      w.memo ? h('div', { class: 'card' }, h('p', { class: 'label' }, 'メモ'), h('p', {}, w.memo)) : null,
      blocks.length ? blocks : h('p', { class: 'empty' }, '完了したセットはありません。'),
      h('button', { class: 'btn btn-ghost btn-block', onclick: saveAsRoutine }, 'この練習をルーティンとして保存'),
      h('button', { class: 'btn btn-danger btn-block', onclick: onDelete }, 'この練習を削除')),
  ), { showNav: false });
}
