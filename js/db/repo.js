// データ層。画面のコードはこのファイルの関数だけを使って読み書きする。
// 段階3ではここ(特に put / remove)に同期の処理を足す。
import { openDb, SYNC_TABLES, IS_PREVIEW, migrateItem } from './schema.js';
import { setEstimate1RM, trialStats, betterBest, bestSet } from '../domain/calc.js';

export { IS_PREVIEW };

export const OWNER_LOCAL = 'local';
const SETTINGS_ID = 'user';

let db = null;
let deviceId = null;

export const DEFAULT_SETTINGS = Object.freeze({
  accent: '#FF6A1A',
});

/* ===================== 起動 ===================== */

export async function initRepo() {
  db = openDb();
  await db.open();
  deviceId = await getMeta('deviceId');
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    await setMeta('deviceId', deviceId);
  }
  // 端末の空き容量で消されにくくする(対応端末のみ)
  try { await navigator.storage?.persist?.(); } catch { /* 何もしない */ }
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
  const { bodyPart, equipment, q, includeHidden = false } = filter;
  let rows = await db.exercises.toArray();
  rows = rows.filter(alive);
  if (!includeHidden) rows = rows.filter((r) => !r.hidden);
  if (bodyPart) rows = rows.filter((r) => r.bodyPart === bodyPart);
  if (equipment) rows = rows.filter((r) => r.equipment === equipment);
  if (q) {
    const needle = normalize(q);
    rows = rows.filter((r) => normalize(r.name).includes(needle));
  }
  rows.sort((a, b) => (b.starred === true) - (a.starred === true) || (a.order ?? 0) - (b.order ?? 0));
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
  const rest = ex.restSec ?? 90;
  const field = ex.recordType === 'time' ? 'seconds' : ex.recordType === 'distance_band' ? 'distance' : 'reps';
  const plan = () => (ex.recordType === 'trials' ? { warmup: false, restSec: rest } : { warmup: false, restSec: rest, [field]: field === 'reps' ? 5 : null });
  return {
    key: newId(), exerciseId: ex.id, restSec: rest, pap: false, link: null,
    setPlans: ex.recordType === 'trials' ? [] : [plan(), plan(), plan()],
  };
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

/** ルーティンから(またはルーティンなしで)開始。ルーティンはコピーして使い、予定のセットを用意する */
export async function startWorkout({ routineId = null } = {}) {
  const today = localDate();
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
    const item = { key: newId(), exerciseId: id, restSec: ex.restSec ?? 90, pap: false, link: null, sideMode: last[0]?.sideMode || 'both' };
    items.push(item);
    if (ex.recordType === 'trials') continue;
    for (const st of await plannedSets(w, item, null, order, 1)) { await put('sets', st); order++; }
  }
  return put('workouts', { ...w, items });
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
  const bwOn = (date) => { let v = null; for (const b of bws) { if (b.date <= date) v = b.kg; else break; } return v; };
  return bestSet(recordType, sets, (x) => bwOn(x.date));
}

/* ===================== 体重 ===================== */

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
  return (await db.goals.toArray()).filter(alive).sort((a, b) => (b.pinned === true) - (a.pinned === true) || (a.order ?? 0) - (b.order ?? 0) || a.createdAt.localeCompare(b.createdAt));
}
export function getGoal(id) { return getAlive('goals', id); }
export function saveGoal(g) { return put('goals', g); }

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
  if (m.type === 'e1rm' && m.exerciseId) {
    const ex = await getExercise(m.exerciseId);
    const sets = await listSetsForExercise(m.exerciseId);
    const bwCache = new Map();
    for (const s of sets) {
      if (s.warmup) continue;
      if (!bwCache.has(s.date)) bwCache.set(s.date, (await getLatestBodyweight(s.date))?.kg ?? null);
      const v = setEstimate1RM(ex?.recordType || 'weight_reps', s, bwCache.get(s.date));
      if (v != null) recorded = betterBest(recorded, { value: v, date: s.date, source: 'record' }, dir);
    }
  }
  return betterBest(manual, recorded, dir);
}
export function deleteGoal(id) { return remove('goals', id); }

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
  // 古い版のファイルは、ルーティンをいまの形に直してから読み込む
  if ((data.schemaVersion || 1) < 2 && Array.isArray(data.tables.routines)) {
    const exs = new Map([...(data.tables.exercises || []), ...(await db.exercises.toArray())].map((e) => [e.id, e]));
    data = { ...data, tables: { ...data.tables, routines: data.tables.routines.map((r) => ({
      ...r, items: (r.items || []).map((it) => (Array.isArray(it.setPlans) ? it : migrateItem(it, exs.get(it.exerciseId)))),
    })) } };
  }
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
