// 目標の表示用の文字を作る(ホームと指標の画面で共通)
import { goalProgress, formatSeconds, fmt } from '../domain/calc.js';
import { formatDateShort } from './dom.js';

export const GOAL_UNITS = ['秒', 'm', 'cm', 'm/s', 'kg', '回'];
const UNIT_DIGITS = { '秒': 2, 'm': 2, 'cm': 1, 'm/s': 2, 'kg': 1, '回': 0 };

export function fmtGoalValue(v, unit) {
  if (v == null) return '—';
  if (unit === '秒') return formatSeconds(v, 2);
  const d = UNIT_DIGITS[unit];
  return d != null ? Number(v).toFixed(d) : fmt(v, 2);
}

/** 目標1件の表示用の文字一式 */
export function goalTexts(goal, best, today) {
  const unit = goal.unit || '';
  const p = goalProgress(goal, best, today);
  let remain = '—';
  if (p.achieved) remain = '達成';
  else if (p.remaining != null) remain = fmtGoalValue(p.remaining, unit) + unit;
  let days = '—';
  if (p.daysLeft != null) days = p.daysLeft >= 0 ? `${p.daysLeft}日` : '期限切れ';
  return {
    target: fmtGoalValue(goal.target, unit),
    suffix: unit,
    bestLabel: best?.source === 'latest' ? '現在' : 'ベスト',
    best: best ? fmtGoalValue(best.value, unit) : '記録なし',
    bestDate: best?.date ? formatDateShort(best.date) : '',
    remain,
    days,
    achieved: p.achieved,
  };
}
