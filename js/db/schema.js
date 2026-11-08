// Dexie のテーブル定義とスキーマの版。
// 形を変えるときは version(n+1) を足し、必要なら .upgrade() で移行処理を書く。
// 画面からこのファイルを import しないこと(読み書きは repo.js を通す)。
import Dexie from '../../vendor/dexie.mjs';

export const DB_NAME = 'velocity-quest';

// 同期・書き出しの対象になるテーブル(meta は端末だけの情報なので含めない)
export const SYNC_TABLES = [
  'exercises', 'gear', 'routines', 'workouts', 'sets',
  'bodyweights', 'trials', 'goals', 'settings',
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

  return db;
}
