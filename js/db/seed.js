// 初回起動時(と初期データの版が上がったとき)に、最初から入っている種目と器具を入れる。
// すでにある id は上書きしない(利用者の編集・非表示を壊さないため)。
// 最初から入っている種目は exercises.json の id をそのまま使う
// (どの端末で投入しても同じ id になり、段階3の同期で二重にならない)。
import { getMeta, setMeta, _seedInternals } from './repo.js';

export const DEFAULT_GEAR = [
  { id: 'gear-smith', name: 'スミスマシン', barWeight: 15 },
  { id: 'gear-barbell', name: 'バーベル(オリンピックバー)', barWeight: 20 },
];

const GEAR_BY_EQUIPMENT = { 'スミス': 'gear-smith', 'バーベル': 'gear-barbell' };

export async function seedIfNeeded() {
  const res = await fetch('./data/exercises.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('初期データを読み込めませんでした');
  const data = await res.json();
  const done = (await getMeta('seedVersion')) || 0;
  if (done >= data.version) return { added: 0 };

  const s = await _seedInternals();
  let added = 0;

  if (done === 0) {
    for (const g of DEFAULT_GEAR) await s.putGear({ ...g, builtin: true });
  }

  for (const [i, e] of data.exercises.entries()) {
    if (await s.hasExercise(e.id)) continue;
    await s.putExercise({
      id: e.id,
      name: e.name,
      bodyPart: e.bodyPart,
      subParts: [],
      equipment: e.equipment,
      recordType: e.recordType,
      unilateral: !!e.unilateral,
      increment: e.increment ?? null,
      restSec: e.restSec ?? 90,
      unit: e.unit ?? null,
      gearId: GEAR_BY_EQUIPMENT[e.equipment] ?? null,
      starred: !!e.starred,
      hidden: false,
      builtin: true,
      order: i,
    });
    added++;
  }
  await setMeta('seedVersion', data.version);
  return { added };
}
