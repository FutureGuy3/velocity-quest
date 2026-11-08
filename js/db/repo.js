// データ層。画面のコードはこのファイルの関数だけを使って読み書きする。
// 段階3ではここ(特に put / remove)に同期の処理を足す。
import { openDb, SYNC_TABLES, IS_PREVIEW } from './schema.js';
import { setEstimate1RM, trialStats, betterBest } from '../domain/calc.js';

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
  return { key: newId(), exerciseId: ex.id, sets: 3, reps: 5, restSec: ex.restSec ?? 90, pap: false };
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

/** ルーティンから(またはルーティンなしで)開始。ルーティンはコピーして使う */
export async function startWorkout({ routineId = null } = {}) {
  const today = localDate();
  let items = [];
  let title = 'フリー';
  if (routineId) {
    const r = await getRoutine(routineId);
    if (r) {
      title = r.name;
      items = r.items.map((it) => ({ ...it, key: newId(), fromRoutineKey: it.key, sideMode: 'both' }));
    }
  }
  const bw = await getBodyweightOn(today);
  return put('workouts', {
    date: today,
    startedAt: nowIso(),
    endedAt: null,
    status: 'active',
    routineId,
    title,
    bodyweight: bw ? bw.kg : null,
    memo: '',
    items,
  });
}

export function getWorkout(id) { return getAlive('workouts', id); }
export function saveWorkout(w) { return put('workouts', w); }

export async function finishWorkout(id) {
  const w = await db.workouts.get(id);
  if (!w) return null;
  return put('workouts', { ...w, status: 'done', endedAt: nowIso() });
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
  return (await db.goals.toArray()).filter(alive).sort((a, b) => (b.pinned === true) - (a.pinned === true) || a.createdAt.localeCompare(b.createdAt));
}
export function getGoal(id) { return getAlive('goals', id); }
/** 保存。上部に表示する目標は1つだけなので、pinned にしたら他の目標の pinned を外す */
export async function saveGoal(g) {
  const saved = await put('goals', g);
  if (saved.pinned) {
    for (const other of await listGoals()) {
      if (other.id !== saved.id && other.pinned) await put('goals', { ...other, pinned: false });
    }
  }
  return saved;
}

/** ホーム上部に表示する目標(上部表示の印が付いた最初の1つ) */
export async function getPinnedGoal() {
  return (await listGoals()).find((g) => g.pinned) || null;
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
