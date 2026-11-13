// データ層。画面のコードはこのファイルの関数だけを使って読み書きする。
// 段階3ではここ(特に put / remove)に同期の処理を足す。
import { openDb, SYNC_TABLES, IS_PREVIEW, migrateItem, migrateGoal } from './schema.js';
import { setEstimate1RM, trialStats, betterBest, bestSet, goalProgress } from '../domain/calc.js';
import { DEFAULT_REST_SEC } from '../domain/recordTypes.js';
import {
  normalizeConditions, seriesKey, seriesAutoName, SERIES_COLORS, sessionValue, cutoffInfo, DEFAULT_CONDITIONS, matchesSwimGoal,
} from '../domain/swim.js';

export { IS_PREVIEW };

export const OWNER_LOCAL = 'local';
const SETTINGS_ID = 'user';

let db = null;
let deviceId = null;

export const DEFAULT_SETTINGS = Object.freeze({
  accent: '#FF6A1A',
  trackedExercises: [], // 指標で推移を見る種目の id
});

/* ===================== 起動 ===================== */

export async function initRepo() {
  db = openDb();
  // 保存場所の形を新しくするとき、ほかのタブやホーム画面から開いたアプリで古い版が開いていると待たされる。
  // そのことを起動の見張りに知らせる(blocked が来ないブラウザもあるので、時間でも知らせる)
  const WAIT_MSG = '記録の保存場所の作り替えが、ほかで開いている古い版に止められています。'
    + 'このアプリの Brave のタブと、ホーム画面から開いたアプリをすべて閉じて(最近使ったアプリの一覧で上にスワイプ)、開き直してください';
  db.on('blocked', () => { window.__vqStage = WAIT_MSG; });
  const slow = setTimeout(() => { window.__vqStage = WAIT_MSG; }, 5000);
  // 新しい版が作り替えを始めたら、この版は保存場所を手放して読み込み直す(新しい版を止めないように)
  db.on('versionchange', () => {
    db.close();
    setTimeout(() => location.reload(), 300);
    return false;
  });
  try { await db.open(); } finally { clearTimeout(slow); }
  deviceId = await getMeta('deviceId');
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    await setMeta('deviceId', deviceId);
  }
  // 端末の空き容量で消されにくくする(対応端末のみ)
  // 返ってこないブラウザがあるので、待たずに先へ進む
  try { navigator.storage?.persist?.()?.catch?.(() => {}); } catch { /* 何もしない */ }
  return { deviceId };
}

export function getDeviceId() { return deviceId; }

export async function getMeta(key) {
  const row = await db.meta.get(key);
  return row ? row.value : undefined;
}
export async function setMeta(key, value) {
  await db.meta.put({ key, value });
}

/* ===================== 共通 ===================== */

export function nowIso() { return new Date().toISOString(); }

export function newId() { return crypto.randomUUID(); }

/** 端末の現地時間での日付 YYYY-MM-DD */
export function localDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 新しいレコードに共通項目を付ける(既にある値は残す) */
function stamp(obj, { touch = true } = {}) {
  const t = nowIso();
  return {
    ...obj,
    id: obj.id || newId(),
    createdAt: obj.createdAt || t,
    updatedAt: touch ? t : (obj.updatedAt || t),
    deleted: obj.deleted === true,
    deviceId: touch ? deviceId : (obj.deviceId || deviceId),
    ownerId: obj.ownerId || OWNER_LOCAL,
  };
}

/** すべての保存はここを通す */
async function put(table, obj) {
  const rec = stamp(obj);
  await db[table].put(rec);
  return rec;
}

/** 論理削除。レコードは消さずに deleted: true にする */
async function remove(table, id) {
  const rec = await db[table].get(id);
  if (!rec) return null;
  return put(table, { ...rec, deleted: true });
}

const alive = (r) => r && !r.deleted;

async function getAlive(table, id) {
  const r = await db[table].get(id);
  return alive(r) ? r : null;
}

/* ===================== 種目 ===================== */

/** filter: { bodyPart, equipment, q, includeHidden } */
export async function listExercises(filter = {}) {
  const { bodyPart, equipment, q, swim, favorite, includeHidden = false } = filter;
  let rows = await db.exercises.toArray();
  rows = rows.filter(alive);
  if (!includeHidden) rows = rows.filter((r) => !r.hidden);
  if (bodyPart) rows = rows.filter((r) => r.bodyPart === bodyPart);
  if (equipment) rows = rows.filter((r) => r.equipment === equipment);
  if (swim) rows = rows.filter((r) => (r.swim || []).includes(swim));
  if (favorite) rows = rows.filter((r) => r.favorite);
  if (q) {
    const needle = normalize(q);
    rows = rows.filter((r) => normalize(r.name).includes(needle));
  }
  rows.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return rows;
}

function normalize(s) {
  // 全角・半角、ひらがな・カタカナの違いを吸収して検索する
  return String(s).normalize('NFKC').toLowerCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/[\s・\-ー]/g, '');
}

export function getExercise(id) { return getAlive('exercises', id); }

/** 画面表示用に id → 種目 の対応表を返す(非表示の種目も含む。過去の記録を表示するため) */
export async function getExerciseMap() {
  const rows = await db.exercises.toArray();
  return new Map(rows.filter(alive).map((r) => [r.id, r]));
}

export function saveExercise(ex) {
  return put('exercises', { builtin: false, hidden: false, subParts: [], ...ex });
}

/** お気に入りの付け外し */
export async function setExerciseFavorite(id, favorite) {
  const ex = await db.exercises.get(id);
  if (!ex) return null;
  return put('exercises', { ...ex, favorite });
}

export async function setExerciseHidden(id, hidden) {
  const ex = await db.exercises.get(id);
  if (!ex) return null;
  return put('exercises', { ...ex, hidden });
}

/** 自分で登録した種目だけ削除できる。最初から入っている種目は非表示にする */
export async function deleteExercise(id) {
  const ex = await db.exercises.get(id);
  if (!ex) return null;
  if (ex.builtin) return setExerciseHidden(id, true);
  return remove('exercises', id);
}

/* ===================== 器具(バーの重さ) ===================== */

export async function listGear() {
  return (await db.gear.toArray()).filter(alive).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}
export function getGear(id) { return getAlive('gear', id); }
export function saveGear(g) { return put('gear', g); }
export function deleteGear(id) { return remove('gear', id); }

/* ===================== ルーティン ===================== */

export async function listRoutines() {
  return (await db.routines.toArray()).filter(alive)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt.localeCompare(b.createdAt));
}
export function getRoutine(id) { return getAlive('routines', id); }
export function saveRoutine(r) { return put('routines', { items: [], ...r }); }
export function deleteRoutine(id) { return remove('routines', id); }

/** ルーティンの並び要素を作る */
export function newRoutineItem(ex) {
  const rest = DEFAULT_REST_SEC;
  const field = ex.recordType === 'time' ? 'seconds' : ex.recordType === 'distance_band' ? 'distance' : 'reps';
  const plan = () => (ex.recordType === 'trials' ? { warmup: false, restSec: rest } : { warmup: false, restSec: rest, [field]: field === 'reps' ? 5 : null });
  return {
    key: newId(), exerciseId: ex.id, restSec: rest, pap: false, link: null,
    setPlans: ex.recordType === 'trials' ? [] : [plan(), plan(), plan()],
  };
}

/** プリセットからルーティンを作る(作ったものは普通のルーティンとして直せる) */
export async function createRoutineFromPreset(preset) {
  const exMap = await getExerciseMap();
  const items = preset.items.filter((p) => exMap.has(p.ex)).map((p) => ({
    key: newId(), exerciseId: p.ex, restSec: DEFAULT_REST_SEC, pap: !!p.pap, link: null, linkNext: p.linkNext || null,
    setPlans: p.sets.map((x) => ({ ...x })),
  }));
  items.forEach((it, i) => {
    if (it.linkNext && items[i + 1]) it.link = { type: it.linkNext, toKey: items[i + 1].key };
    delete it.linkNext;
  });
  const order = (await listRoutines()).length + 1;
  return put('routines', { name: preset.name, items, order, presetId: preset.id });
}

/** 種目のつなぎの種類 */
export const LINK_TYPES = { superset: 'スーパーセット', pap: 'PAP ペア' };

/**
 * 並べ替えなどで隣が変わったつなぎを外す(item.link.toKey が直後の種目でなければ外す)
 * items は配列をそのまま書き換える
 */
export function normalizeLinks(items) {
  items.forEach((it, i) => {
    if (it.link && items[i + 1]?.key !== it.link.toKey) it.link = null;
  });
  return items;
}

/** ルーティンごとの「前回」(そのルーティンから始めて完了した最後の日付) */
export async function getRoutineLastDates() {
  const out = new Map();
  for (const w of await listWorkouts()) {
    if (w.routineId && !out.has(w.routineId)) out.set(w.routineId, w.date);
  }
  return out;
}

/* ===================== 練習(ジム) ===================== */

export async function getActiveWorkout() {
  const rows = await db.workouts.where('status').equals('active').toArray();
  return rows.filter(alive).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] || null;
}

/** セットの値の項目(前回の値を引き継ぐときに使う) */
export const SET_VALUE_FIELDS = ['weight', 'added', 'assist', 'reps', 'seconds', 'heightCm', 'contacts', 'distance', 'band'];

function pickValues(src) {
  const out = {};
  if (!src) return out;
  for (const f of SET_VALUE_FIELDS) if (src[f] != null && src[f] !== '') out[f] = src[f];
  if (src.left) out.left = { ...src.left };
  if (src.right) out.right = { ...src.right };
  return out;
}

/**
 * 新しいセットを作る。plans(セットごとの予定)の値を優先し、予定にない値は前回の同じ順番のセットから引き継ぐ。
 * plans が無いときは count 個、前回の値だけで作る。
 */
async function plannedSets(workout, item, plans, startOrder, count = 1) {
  const lastAll = await getLastSets(item.exerciseId, { excludeWorkoutId: workout.id });
  const lastWork = lastAll.filter((x) => !x.warmup);
  const lastWarm = lastAll.filter((x) => x.warmup);
  const lastMode = lastAll[0]?.sideMode;
  const list = plans && plans.length ? plans : Array.from({ length: count }, () => ({ warmup: false }));
  let wi = 0, ui = 0;
  return list.map((plan, i) => {
    const pool = plan.warmup ? lastWarm : lastWork;
    const idx = plan.warmup ? ui++ : wi++;
    const prev = pool[idx] || pool[pool.length - 1] || null;
    const vals = pickValues(prev);
    for (const f of SET_VALUE_FIELDS) {
      if (plan[f] == null || plan[f] === '') continue;
      vals[f] = plan[f];
      if (vals.left) vals.left[f] = plan[f];
      if (vals.right) vals.right[f] = plan[f];
    }
    return {
      workoutId: workout.id, itemKey: item.key, exerciseId: item.exerciseId, date: workout.date,
      order: startOrder + i, warmup: !!plan.warmup, sideMode: item.sideMode || lastMode || 'both',
      restSec: plan.restSec ?? item.restSec ?? null,
      ...vals, face: null, memo: '', done: false,
    };
  });
}

/**
 * ルーティンから(またはルーティンなしで)開始。ルーティンはコピーして使い、予定のセットを用意する
 * date を渡すと過去の日付で記録する(スマホを忘れた日など。経過時間とタイマーは出さない)
 */
export async function startWorkout({ routineId = null, date = null } = {}) {
  const today = date || localDate();
  const backfill = !!date && date !== localDate();
  let items = [];
  let title = 'フリー';
  let routine = null;
  if (routineId) {
    routine = await getRoutine(routineId);
    if (routine) {
      title = routine.name;
      // つなぎ(link.toKey)は新しい key に付け替える
      const keyMap = new Map(routine.items.map((it) => [it.key, newId()]));
      items = routine.items.map((it) => ({
        ...it, key: keyMap.get(it.key), fromRoutineKey: it.key, sideMode: null,
        link: it.link && keyMap.has(it.link.toKey) ? { ...it.link, toKey: keyMap.get(it.link.toKey) } : null,
      }));
    }
  }
  const bw = await getLatestBodyweight(today);
  const w = await put('workouts', {
    date: today,
    startedAt: nowIso(),
    endedAt: null,
    status: 'active',
    routineId: routine ? routine.id : null,
    title,
    bodyweight: bw ? bw.kg : null,
    memo: '',
    items,
    timer: null,
    backfill,
  });
  const exMap = await getExerciseMap();
  let order = 1;
  for (const it of items) {
    const ex = exMap.get(it.exerciseId);
    if (!ex || ex.recordType === 'trials') continue;
    const last = await getLastSets(it.exerciseId, { excludeWorkoutId: w.id });
    const sideMode = last[0]?.sideMode || 'both';
    it.sideMode = sideMode;
    const sets = await plannedSets(w, { ...it, sideMode }, it.setPlans || [], order, 1);
    order += sets.length;
    for (const st of sets) await put('sets', st);
  }
  return put('workouts', { ...w, items });
}

/** 記録中(または過去)の練習に種目を足す。各種目に1セット用意する */
export async function addWorkoutItems(workoutId, exerciseIds) {
  const w = await getWorkout(workoutId);
  if (!w) return null;
  const exMap = await getExerciseMap();
  const sets = await listSets(workoutId);
  let order = sets.reduce((m, x) => Math.max(m, x.order ?? 0), 0) + 1;
  const items = [...w.items];
  for (const id of exerciseIds) {
    const ex = exMap.get(id);
    if (!ex) continue;
    const last = await getLastSets(id, { excludeWorkoutId: w.id });
    const item = { key: newId(), exerciseId: id, restSec: DEFAULT_REST_SEC, pap: false, link: null, sideMode: last[0]?.sideMode || 'both' };
    items.push(item);
    if (ex.recordType === 'trials') continue;
    for (const st of await plannedSets(w, item, null, order, 1)) { await put('sets', st); order++; }
  }
  return put('workouts', { ...w, items });
}

/** 練習の日付を変える(セットと試技の日付も合わせる) */
export async function setWorkoutDate(workoutId, date) {
  const w = await db.workouts.get(workoutId);
  if (!w) return null;
  for (const x of await listSets(workoutId)) await put('sets', { ...x, date });
  for (const t of (await db.trials.where('workoutId').equals(workoutId).toArray()).filter(alive)) await put('trials', { ...t, date });
  const bw = await getLatestBodyweight(date);
  return put('workouts', { ...w, date, bodyweight: w.bodyweight ?? (bw ? bw.kg : null) });
}

/** その種目の過去のメモ(日付つき、新しい順に limit 件)。今の練習は除く */
export async function getRecentExerciseMemos(exerciseId, { excludeWorkoutId = null, limit = 3 } = {}) {
  const out = [];
  for (const w of await listWorkouts()) {
    if (w.id === excludeWorkoutId) continue;
    for (const it of w.items || []) {
      if (it.exerciseId === exerciseId && it.memo && it.memo.trim()) out.push({ date: w.date, memo: it.memo.trim(), workoutId: w.id });
    }
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}

/** 履歴の練習を、新しいルーティンとして保存する(完了したセットの重さ・回数・休憩を予定にする) */
export async function createRoutineFromWorkout(workoutId, name) {
  const w = await getWorkout(workoutId);
  if (!w) return null;
  const sets = await listSets(workoutId);
  const keyMap = new Map(w.items.map((it) => [it.key, newId()]));
  const items = w.items.map((it) => {
    const mine = sets.filter((x) => x.itemKey === it.key && x.done);
    return {
      key: keyMap.get(it.key), exerciseId: it.exerciseId, restSec: it.restSec ?? DEFAULT_REST_SEC, pap: !!it.pap,
      link: it.link && keyMap.has(it.link.toKey) ? { ...it.link, toKey: keyMap.get(it.link.toKey) } : null,
      setPlans: mine.map((x) => {
        const src = x.sideMode === 'split' ? (x.left || {}) : x;
        const p = { warmup: !!x.warmup, restSec: x.restSec ?? it.restSec ?? DEFAULT_REST_SEC };
        for (const f of SET_VALUE_FIELDS) if (src[f] != null && src[f] !== '') p[f] = src[f];
        return p;
      }),
    };
  });
  const order = (await listRoutines()).length + 1;
  return put('routines', { name, items: normalizeLinks(items), order });
}

/** セットを1つ足す(直前のセットの値を引き継ぐ) */
export async function addSet(workout, item, { warmup = false } = {}) {
  const sets = (await listSets(workout.id));
  const mine = sets.filter((x) => x.itemKey === item.key);
  const prev = mine[mine.length - 1] || null;
  const order = (prev ? prev.order : sets.reduce((m, x) => Math.max(m, x.order ?? 0), 0)) + 0.001;
  return put('sets', {
    workoutId: workout.id, itemKey: item.key, exerciseId: item.exerciseId, date: workout.date,
    order, warmup, sideMode: item.sideMode || 'both', restSec: prev?.restSec ?? item.restSec ?? null,
    ...pickValues(prev), face: null, memo: '', done: false,
  });
}

/**
 * トレーニング中に種目を別の種目に変える(マシンが空いていないときなど)。
 * まだ完了したセットがなければ、その場で入れ替える(セット数・回数・休憩・ウォームアップは残し、重さなどは新しい種目の前回の値)。
 * 完了したセットがあれば、完了した分は元の種目の記録として残し、残りのセットを新しい種目としてすぐ後ろに入れる。
 */
export async function changeWorkoutItemExercise(workout, itemKey, newExerciseId) {
  const w = await getWorkout(workout.id);
  const idx = w.items.findIndex((x) => x.key === itemKey);
  if (idx < 0) return w;
  const old = w.items[idx];
  const exNew = await getExercise(newExerciseId);
  if (!exNew) return w;
  const mine = (await listSets(w.id)).filter((x) => x.itemKey === itemKey);
  const done = mine.filter((x) => x.done);
  const undone = mine.filter((x) => !x.done);
  const plans = undone.map((x) => {
    const p = { warmup: !!x.warmup, restSec: x.restSec ?? old.restSec ?? DEFAULT_REST_SEC };
    if (exNew.recordType !== 'time' && exNew.recordType !== 'distance_band' && x.reps != null) p.reps = x.reps;
    return p;
  });
  for (const x of undone) await remove('sets', x.id);
  const startOrder = undone[0]?.order ?? (mine[mine.length - 1]?.order ?? 0) + 0.001;
  const lastNew = await getLastSets(newExerciseId, { excludeWorkoutId: w.id });
  const items = w.items.slice();
  let item;
  if (!done.length) {
    item = { ...old, exerciseId: newExerciseId, sideMode: lastNew[0]?.sideMode || 'both' };
    items[idx] = item;
  } else {
    item = { key: newId(), exerciseId: newExerciseId, restSec: old.restSec, pap: old.pap, link: old.link || null, sideMode: lastNew[0]?.sideMode || 'both' };
    items[idx] = { ...old, link: null };
    items.splice(idx + 1, 0, item);
  }
  if (exNew.recordType !== 'trials') {
    const sets = await plannedSets(w, item, plans.length ? plans : null, startOrder, 1);
    for (let i = 0; i < sets.length; i++) await put('sets', { ...sets[i], order: startOrder + i * 0.0001 });
  }
  return put('workouts', { ...w, items: normalizeLinks(items) });
}

/** 種目を練習から外す(その種目のセットと試技も論理削除) */
export async function removeWorkoutItem(workout, itemKey) {
  for (const x of (await listSets(workout.id)).filter((x) => x.itemKey === itemKey)) await remove('sets', x.id);
  for (const t of (await db.trials.where('workoutId').equals(workout.id).toArray()).filter((t) => alive(t) && t.itemKey === itemKey)) await remove('trials', t.id);
  return put('workouts', { ...workout, items: workout.items.filter((it) => it.key !== itemKey) });
}

/** 練習の中の試技(種目ごとに1件) */
export async function getWorkoutTrial(workoutId, itemKey) {
  const rows = await db.trials.where('workoutId').equals(workoutId).toArray();
  return rows.find((t) => alive(t) && t.itemKey === itemKey) || null;
}

/**
 * 練習の内容がルーティンと違うか(種目の並び・PAP・休憩・予定)
 */
export async function workoutDiffersFromRoutine(workout) {
  if (!workout.routineId) return false;
  const r = await getRoutine(workout.routineId);
  if (!r) return false;
  const sig = (items) => items.map((it) => `${it.exerciseId}|${!!it.pap}|${it.link?.type || ''}`).join(',');
  const a = sig(r.items);
  const b = sig(workout.items);
  return a !== b;
}

/** 練習の種目の並び・PAP・つなぎをルーティンに反映する(元からある種目のセットごとの予定は残す) */
export async function applyWorkoutToRoutine(workout) {
  const r = await getRoutine(workout.routineId);
  if (!r) return null;
  const byKey = new Map(r.items.map((it) => [it.key, it]));
  const sets = await listSets(workout.id);
  // 練習の key → ルーティンの key
  const keyMap = new Map(workout.items.map((it) => [it.key, it.fromRoutineKey && byKey.has(it.fromRoutineKey) ? it.fromRoutineKey : newId()]));
  const items = workout.items.map((it) => {
    const key = keyMap.get(it.key);
    const link = it.link && keyMap.has(it.link.toKey) ? { ...it.link, toKey: keyMap.get(it.link.toKey) } : null;
    const orig = byKey.get(key);
    if (orig) return { ...orig, pap: !!it.pap, link };
    const mine = sets.filter((x) => x.itemKey === it.key && x.done);
    return {
      key, exerciseId: it.exerciseId, restSec: it.restSec, pap: !!it.pap, link,
      setPlans: mine.map((x) => {
        const p = { warmup: !!x.warmup, restSec: x.restSec ?? it.restSec ?? null };
        for (const f of SET_VALUE_FIELDS) if (x[f] != null && x[f] !== '') p[f] = x[f];
        return p;
      }),
    };
  });
  return put('routines', { ...r, items: normalizeLinks(items) });
}

export function getWorkout(id) { return getAlive('workouts', id); }
export function saveWorkout(w) { return put('workouts', w); }

/** 終了。完了にしていないセットは記録に残さない(論理削除) */
export async function finishWorkout(id) {
  const w = await db.workouts.get(id);
  if (!w) return null;
  for (const x of await listSets(id)) if (!x.done) await remove('sets', x.id);
  return put('workouts', { ...w, status: 'done', endedAt: w.endedAt || nowIso(), timer: null });
}

export async function deleteWorkout(id) {
  const sets = await db.sets.where('workoutId').equals(id).toArray();
  for (const s of sets.filter(alive)) await remove('sets', s.id);
  const trials = await db.trials.where('workoutId').equals(id).toArray();
  for (const t of trials.filter(alive)) await remove('trials', t.id);
  return remove('workouts', id);
}

/** 完了した練習を新しい順に返す */
export async function listWorkouts({ limit = 200 } = {}) {
  const rows = await db.workouts.orderBy('date').reverse().toArray();
  return rows.filter((w) => alive(w) && w.status === 'done').slice(0, limit);
}

/* ===================== セット ===================== */

export async function listSets(workoutId) {
  const rows = await db.sets.where('workoutId').equals(workoutId).toArray();
  return rows.filter(alive).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
export function saveSet(s) { return put('sets', s); }
export function deleteSet(id) { return remove('sets', id); }

/** ある種目の、ある日付より前の完了済みセット(新しい日付順) */
export async function listSetsForExercise(exerciseId, { beforeDate = '￿' } = {}) {
  const rows = await db.sets
    .where('[exerciseId+date]').between([exerciseId, ''], [exerciseId, beforeDate], true, false)
    .toArray();
  return rows.filter((s) => alive(s) && s.done).sort((a, b) => b.date.localeCompare(a.date) || (a.order ?? 0) - (b.order ?? 0));
}

/** 前回:その種目を行った直近の練習のセット(今の練習は除く) */
export async function getLastSets(exerciseId, { excludeWorkoutId = null } = {}) {
  const rows = (await listSetsForExercise(exerciseId)).filter((s) => s.workoutId !== excludeWorkoutId);
  if (!rows.length) return [];
  const wid = rows[0].workoutId;
  return rows.filter((s) => s.workoutId === wid).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/** 自己ベストのセット(ウォームアップ除外。体重はその日の値か直近の値) */
export async function getBestSet(exerciseId, recordType, { excludeWorkoutId = null } = {}) {
  const sets = (await listSetsForExercise(exerciseId)).filter((x) => x.workoutId !== excludeWorkoutId);
  if (!sets.length) return null;
  const bws = await listBodyweights();
  const bwOn = (date) => bodyweightNear(bws, date);
  return bestSet(recordType, sets, (x) => bwOn(x.date));
}

/**
 * 種目の推移:練習ごとのベスト(本番のセットのうち「良さ」が最大のもの)を日付の古い順に返す
 * [{ date, workoutId, set, score }]
 */
export async function getExerciseProgress(exerciseId) {
  const ex = await getExercise(exerciseId) || (await db.exercises.get(exerciseId));
  if (!ex) return [];
  const sets = (await listSetsForExercise(exerciseId)).filter((x) => !x.warmup);
  const bws = await listBodyweights();
  const bwOn = (date) => bodyweightNear(bws, date);
  const byWorkout = new Map();
  for (const x of sets) {
    if (!byWorkout.has(x.workoutId)) byWorkout.set(x.workoutId, []);
    byWorkout.get(x.workoutId).push(x);
  }
  const out = [];
  for (const [workoutId, list] of byWorkout) {
    const b = bestSet(ex.recordType, list, (x) => bwOn(x.date));
    if (b) out.push({ date: list[0].date, workoutId, set: b.set, score: b.score });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/* ===================== 体重 ===================== */

/**
 * その日の体重(なければ直近の過去の体重、それもなければ一番近い後の体重)。
 * 実負荷の比較で、体重を記録し始める前の練習だけ別の基準にならないようにする。
 * bws は日付の古い順
 */
export function bodyweightNear(bws, date) {
  let v = null;
  for (const b of bws) { if (b.date <= date) v = b.kg; else break; }
  if (v == null) v = bws.find((b) => b.date > date)?.kg ?? null;
  return v;
}

/** 同じ日は上書き(1日1件) */
export async function saveBodyweight(date, kg) {
  const existing = await getBodyweightOn(date);
  return put('bodyweights', { ...(existing || {}), date, kg });
}
export async function getBodyweightOn(date) {
  const rows = await db.bodyweights.where('date').equals(date).toArray();
  return rows.filter(alive).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] || null;
}
/** その日以前で最も新しい体重 */
export async function getLatestBodyweight(onOrBefore = localDate()) {
  const rows = await db.bodyweights.where('date').belowOrEqual(onOrBefore).reverse().toArray();
  return rows.find(alive) || null;
}
/** 体重の記録を消す(論理削除) */
export function deleteBodyweight(id) { return remove('bodyweights', id); }

export async function listBodyweights() {
  return (await db.bodyweights.orderBy('date').toArray()).filter(alive);
}

/* ===================== 試技 ===================== */

export async function listTrials(exerciseId = null) {
  let rows = exerciseId
    ? await db.trials.where('[exerciseId+date]').between([exerciseId, ''], [exerciseId, '￿']).toArray()
    : await db.trials.toArray();
  return rows.filter(alive).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}
export function getTrial(id) { return getAlive('trials', id); }
export function saveTrial(t) { return put('trials', { attempts: [], workoutId: null, ...t }); }
export function deleteTrial(id) { return remove('trials', id); }

/* ===================== 目標 ===================== */

export async function listGoals() {
  // 並べ替えた順(order)。order が無い古い目標は作った順
  return (await db.goals.toArray()).filter(alive).sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.createdAt.localeCompare(b.createdAt));
}

/** 目標の並び順を保存する(ids の順に 1, 2, 3 …)。ホームの表示順もこの順 */
export async function reorderGoals(ids) {
  const goals = new Map((await listGoals()).map((g) => [g.id, g]));
  let n = 1;
  for (const id of ids) {
    const g = goals.get(id);
    if (g && g.order !== n) await put('goals', { ...g, order: n });
    n++;
  }
}
export function getGoal(id) { return getAlive('goals', id); }
/**
 * 目標の保存(作成・上書き)。目標値・期限の上書きは「いまの目標」の訂正として扱い、履歴は増やさない。
 * 手で入れたベストが変わったときは bestLog に記録を足す。
 */
export async function saveGoal(g) {
  const prev = g.id ? await db.goals.get(g.id) : null;
  g = migrateGoal({ ...g });
  // 新しい目標は一番下に足す
  if (g.order == null) g.order = (await listGoals()).reduce((m, x) => Math.max(m, x.order ?? 0), 0) + 1;
  if (!prev) {
    g.targets = [{ value: g.target ?? null, deadline: g.deadline ?? null, setOn: localDate(), endedOn: null, result: null }];
    g.bestLog = [];
  } else {
    const cur = g.targets[g.targets.length - 1];
    g.targets = [...g.targets.slice(0, -1), { ...cur, value: g.target ?? null, deadline: g.deadline ?? null }];
  }
  const mb = g.manualBest;
  const pb = prev?.manualBest;
  if (mb && mb.value != null && (!pb || pb.value !== mb.value || pb.date !== mb.date)) {
    const entry = { value: mb.value, date: mb.date || localDate() };
    g.bestLog = [...(g.bestLog || []).filter((x) => !(x.date === entry.date)), entry].sort((a, b) => a.date.localeCompare(b.date));
  }
  return put('goals', g);
}

/**
 * 次の目標を立てる。いまの目標を「達成」(ベストが届いていれば)か「変更」として閉じ、新しい目標値を履歴に足す。
 */
export async function setNextGoal(goalId, { target, deadline = null, on = null, result = null }) {
  const g = migrateGoal(await db.goals.get(goalId));
  const day = on || localDate();
  let res = result;
  if (!res) {
    const best = await getGoalBest(g);
    res = goalProgress(g, best, day).achieved ? 'achieved' : 'changed';
  }
  const cur = g.targets[g.targets.length - 1];
  const targets = [
    ...g.targets.slice(0, -1),
    { ...cur, endedOn: day, result: res },
    { value: target, deadline, setOn: day, endedOn: null, result: null },
  ];
  return saveGoalTargets(goalId, targets, g);
}

/**
 * 目標値の履歴を、さかのぼって直した内容で保存する。
 * 立てた日の順に並べ、最後の1つを「いまの目標」(終えた日なし)にする。
 * それより前の目標に終えた日がなければ、次の目標を立てた日を入れる。
 */
export async function saveGoalTargets(goalId, targets, g0 = null) {
  const g = g0 || migrateGoal(await db.goals.get(goalId));
  const list = targets.filter((t) => t && t.value != null && t.setOn)
    .map((t) => ({ value: t.value, deadline: t.deadline || null, setOn: t.setOn, endedOn: t.endedOn || null, result: t.result || null }))
    .sort((a, b) => a.setOn.localeCompare(b.setOn));
  if (!list.length) return g;
  list.forEach((t, i) => {
    if (i === list.length - 1) { t.endedOn = null; t.result = null; return; }
    if (!t.endedOn) t.endedOn = list[i + 1].setOn;
    if (!t.result) t.result = 'changed';
  });
  const cur = list[list.length - 1];
  return put('goals', { ...g, targets: list, target: cur.value, deadline: cur.deadline });
}

/**
 * 手で入れたベストの記録を、さかのぼって直した内容で保存する。
 * 「ベスト」(manualBest)は記録の中で一番良いもの(良い方向に合わせる)にそろえる。
 */
export async function saveGoalBestLog(goalId, log) {
  const g = migrateGoal(await db.goals.get(goalId));
  const list = log.filter((x) => x && x.value != null && x.date)
    .map((x) => ({ value: Number(x.value), date: x.date }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const dir = g.direction === 'lower' ? 'lower' : 'higher';
  const best = list.reduce((m, x) => betterBest(m, x, dir), null);
  return put('goals', { ...g, bestLog: list, manualBest: best ? { value: best.value, date: best.date } : null });
}

/**
 * 目標の推移:目標値の履歴と、ベストの記録(日付順)
 * bests: [{ date, value }](手入力のベスト・試技・推定1RM・体重から)
 */
export async function getGoalHistory(goal) {
  const g = migrateGoal(goal);
  const m = g.metric || { type: 'manual' };
  let bests = (g.bestLog || []).map((x) => ({ date: x.date, value: x.value, source: 'manual' }));
  if (m.type === 'trial' && m.exerciseId) {
    for (const t of await listTrials(m.exerciseId)) {
      const st = trialStats(t.attempts);
      const v = m.stat === 'average' ? st.average : st.best;
      if (v != null) bests.push({ date: t.date, value: v, source: 'record' });
    }
  } else if (m.type === 'e1rm' && m.exerciseId) {
    for (const r of await getExerciseProgress(m.exerciseId)) bests.push({ date: r.date, value: r.score, source: 'record' });
  } else if (m.type === 'series' && m.seriesId) {
    for (const p of await getSeriesProgress(m.seriesId, 'best')) bests.push({ date: p.date, value: p.value, source: 'record' });
  } else if (m.type === 'swim') {
    for (const p of await getSwimGoalTimes(m)) bests.push({ date: p.date, value: p.value, source: 'record' });
  } else if (m.type === 'bodyweight') {
    bests = (await listBodyweights()).map((b) => ({ date: b.date, value: b.kg, source: 'record' }));
  }
  bests.sort((a, b) => a.date.localeCompare(b.date));
  return { targets: g.targets, bests };
}

/** ホーム上部に表示する目標(複数可。左右のスワイプで切り替える) */
export async function getPinnedGoals() {
  return (await listGoals()).filter((g) => g.pinned);
}

/**
 * 目標の指標の種類(段階1)
 *  manual    : 記録からは出さない(水泳タイムなど。段階2でタイム記録から出す)
 *  trial     : 試技(exerciseId、stat = best | average)
 *  e1rm      : 種目の推定1RM(exerciseId)
 *  bodyweight: 体重(「ベスト」ではなく最新の値)
 */
export const GOAL_METRICS = {
  manual: '手入力',
  trial: '試技',
  e1rm: '推定1RM',
  bodyweight: '体重',
  series: '練習タイム',
};

/**
 * 目標のベスト { value, date, source } を返す。
 * 手で入れたベスト(goal.manualBest)と記録から出した値のうち、良い方。
 * 体重は最新の値(source = 'latest')。
 */
export async function getGoalBest(goal) {
  const dir = goal.direction === 'lower' ? 'lower' : 'higher';
  const manual = goal.manualBest && goal.manualBest.value != null
    ? { value: Number(goal.manualBest.value), date: goal.manualBest.date || null, source: 'manual' } : null;
  const m = goal.metric || { type: 'manual' };
  let recorded = null;

  if (m.type === 'bodyweight') {
    const bw = await getLatestBodyweight();
    return bw ? { value: bw.kg, date: bw.date, source: 'latest' } : manual;
  }
  if (m.type === 'trial' && m.exerciseId) {
    for (const t of await listTrials(m.exerciseId)) {
      const st = trialStats(t.attempts);
      const v = m.stat === 'average' ? st.average : st.best;
      if (v != null) recorded = betterBest(recorded, { value: v, date: t.date, source: 'record' }, dir);
    }
  }
  if (m.type === 'series' && m.seriesId) {
    for (const p of await getSeriesProgress(m.seriesId, 'best')) recorded = betterBest(recorded, { value: p.value, date: p.date, source: 'record' }, dir);
  }
  if (m.type === 'swim') {
    for (const p of await getSwimGoalTimes(m)) recorded = betterBest(recorded, { value: p.value, date: p.date, source: 'record' }, dir);
  }
  if (m.type === 'e1rm' && m.exerciseId) {
    const ex = await getExercise(m.exerciseId);
    const sets = await listSetsForExercise(m.exerciseId);
    const bws = await listBodyweights();
    for (const s of sets) {
      if (s.warmup) continue;
      const v = setEstimate1RM(ex?.recordType || 'weight_reps', s, bodyweightNear(bws, s.date));
      if (v != null) recorded = betterBest(recorded, { value: v, date: s.date, source: 'record' }, dir);
    }
  }
  return betterBest(manual, recorded, dir);
}
export function deleteGoal(id) { return remove('goals', id); }

/* ===================== プール(段階2) ===================== */

/** スイム記録を始める(date を渡すと過去の日付で記録できる) */
export async function startPoolSession({ date = null } = {}) {
  return put('poolSessions', { date: date || localDate(), startedAt: nowIso(), endedAt: null, status: 'active', memo: '' });
}

/** スイム記録の日付を変える(タイムの日付も合わせる) */
export async function setPoolSessionDate(id, date) {
  const s = await db.poolSessions.get(id);
  if (!s) return null;
  for (const t of (await db.swimTimes.where('sessionId').equals(id).toArray()).filter(alive)) await put('swimTimes', { ...t, date });
  return put('poolSessions', { ...s, date });
}

/** 最近のスイム記録(完了したもの、新しい順) */
export async function listRecentPoolSessions(limit = 10) {
  const rows = await listPoolSessions();
  return Promise.all(rows.slice(0, limit).map(async (s) => ({ session: s, times: await listSwimTimes(s.id) })));
}
export async function getActivePoolSession() {
  const rows = await db.poolSessions.where('status').equals('active').toArray();
  return rows.filter(alive).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] || null;
}
export function getPoolSession(id) { return getAlive('poolSessions', id); }
export function savePoolSession(s) { return put('poolSessions', s); }
export async function finishPoolSession(id) {
  const s = await db.poolSessions.get(id);
  if (!s) return null;
  return put('poolSessions', { ...s, status: 'done', endedAt: s.endedAt || nowIso() });
}
export async function deletePoolSession(id) {
  for (const t of (await db.swimTimes.where('sessionId').equals(id).toArray()).filter(alive)) await remove('swimTimes', t.id);
  return remove('poolSessions', id);
}
export async function listPoolSessions() {
  return (await db.poolSessions.orderBy('date').reverse().toArray()).filter((s) => alive(s) && s.status === 'done');
}

/**
 * 系統。id は条件の key から決める(どの端末で記録しても同じ系統になり、段階3の同期で二重にならない)
 */
export function seriesIdOf(conditions) { return `series:${seriesKey(conditions)}`; }

export async function getSeries(id) { return getAlive('series', id); }
export async function listSeries() {
  return (await db.series.toArray()).filter(alive).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt.localeCompare(b.createdAt));
}
export function saveSeries(s) { return put('series', s); }

/** 条件に合う系統を返す。なければ作る(名前は自動、色は順に) */
export async function ensureSeries(conditions) {
  const c = normalizeConditions(conditions);
  const id = seriesIdOf(c);
  const cur = await db.series.get(id);
  if (cur && !cur.deleted) return cur;
  const n = (await db.series.count());
  return put('series', {
    ...(cur || {}), id, key: seriesKey(c), conditions: c, name: seriesAutoName(c),
    color: SERIES_COLORS[n % SERIES_COLORS.length], order: n + 1, deleted: false,
  });
}

/** タイムを1本記録する */
export async function addSwimTime(session, conditions, seconds) {
  const c = normalizeConditions(conditions);
  const s = await ensureSeries(c);
  const mine = await listSwimTimes(session.id);
  return put('swimTimes', {
    sessionId: session.id, seriesId: s.id, date: session.date, order: mine.length + 1,
    seconds, valid: true, conditions: c,
  });
}
export async function listSwimTimes(sessionId) {
  return (await db.swimTimes.where('sessionId').equals(sessionId).toArray()).filter(alive).sort((a, b) => a.order - b.order);
}
export function saveSwimTime(t) { return put('swimTimes', t); }
export function deleteSwimTime(id) { return remove('swimTimes', id); }

/** 前回記録したタイムの条件(なければ既定) */
export async function getLastConditions() {
  const rows = (await db.swimTimes.orderBy('updatedAt').reverse().limit(20).toArray()).filter(alive);
  return rows[0]?.conditions ? normalizeConditions(rows[0].conditions) : { ...DEFAULT_CONDITIONS };
}

/**
 * 系統の推移:練習ごとの代表値(最高 or 有効な本数の平均。目安超え・無効は除く)を日付順に
 * [{ date, value, sessionId, count }]
 */
export async function getSeriesProgress(seriesId, mode = 'best') {
  const rows = (await db.swimTimes.where('[seriesId+date]').between([seriesId, ''], [seriesId, '\uffff']).toArray()).filter(alive);
  const bySession = new Map();
  for (const t of rows) {
    if (!bySession.has(t.sessionId)) bySession.set(t.sessionId, []);
    bySession.get(t.sessionId).push(t);
  }
  const out = [];
  for (const [sessionId, list] of bySession) {
    list.sort((a, b) => a.order - b.order);
    const v = sessionValue(list, mode);
    if (v != null) out.push({ date: list[0].date, value: v, sessionId, count: list.length });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 水泳タイムの目標に数えるタイム(距離・泳法・プール・計測方法が合うもの。無効・目安超えは除く)
 * 日ごとの最高を日付順に [{ date, value }]
 */
export async function getSwimGoalTimes(m) {
  const byDate = new Map();
  for (const t of await db.swimTimes.toArray()) {
    if (!alive(t) || t.valid === false || t.flagged || !(t.seconds > 0)) continue;
    if (!matchesSwimGoal(t.conditions, m)) continue;
    const cur = byDate.get(t.date);
    if (cur == null || t.seconds < cur) byDate.set(t.date, t.seconds);
  }
  return [...byDate].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
}

/** 系統ごとの本数とベスト(一覧用) */
export async function getSeriesSummary(seriesId) {
  const prog = await getSeriesProgress(seriesId, 'best');
  const best = prog.reduce((m, p) => (m == null || p.value < m.value ? p : m), null);
  return { sessions: prog.length, best, last: prog[prog.length - 1] || null };
}

/** 練習とプール練習を合わせた履歴(新しい順) */
export async function listHistory() {
  const gym = (await listWorkouts()).map((w) => ({ kind: 'gym', date: w.date, startedAt: w.startedAt, item: w }));
  const pool = (await listPoolSessions()).map((s) => ({ kind: 'pool', date: s.date, startedAt: s.startedAt, item: s }));
  return [...gym, ...pool].sort((a, b) => b.date.localeCompare(a.date) || (b.startedAt || '').localeCompare(a.startedAt || ''));
}

/** 記録のある種目の id(重ねるグラフの候補) */
export async function listExerciseIdsWithRecords() {
  const ids = new Set();
  await db.sets.each((x) => { if (alive(x) && x.done && !x.warmup) ids.add(x.exerciseId); });
  return [...ids];
}

/* ===================== 設定 ===================== */

export async function getSettings() {
  const s = await db.settings.get(SETTINGS_ID);
  return { ...DEFAULT_SETTINGS, ...(alive(s) ? s : {}) };
}
export async function saveSettings(patch) {
  const cur = (await db.settings.get(SETTINGS_ID)) || { id: SETTINGS_ID };
  return put('settings', { ...cur, ...patch, id: SETTINGS_ID });
}

/* ===================== 書き出し・読み込み ===================== */

export const BACKUP_FORMAT = 'velocity-quest-backup';

export async function exportAll() {
  const tables = {};
  for (const t of SYNC_TABLES) tables[t] = await db[t].toArray(); // 論理削除済みも含める(同期と同じ)
  return {
    format: BACKUP_FORMAT,
    schemaVersion: db.verno,
    exportedAt: nowIso(),
    deviceId,
    tables,
  };
}

/**
 * 選んだ記録だけを書き出す(別の端末で記録した日の分を、いつもの端末に足すため)
 * workoutIds:ジム、poolSessionIds:スイム記録。withDayExtras なら、その日の体重と(練習の外で入れた)試技も入れる。
 * 種目は自分で登録した種目だけを入れる(最初から入っている種目はどの端末でも同じ id なので入れない。
 * 入れると、お気に入りなどの設定が読み込む側で上書きされることがあるため)。
 * 読み込みは importAll の統合(同じ id は新しい方を残す)で行い、端末のほかのデータは消さない。
 */
export async function exportSelected({ workoutIds = [], poolSessionIds = [], withDayExtras = true } = {}) {
  const workouts = (await db.workouts.bulkGet(workoutIds)).filter(alive);
  const poolSessions = (await db.poolSessions.bulkGet(poolSessionIds)).filter(alive);
  const ids = new Set(workouts.map((w) => w.id));
  const sets = (await db.sets.where('workoutId').anyOf([...ids]).toArray()).filter(alive);
  let trials = (await db.trials.where('workoutId').anyOf([...ids]).toArray()).filter(alive);
  const swimTimes = (await db.swimTimes.where('sessionId').anyOf(poolSessions.map((s) => s.id)).toArray()).filter(alive);
  const dates = [...new Set([...workouts.map((w) => w.date), ...poolSessions.map((s) => s.date)])];
  let bodyweights = [];
  if (withDayExtras && dates.length) {
    bodyweights = (await db.bodyweights.where('date').anyOf(dates).toArray()).filter(alive);
    const free = (await db.trials.toArray()).filter((t) => alive(t) && !t.workoutId && dates.includes(t.date));
    trials = [...trials, ...free];
  }
  const series = (await db.series.bulkGet([...new Set(swimTimes.map((t) => t.seriesId))])).filter(alive);
  const exIds = new Set([
    ...sets.map((s) => s.exerciseId), ...trials.map((t) => t.exerciseId),
    ...workouts.flatMap((w) => (w.items || []).map((it) => it.exerciseId)),
  ]);
  const exercises = (await db.exercises.bulkGet([...exIds])).filter((e) => e && !e.builtin);
  return {
    format: BACKUP_FORMAT,
    scope: 'selected',
    schemaVersion: db.verno,
    exportedAt: nowIso(),
    deviceId,
    summary: { workouts: workouts.length, poolSessions: poolSessions.length, dates: dates.sort() },
    tables: { workouts, sets, trials, poolSessions, swimTimes, series, bodyweights, exercises },
  };
}

/**
 * mode = 'merge'  : 同じ id は updatedAt が新しい方を残す(段階3の同期と同じ規則)
 * mode = 'replace': 端末のデータを全部消してから読み込む
 * 戻り値:テーブルごとの { added, updated, skipped }
 */
export async function importAll(data, { mode = 'merge' } = {}) {
  if (!data || data.format !== BACKUP_FORMAT || typeof data.tables !== 'object') {
    throw new Error('Velocity Quest の書き出しファイルではありません');
  }
  if (data.schemaVersion > db.verno) {
    throw new Error('新しい版のアプリで書き出されたファイルです。アプリを更新してください');
  }
  // 古い版のファイルは、目標をいまの形に直してから読み込む
  if ((data.schemaVersion || 1) < 3 && Array.isArray(data.tables.goals)) {
    data = { ...data, tables: { ...data.tables, goals: data.tables.goals.map((g) => migrateGoal(g)) } };
  }
  // 古い版のファイルは、ルーティンをいまの形に直してから読み込む
  if ((data.schemaVersion || 1) < 2 && Array.isArray(data.tables.routines)) {
    const exs = new Map([...(data.tables.exercises || []), ...(await db.exercises.toArray())].map((e) => [e.id, e]));
    data = { ...data, tables: { ...data.tables, routines: data.tables.routines.map((r) => ({
      ...r, items: (r.items || []).map((it) => (Array.isArray(it.setPlans) ? it : migrateItem(it, exs.get(it.exerciseId)))),
    })) } };
  }
  if (data.scope === 'selected' && mode !== 'merge') throw new Error('選んだ記録のファイルは「統合」でだけ読み込めます');
  const report = {};
  await db.transaction('rw', SYNC_TABLES.map((t) => db[t]), async () => {
    for (const t of SYNC_TABLES) {
      const rows = Array.isArray(data.tables[t]) ? data.tables[t] : [];
      const r = { added: 0, updated: 0, skipped: 0 };
      if (mode === 'replace') await db[t].clear();
      for (const row of rows) {
        if (!row || !row.id) { r.skipped++; continue; }
        const cur = mode === 'replace' ? null : await db[t].get(row.id);
        if (!cur) { await db[t].put(stamp(row, { touch: false })); r.added++; }
        else if ((row.updatedAt || '') > (cur.updatedAt || '')) { await db[t].put(stamp(row, { touch: false })); r.updated++; }
        else r.skipped++;
      }
      report[t] = r;
    }
  });
  return report;
}

/* ===================== 初期データ用(seed.js から使う) ===================== */

export async function _seedInternals() {
  return {
    hasExercise: async (id) => !!(await db.exercises.get(id)),
    getExerciseRaw: (id) => db.exercises.get(id),
    countGear: () => db.gear.count(),
    putExercise: (ex) => put('exercises', ex),
    putGear: (g) => put('gear', g),
  };
}

/** 確認用の件数(土台の確認画面で使う) */
export async function counts() {
  const out = {};
  for (const t of SYNC_TABLES) out[t] = (await db[t].toArray()).filter(alive).length;
  return out;
}
