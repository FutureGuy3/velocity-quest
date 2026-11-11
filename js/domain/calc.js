// 計算はすべて純粋関数で書く(画面やデータベースに触らない)。tests/calc.test.html で確かめる。

/** 小数の誤差を丸める(0.1 + 0.2 → 0.3) */
export function round(n, digits = 2) {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

/** 合計の重さ = バー + プレート片側 × 2 */
export function totalWeight({ bar, platePerSide }) {
  const b = num(bar) ?? 0;
  const p = num(platePerSide) ?? 0;
  if (num(bar) == null && num(platePerSide) == null) return null;
  return round(b + p * 2);
}

/**
 * 実負荷(kg)
 * weight_reps: 重さ / bw_plus: 体重 + 加重 / bw_minus: 体重 − アシスト
 * 体重が必要なのに無いときは null
 */
export function effectiveLoad(recordType, { weight, added, assist } = {}, bodyweight = null) {
  const bw = num(bodyweight);
  switch (recordType) {
    case 'weight_reps': return num(weight);
    case 'bw_plus': return bw == null ? null : round(bw + (num(added) ?? 0));
    case 'bw_minus': return bw == null ? null : round(bw - (num(assist) ?? 0));
    default: return null;
  }
}

export const E1RM_MAX_REPS = 10;

/** 推定1RM(エプリーの式:重さ × (1 + 回数/30))。10回以下のセットだけ */
export function estimate1RM(load, reps) {
  const w = num(load), r = num(reps);
  if (w == null || r == null || w <= 0 || r < 1 || r > E1RM_MAX_REPS) return null;
  return round(w * (1 + r / 30), 1);
}

/** 体重比 = 実負荷 ÷ 体重 */
export function bodyweightRatio(load, bodyweight) {
  const l = num(load), bw = num(bodyweight);
  if (l == null || bw == null || bw <= 0) return null;
  return round(l / bw, 2);
}

/**
 * 1つのセットから、左右それぞれの {load, reps} を取り出す
 * sideMode: both / same(左右同じ)/ split(左右別)
 */
export function setSides(recordType, set, bodyweight = null) {
  if (set.sideMode === 'split') {
    return ['left', 'right']
      .map((side) => set[side] ? { side, load: effectiveLoad(recordType, set[side], bodyweight), reps: num(set[side].reps) } : null)
      .filter(Boolean);
  }
  return [{ side: null, load: effectiveLoad(recordType, set, bodyweight), reps: num(set.reps) }];
}

/** セットの推定1RM(左右別のときは良い方) */
export function setEstimate1RM(recordType, set, bodyweight = null) {
  const vals = setSides(recordType, set, bodyweight).map((s) => estimate1RM(s.load, s.reps)).filter((v) => v != null);
  return vals.length ? Math.max(...vals) : null;
}

/**
 * セットの「良さ」の値(自己ベストの比較に使う。大きいほど良い)
 * weight_reps / bw_plus / bw_minus: 推定1RM(bw系は体重が無ければ加重・アシストで比べる)
 * reps: 回数 / time: 秒 / height_reps: 高さ / contacts: 接地回数 / distance_band: 距離
 */
export function setScore(recordType, set, bodyweight = null) {
  if (!set || set.warmup) return null;
  const sides = set.sideMode === 'split' ? ['left', 'right'].map((k) => set[k]).filter(Boolean) : [set];
  const best = (f) => {
    const v = sides.map(f).filter((x) => x != null);
    return v.length ? Math.max(...v) : null;
  };
  switch (recordType) {
    case 'weight_reps':
    case 'bw_plus':
    case 'bw_minus': {
      const e = setEstimate1RM(recordType, set, bodyweight);
      if (e != null) return e;
      if (recordType === 'bw_plus') return best((s) => estimate1RM(num(s.added) ?? 0, s.reps) ?? null);
      if (recordType === 'bw_minus') return best((s) => { const a = num(s.assist); return a == null ? null : -a; });
      return null;
    }
    case 'reps': return best((s) => num(s.reps));
    case 'time': return best((s) => num(s.seconds));
    case 'height_reps': return best((s) => num(s.heightCm));
    case 'contacts': return best((s) => num(s.contacts));
    case 'distance_band': return best((s) => num(s.distance));
    default: return null;
  }
}

/** セットの一覧から自己ベストのセットを返す(ウォームアップ除外) */
export function bestSet(recordType, sets, bodyweightOf = () => null) {
  let best = null, bestScore = -Infinity;
  for (const s of sets) {
    const sc = setScore(recordType, s, bodyweightOf(s));
    if (sc != null && sc > bestScore) { best = s; bestScore = sc; }
  }
  return best ? { set: best, score: bestScore } : null;
}

/**
 * 試技の集計:最高と、ファウルを除いた平均
 * attempts: [{ value, foul }]
 */
export function trialStats(attempts = []) {
  const valid = attempts.filter((a) => !a.foul && num(a.value) != null).map((a) => num(a.value));
  if (!valid.length) return { best: null, average: null, validCount: 0, total: attempts.length };
  const sum = valid.reduce((s, v) => s + v, 0);
  return {
    best: Math.max(...valid),
    average: round(sum / valid.length, 3),
    validCount: valid.length,
    total: attempts.length,
  };
}

/** 2つの日付(YYYY-MM-DD)の差(日数) */
export function daysBetween(fromDate, toDate) {
  const [y1, m1, d1] = fromDate.split('-').map(Number);
  const [y2, m2, d2] = toDate.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/** 2つのベスト候補 {value, date} から良い方(direction: 'higher' | 'lower') */
export function betterBest(a, b, direction = 'higher') {
  if (!a || a.value == null) return b && b.value != null ? b : null;
  if (!b || b.value == null) return a;
  if (a.value === b.value) return a.date <= b.date ? a : b; // 先に出した方
  const aBetter = direction === 'lower' ? a.value < b.value : a.value > b.value;
  return aBetter ? a : b;
}

/**
 * 目標の残り
 * goal: { target, direction, deadline }  best: { value, date } | null  today: YYYY-MM-DD
 * remaining: あと何秒・何m・何kg(達成済みなら 0)
 * progress: 0〜1(ベストが無ければ null)。目標値の何%まで来たか
 */
export function goalProgress(goal, best, today) {
  const target = num(goal.target);
  const dir = goal.direction === 'lower' ? 'lower' : 'higher';
  const daysLeft = goal.deadline ? daysBetween(today, goal.deadline) : null;
  const b = best && num(best.value) != null ? num(best.value) : null;
  if (target == null || b == null) return { remaining: null, achieved: false, progress: null, daysLeft };
  const gap = dir === 'lower' ? b - target : target - b;
  const achieved = gap <= 0;
  const progress = dir === 'lower' ? (b > 0 ? target / b : null) : (target > 0 ? b / target : null);
  return {
    remaining: achieved ? 0 : round(gap, 3),
    achieved,
    progress: progress == null ? null : Math.min(1, Math.max(0, progress)),
    daysLeft,
  };
}

/** 秒を m:ss 表示に */
export function formatClock(totalSec) {
  const s = Math.max(0, Math.ceil(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 経過ミリ秒を hh:mm:ss 表示に */
export function formatElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return [h, m, sec].map((v) => String(v).padStart(2, '0')).join(':');
}

/** 数値の表示(不要な末尾の0を出さない) */
/** 試技の値の表示。m/s(飛び込み水平速度など)は常に小数2桁(4.50) */
export function fmtTrial(n, unit) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return unit === 'm/s' ? Number(n).toFixed(2) : fmt(n, 2);
}

export function fmt(n, maxDigits = 2) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return String(round(Number(n), maxDigits));
}

/**
 * 入力された数値を読む。全角数字・カンマ小数点も受け付ける。
 * allowClock = true のとき「1:02.34」のような分:秒も秒に直す(62.34)
 * 読めなければ null
 */
export function parseNumber(text, { allowClock = false } = {}) {
  if (text == null) return null;
  const s = String(text).normalize('NFKC').trim().replace(/,/g, '.');
  if (!s) return null;
  if (allowClock && s.includes(':')) {
    const m = s.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
    if (!m || Number(m[2]) >= 60) return null;
    return round(Number(m[1]) * 60 + Number(m[2]), 3);
  }
  if (!/^-?\d+(\.\d+)?$|^-?\.\d+$/.test(s)) return null;
  return Number(s);
}

/** 秒の表示:60秒未満は 30.42、60秒以上は 1:02.34 */
export function formatSeconds(sec, digits = 2) {
  if (sec == null || !Number.isFinite(Number(sec))) return '—';
  const v = Number(sec);
  if (Math.abs(v) < 60) return v.toFixed(digits);
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  const m = Math.floor(a / 60);
  const rest = (a - m * 60).toFixed(digits).padStart(digits + 3, '0');
  return `${sign}${m}:${rest}`;
}

/**
 * 1回の練習の合計(完了したセット。ウォームアップも含める)
 * sets: 完了したセット。recordTypeOf(exerciseId) で記録の型を返す。bodyweight はその日の体重
 * 総挙上重量:重さ×回数の合計。片側は左右を足す。自重+加重は(体重+加重)、自重−アシストは(体重−アシスト)で数える
 * → { volume, exercises, sets, reps }
 */
export function workoutTotals(sets, recordTypeOf, bodyweight = null) {
  let volume = 0, reps = 0, count = 0;
  const exercises = new Set();
  for (const s of sets) {
    if (!s || !s.done) continue;
    const rt = recordTypeOf(s.exerciseId);
    if (rt === 'trials') continue;
    count++;
    exercises.add(s.exerciseId);
    const sides = s.sideMode === 'split' ? [s.left || {}, s.right || {}] : [s];
    for (const side of sides) {
      const r = num(side.reps) ?? 0;
      reps += r;
      const load = rt === 'weight_reps' ? num(side.weight) : effectiveLoad(rt, side, bodyweight);
      if (load != null && r) volume += load * r;
    }
  }
  return { volume: round(volume, 1), exercises: exercises.size, sets: count, reps };
}
