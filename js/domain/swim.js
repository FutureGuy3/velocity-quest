// スイム(水泳)の条件・系統・タイムの決まり。計算は純粋関数で、tests/calc.test.html で確かめる
import { round } from './calc.js';

/** 条件の選択肢(値は保存用の短い記号、label は画面の文字) */
export const CONDITIONS = [
  { key: 'pool', label: 'プール', options: [['short', '短水路'], ['long', '長水路']] },
  // 距離は 15/25/50/100m のほかに任意の距離(m)も入れられる(画面で「任意」を押す)
  { key: 'distance', label: '距離', options: [[15, '15m'], [25, '25m'], [50, '50m'], [100, '100m']] },
  { key: 'stroke', label: '泳法', options: [['free', '自由形'], ['fly', 'バタフライ'], ['back', '背泳ぎ'], ['breast', '平泳ぎ'], ['im', '個人メドレー']] },
  { key: 'start', label: 'スタート', options: [['push', '壁を蹴って'], ['dive', '飛び込み']] },
  { key: 'timing', label: '計測', options: [['hand', '自分(手動)'], ['buddy', '仲間(手動)'], ['video', '動画'], ['official', '大会公式']] },
  { key: 'gear', label: '器具', options: [['none', 'なし'], ['fins', 'フィン'], ['paddles', 'パドル'], ['both', 'フィン+パドル'], ['other', 'その他']] },
];

export const DEFAULT_CONDITIONS = { pool: 'short', distance: 25, stroke: 'free', start: 'push', timing: 'hand', gear: 'none', gearOther: '' };

/** 版5で付けていた系統の自動の名前(計測の表記が「指ウォッチ」「仲間」だったころ)。名前の直しに使う */
export function seriesAutoNameV5(c) {
  const n = normalizeConditions(c);
  const old = { hand: '指ウォッチ', buddy: '仲間', video: '動画', official: '大会公式' };
  const gear = n.gear === 'none' ? '' : `・${n.gear === 'other' ? (n.gearOther || 'その他') : optionLabel('gear', n.gear)}`;
  return `${optionLabel('pool', n.pool)}${n.distance}m ${optionLabel('stroke', n.stroke)}・${n.start === 'dive' ? '飛び込み' : '壁'}・${old[n.timing] || n.timing}${gear}`;
}

export function optionLabel(key, value) {
  const c = CONDITIONS.find((x) => x.key === key);
  const o = c?.options.find(([v]) => String(v) === String(value));
  return o ? o[1] : String(value ?? '');
}

/** 条件をそろえる(足りない項目は既定値) */
export function normalizeConditions(c = {}) {
  const out = { ...DEFAULT_CONDITIONS, ...c };
  out.distance = Number(out.distance);
  out.gearOther = out.gear === 'other' ? String(out.gearOther || '').trim() : '';
  return out;
}

/**
 * 系統の key:プール・距離・泳法・スタート・計測方法・器具が同じなら同じ key。
 * 長水路の25m と短水路の25m は別。器具「その他」は書いた名前まで含めて区別する
 */
export function seriesKey(c) {
  const n = normalizeConditions(c);
  return [n.pool, `${n.distance}m`, n.stroke, n.start, n.timing, n.gear === 'other' ? `other:${n.gearOther}` : n.gear].join('|');
}

/** 系統の自動の名前(例:短水路25m 自由形・壁・指ウォッチ) */
export function seriesAutoName(c) {
  const n = normalizeConditions(c);
  const gear = n.gear === 'none' ? '' : `・${n.gear === 'other' ? (n.gearOther || 'その他') : optionLabel('gear', n.gear)}`;
  const start = n.start === 'dive' ? '飛び込み' : '壁';
  return `${optionLabel('pool', n.pool)}${n.distance}m ${optionLabel('stroke', n.stroke)}・${start}・${optionLabel('timing', n.timing)}${gear}`;
}

/** 条件の説明(一覧の小さな文字) */
export function conditionsText(c) {
  const n = normalizeConditions(c);
  return [
    optionLabel('pool', n.pool), `${n.distance}m`, optionLabel('stroke', n.stroke), optionLabel('start', n.start),
    optionLabel('timing', n.timing), n.gear === 'other' ? (n.gearOther || 'その他') : optionLabel('gear', n.gear),
  ].join(' · ');
}

/** 系統の色(新しい系統に順に割り当てる) */
export const SERIES_COLORS = ['#5AB4FF', '#F5C542', '#3DDC97', '#E58BF0', '#FF8A4C', '#A3E635', '#F87171', '#C4B5FD'];

export const CUTOFF_RATE = 0.03;

/**
 * 打ち切りの判定(同じ練習・同じ系統のタイムを記録した順に渡す)
 * 有効な最初の3本の平均を基準にし、4本目以降で基準より3%遅いタイムは「目安超え」(平均から外す)
 * times: [{ seconds, valid }] → { base, cut, flags: [bool], best, average, validCount, total, suggestStop }
 */
export function cutoffInfo(times) {
  const valid = times.map((t, i) => ({ ...t, i })).filter((t) => t.valid !== false && Number.isFinite(Number(t.seconds)));
  const firstThree = valid.slice(0, 3);
  const base = firstThree.length === 3 ? round(firstThree.reduce((s, t) => s + Number(t.seconds), 0) / 3, 3) : null;
  const cut = base != null ? round(base * (1 + CUTOFF_RATE), 3) : null;
  const baseIdx = new Set(firstThree.map((t) => t.i));
  const flags = times.map((t, i) => cut != null && t.valid !== false && !baseIdx.has(i) && Number(t.seconds) > cut);
  const counted = valid.filter((t) => !flags[t.i]).map((t) => Number(t.seconds));
  const lastIdx = times.length - 1;
  return {
    base, cut, flags,
    best: counted.length ? Math.min(...counted) : null,
    average: counted.length ? round(counted.reduce((a, b) => a + b, 0) / counted.length, 3) : null,
    validCount: counted.length,
    total: times.length,
    suggestStop: lastIdx >= 0 && flags[lastIdx] === true,
  };
}

/** 1回の練習の代表値:'best'=最高(最も速い)、'average'=有効な本数の平均 */
export function sessionValue(times, mode = 'best') {
  const info = cutoffInfo(times);
  return mode === 'average' ? info.average : info.best;
}

/**
 * 重ねるグラフの値の直し方
 * points: [{ date, value }](日付順) better: 'lower' | 'higher'
 *  shape:最初の値を0、期間内の最も良い値を100
 *  rate :最初の値からの改善率(%)。タイムは縮むほど、重さは増えるほどプラス
 */
export function toShape(points, better = 'higher') {
  if (!points.length) return [];
  const first = points[0].value;
  const vals = points.map((p) => p.value);
  const best = better === 'lower' ? Math.min(...vals) : Math.max(...vals);
  const span = better === 'lower' ? first - best : best - first;
  return points.map((p) => ({ ...p, y: span === 0 ? 0 : round(((better === 'lower' ? first - p.value : p.value - first) / span) * 100, 1) }));
}
export function toRate(points, better = 'higher') {
  if (!points.length) return [];
  const first = points[0].value;
  return points.map((p) => ({ ...p, y: first === 0 ? 0 : round(((better === 'lower' ? first - p.value : p.value - first) / Math.abs(first)) * 100, 2) }));
}

/** 伸び幅:最初と最後の差と改善率(タイムは縮んだらマイナスの秒、改善率はプラス) */
export function changeOf(points, better = 'higher') {
  if (points.length < 2) return null;
  const first = points[0].value, last = points[points.length - 1].value;
  const diff = round(last - first, 3);
  const rate = first === 0 ? null : round(((better === 'lower' ? first - last : last - first) / Math.abs(first)) * 100, 1);
  return { diff, rate };
}

/** データの少ない系統(練習の間が平均20日以上)は線でつながず点だけにする */
export function isSparse(points) {
  if (points.length < 2) return true;
  const day = (d) => Date.UTC(...d.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n)))) / 86400000;
  const gaps = [];
  for (let i = 1; i < points.length; i++) gaps.push(day(points[i].date) - day(points[i - 1].date));
  return gaps.reduce((a, b) => a + b, 0) / gaps.length >= 20;
}
