// Dexie のテーブル定義とスキーマの版。
// 形を変えるときは version(n+1) を足し、必要なら .upgrade() で移行処理を書く。
// 画面からこのファイルを import しないこと(読み書きは repo.js を通す)。
import Dexie from '../../vendor/dexie.mjs';

// テスト版(URL に /preview/ を含む)は本番と別のデータベースを使い、本物の記録に触れない
export const IS_PREVIEW = typeof location !== 'undefined' && location.pathname.includes('/preview/');
export const DB_NAME = IS_PREVIEW ? 'velocity-quest-preview' : 'velocity-quest';

// 同期・書き出しの対象になるテーブル(meta は端末だけの情報なので含めない)
export const SYNC_TABLES = [
  'exercises', 'gear', 'routines', 'workouts', 'sets',
  'bodyweights', 'trials', 'goals', 'settings',
  'poolSessions', 'swimTimes', 'series',
];

export function openDb() {
  const db = new Dexie(DB_NAME);

  // 版1。真偽値はインデックスにできないため deleted / hidden は索引に入れない
  db.version(1).stores({
    exercises:   'id, updatedAt, bodyPart',
    gear:        'id, updatedAt',
    routines:    'id, updatedAt',
    workouts:    'id, updatedAt, date, status',
    sets:        'id, updatedAt, workoutId, [exerciseId+date]',
    bodyweights: 'id, updatedAt, date',
    trials:      'id, updatedAt, workoutId, [exerciseId+date]',
    goals:       'id, updatedAt',
    settings:    'id, updatedAt',
    meta:        'key',
  });

  // 版2:ルーティンの種目ごとの「セット数×回数」を、セットごとの予定(重さ・回数・休憩)に変える。
  // 種目どうしのつなぎ(スーパーセット・PAP ペア)は item.link に持つ(新しい項目なので移行は不要)
  db.version(2).stores({}).upgrade(async (tx) => {
    const exercises = new Map((await tx.table('exercises').toArray()).map((e) => [e.id, e]));
    await tx.table('routines').toCollection().modify((r) => {
      r.items = (r.items || []).map((it) => (Array.isArray(it.setPlans) ? it : migrateItem(it, exercises.get(it.exerciseId))));
    });
  });

  // 版3:目標に「目標値の履歴」(targets)と「手で入れたベストの記録」(bestLog)を持たせる
  db.version(3).stores({}).upgrade(async (tx) => {
    await tx.table('goals').toCollection().modify((g) => { Object.assign(g, migrateGoal(g)); });
  });

  // 版4:最初から付いていた「よく使う」(starred)をやめ、利用者が自分で付ける「お気に入り」(favorite)にする
  db.version(4).stores({}).upgrade(async (tx) => {
    await tx.table('exercises').toCollection().modify((e) => {
      e.favorite = false;
      delete e.starred;
    });
  });

  // 版5(段階2):プールの練習とタイム、系統
  //  poolSessions:プール練習(日付・環境・メモ)
  //  swimTimes:タイム1本ずつ(条件と系統、有効か)
  //  series:系統(条件が同じタイムのまとまり。key は条件から決まる)
  db.version(5).stores({
    poolSessions: 'id, updatedAt, date, status',
    swimTimes: 'id, updatedAt, sessionId, seriesId, [seriesId+date]',
    series: 'id, updatedAt, key',
  });

  return db;
}

/**
 * 版2までの目標を、履歴を持つ形に直す
 * targets: [{ value, deadline, setOn, endedOn, result }](result は 'achieved' | 'changed' | null=いまの目標)
 * bestLog: [{ value, date }](手で入れたベストを更新した記録)
 */
export function migrateGoal(g) {
  if (Array.isArray(g.targets)) return g;
  const setOn = (g.createdAt || new Date().toISOString()).slice(0, 10);
  return {
    ...g,
    targets: [{ value: g.target ?? null, deadline: g.deadline ?? null, setOn, endedOn: null, result: null }],
    bestLog: g.manualBest && g.manualBest.value != null ? [{ value: g.manualBest.value, date: g.manualBest.date || setOn }] : [],
  };
}

/** 版1のルーティンの種目(sets, reps, restSec)を、セットごとの予定に直す */
export function migrateItem(it, ex) {
  const n = Math.max(1, Number(it.sets) || 1);
  const rt = ex?.recordType;
  const field = rt === 'time' ? 'seconds' : rt === 'distance_band' ? 'distance' : rt === 'trials' ? null : 'reps';
  const rest = it.pap ? 180 : (it.restSec ?? ex?.restSec ?? 90);
  const setPlans = Array.from({ length: n }, () => {
    const p = { warmup: false, restSec: rest };
    if (field && it.reps != null) p[field] = it.reps;
    return p;
  });
  const { sets, reps, ...rest2 } = it;
  return { ...rest2, restSec: it.restSec ?? rest, setPlans, link: it.link ?? null };
}
