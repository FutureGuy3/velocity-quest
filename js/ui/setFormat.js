// セットの表示用の文字(トレーニング記録と履歴で共通)
import { fmt } from '../domain/calc.js';

/** 入力欄の定義(記録の型ごとの項目) */
export const FIELD_META = {
  weight:   { label: '重さ kg', short: 'kg', mode: 'decimal' },
  added:    { label: '加重 kg', short: '+kg', mode: 'decimal' },
  assist:   { label: 'アシスト kg', short: '−kg', mode: 'decimal' },
  reps:     { label: '回数', short: '回', mode: 'numeric' },
  seconds:  { label: '秒', short: '秒', mode: 'decimal' },
  heightCm: { label: '高さ cm', short: 'cm', mode: 'decimal' },
  contacts: { label: '接地回数', short: '回', mode: 'numeric' },
  distance: { label: '距離 m', short: 'm', mode: 'decimal' },
  band:     { label: 'バンド', short: '', mode: 'text' },
};

export const TYPE_FIELDS = {
  weight_reps: ['weight', 'reps'],
  bw_plus: ['added', 'reps'],
  bw_minus: ['assist', 'reps'],
  reps: ['reps'],
  time: ['seconds'],
  height_reps: ['heightCm', 'reps'],
  contacts: ['contacts', 'seconds'],
  distance_band: ['distance', 'band'],
};

const has = (v) => v != null && v !== '';

function one(recordType, v) {
  if (!v) return '';
  const r = has(v.reps) ? ` × ${fmt(v.reps)}` : '';
  switch (recordType) {
    case 'weight_reps': return has(v.weight) ? `${fmt(v.weight)}kg${r}` : (has(v.reps) ? `${fmt(v.reps)}回` : '');
    case 'bw_plus': return `${has(v.added) && Number(v.added) !== 0 ? `+${fmt(v.added)}kg` : '自重'}${r}`;
    case 'bw_minus': return `${has(v.assist) ? `−${fmt(v.assist)}kg` : '自重'}${r}`;
    case 'reps': return has(v.reps) ? `${fmt(v.reps)}回` : '';
    case 'time': return has(v.seconds) ? `${fmt(v.seconds)}秒` : '';
    case 'height_reps': return `${has(v.heightCm) ? `${fmt(v.heightCm)}cm` : ''}${r}`;
    case 'contacts': return [has(v.contacts) ? `${fmt(v.contacts)}回` : '', has(v.seconds) ? `${fmt(v.seconds)}秒` : ''].filter(Boolean).join(' / ');
    case 'distance_band': return [has(v.distance) ? `${fmt(v.distance)}m` : '', v.band || ''].filter(Boolean).join(' ');
    default: return '';
  }
}

/** セット1つの表示(左右別なら「左 … / 右 …」) */
export function formatSet(recordType, set) {
  if (!set) return '';
  if (set.sideMode === 'split') return `左 ${one(recordType, set.left) || '—'} / 右 ${one(recordType, set.right) || '—'}`;
  const s = one(recordType, set);
  return set.sideMode === 'same' && s ? `${s}(片側)` : s;
}

/** 複数セットのまとめ(同じ内容が続けば「75kg × 5 × 3」) */
export function summarizeSets(recordType, sets) {
  const work = sets.filter((x) => !x.warmup);
  if (!work.length) return '';
  const texts = work.map((x) => formatSet(recordType, x));
  if (texts.every((t) => t === texts[0])) return texts.length > 1 ? `${texts[0]} × ${texts.length}` : texts[0];
  return texts.join(', ');
}
