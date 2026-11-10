// 小さな推移のグラフ(1つの指標とその目標を見るためのもの。複数の指標を重ねるグラフは段階2)
// 横軸は日付、縦軸は値。better = 'lower' のときは縦軸を上下反対にして「上ほど良い」にそろえる
import { formatDateShort } from '../dom.js';
import { fmt } from '../../domain/calc.js';

const NS = 'http://www.w3.org/2000/svg';
const toDay = (d) => Date.UTC(...d.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n)))) / 86400000;

/**
 * points: 値の点 [{ date, value }](線で結ぶ)
 * steps:  目標値の段差 [{ from, to, value, result }](to が null ならいまの日付まで)
 */
export function miniChart({ points = [], steps = [], better = 'higher', unit = '', format = (v) => fmt(v, 2), today, label }) {
  const W = 340, H = 150, L = 40, R = 10, T = 12, B = 22;
  const dates = [...points.map((p) => p.date), ...steps.flatMap((s) => [s.from, s.to || today])].filter(Boolean);
  const values = [...points.map((p) => p.value), ...steps.map((s) => s.value)].filter((v) => v != null);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'mini-chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label || '推移のグラフ');
  if (!dates.length || !values.length) return svg;

  let x0 = Math.min(...dates.map(toDay)), x1 = Math.max(...dates.map(toDay));
  if (x1 === x0) { x0 -= 1; x1 += 1; }
  let y0 = Math.min(...values), y1 = Math.max(...values);
  const pad = (y1 - y0) * 0.12 || Math.abs(y1) * 0.02 || 1;
  y0 -= pad; y1 += pad;
  const X = (d) => L + ((toDay(d) - x0) / (x1 - x0)) * (W - L - R);
  const Y = (v) => {
    const r = (v - y0) / (y1 - y0);
    return better === 'lower' ? T + r * (H - T - B) : H - B - r * (H - T - B);
  };

  let html = '';
  // 目盛り(上下の値)
  const top = better === 'lower' ? y0 + pad : y1 - pad;
  const bottom = better === 'lower' ? y1 - pad : y0 + pad;
  for (const v of [top, bottom]) {
    html += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" stroke-dasharray="2 4"/>`;
    html += `<text x="${L - 4}" y="${Y(v) + 4}" text-anchor="end" font-size="10" fill="var(--muted)" font-family="Barlow Condensed, sans-serif">${format(v)}</text>`;
  }
  // 日付(両端)
  const firstDate = dates.reduce((a, b) => (a < b ? a : b));
  const lastDate = dates.reduce((a, b) => (a > b ? a : b));
  html += `<text x="${L}" y="${H - 6}" font-size="10" fill="var(--muted)">${formatDateShort(firstDate)}</text>`;
  html += `<text x="${W - R}" y="${H - 6}" text-anchor="end" font-size="10" fill="var(--muted)">${formatDateShort(lastDate)}</text>`;

  // 目標値の段差(破線)。達成した目標は丸印
  for (const s of steps) {
    // 同じ日に立てて終えた目標も見えるよう、最低 10 の長さで描く
    const xa = X(s.from), y = Y(s.value);
    const xb = Math.min(W - R, Math.max(X(s.to || today), xa + 10));
    html += `<line x1="${xa}" x2="${xb}" y1="${y}" y2="${y}" stroke="var(--text-2)" stroke-width="2" stroke-dasharray="6 4"/>`;
    if (s.result === 'achieved') html += `<circle cx="${xb}" cy="${y}" r="4" fill="var(--bg)" stroke="var(--text-2)" stroke-width="2"/>`;
  }
  // 値の線と点
  if (points.length) {
    const pts = points.map((p) => [X(p.date), Y(p.value)]);
    if (pts.length > 1) html += `<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"/>`;
    html += pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.5" fill="var(--accent)"/>`).join('');
  }
  svg.innerHTML = html;
  return svg;
}
