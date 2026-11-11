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
    const cur = await s.getExerciseRaw(e.id);
    if (cur) {
      // 版2で足した「水泳の目的」は、まだ持っていない種目にだけ入れる(利用者の編集は上書きしない)
      let upd = null;
      if (cur.builtin && cur.swim === undefined) upd = { ...(upd || cur), swim: e.swim || [] };
      // 版3:ダンベルの重さの刻みを 1kg に(初期値の 2kg・0.5kg のままの種目だけ。利用者が変えた刻みは残す)
      if (done < 3 && cur.builtin && cur.equipment === 'ダンベル' && [2, 0.5].includes(cur.increment)) upd = { ...(upd || cur), increment: 1 };
      if (upd) await s.putExercise(upd);
      continue;
    }
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
      swim: e.swim || [],
      gearId: GEAR_BY_EQUIPMENT[e.equipment] ?? null,
      favorite: false,
      hidden: false,
      builtin: true,
      order: e.order ?? i,
    });
    added++;
  }
  await setMeta('seedVersion', data.version);
  return { added };
}
