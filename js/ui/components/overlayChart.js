// 推移を重ねるグラフ(最大5系統)
// lines: [{ key, name, color, dash: 'solid'|'dash'|'dot', pointsOnly, step, axis: 'left'|'right', invert, points: [{ date, y }] }]
// axes: { left: { label, format }, right: { label, format } | null }
import { formatDateShort } from '../dom.js';

const NS = 'http://www.w3.org/2000/svg';
const DASH = { solid: '', dash: '8 5', dot: '2 5' };
const toDay = (d) => Date.UTC(...d.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n)))) / 86400000;

export function overlayChart({ lines, axes, label = '推移を重ねたグラフ', zeroLine = false }) {
  const W = 340, H = 210, T = 14, B = 26;
  const L = 38, R = axes.right ? 38 : 10;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'overlay-chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);

  const all = lines.flatMap((l) => l.points);
  if (!all.length) {
    svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="12" fill="var(--muted)">この期間の記録がありません</text>`;
    return svg;
  }
  let x0 = Math.min(...all.map((p) => toDay(p.date))), x1 = Math.max(...all.map((p) => toDay(p.date)));
  if (x0 === x1) { x0 -= 3; x1 += 3; }
  const X = (d) => L + ((toDay(d) - x0) / (x1 - x0)) * (W - L - R);

  // 縦軸(左右)ごとの範囲
  const range = (side) => {
    const vs = lines.filter((l) => (l.axis || 'left') === side).flatMap((l) => l.points.map((p) => p.y));
    if (!vs.length) return null;
    let lo = Math.min(...vs), hi = Math.max(...vs);
    if (zeroLine) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.05 || 1;
    return { lo: lo - pad, hi: hi + pad, invert: lines.some((l) => (l.axis || 'left') === side && l.invert) };
  };
  const ranges = { left: range('left'), right: range('right') };
  const Y = (v, side = 'left') => {
    const r = ranges[side];
    const t = (v - r.lo) / (r.hi - r.lo);
    return r.invert ? T + t * (H - T - B) : H - B - t * (H - T - B);
  };

  let html = '';
  // 目盛り(上・下)
  for (const side of ['left', 'right']) {
    const r = ranges[side];
    const ax = axes[side];
    if (!r || !ax) continue;
    const top = r.invert ? r.lo : r.hi, bottom = r.invert ? r.hi : r.lo;
    const x = side === 'left' ? L - 4 : W - R + 4;
    const anchor = side === 'left' ? 'end' : 'start';
    for (const v of [top, bottom]) {
      if (side === 'left') html += `<line x1="${L}" x2="${W - R}" y1="${Y(v, side)}" y2="${Y(v, side)}" stroke="var(--line)" stroke-dasharray="2 4"/>`;
      html += `<text x="${x}" y="${Y(v, side) + 4}" text-anchor="${anchor}" font-size="10" fill="var(--muted)" font-family="Barlow Condensed, sans-serif">${ax.format(v)}</text>`;
    }
    if (ax.label) html += `<text x="${side === 'left' ? 2 : W - 2}" y="${H - 6}" text-anchor="${side === 'left' ? 'start' : 'end'}" font-size="9" fill="var(--muted)">${ax.label}</text>`;
  }
  if (zeroLine && ranges.left) html += `<line x1="${L}" x2="${W - R}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--text-2)" stroke-width="1" opacity="0.5"/>`;
  // 日付(両端と真ん中)
  const firstD = all.reduce((a, p) => (p.date < a ? p.date : a), all[0].date);
  const lastD = all.reduce((a, p) => (p.date > a ? p.date : a), all[0].date);
  html += `<text x="${L}" y="${H - 8}" font-size="10" fill="var(--muted)">${formatDateShort(firstD)}</text>`;
  html += `<text x="${W - R}" y="${H - 8}" text-anchor="end" font-size="10" fill="var(--muted)">${formatDateShort(lastD)}</text>`;

  // 線と点
  for (const l of lines) {
    const side = l.axis || 'left';
    if (!ranges[side] || !l.points.length) continue;
    const pts = l.points.map((p) => [X(p.date), Y(p.y, side)]);
    if (l.step) {
      // 目標値の段差:次の目標の日まで横に引く
      let d = '';
      pts.forEach(([x, y], i) => {
        const nx = i < pts.length - 1 ? pts[i + 1][0] : W - R;
        d += `${i ? 'L' : 'M'}${x},${y} L${nx},${y} `;
      });
      html += `<path d="${d}" fill="none" stroke="${l.color}" stroke-width="2" stroke-dasharray="6 4" opacity="0.9"/>`;
      continue;
    }
    if (!l.pointsOnly && pts.length > 1) {
      html += `<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${l.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="${DASH[l.dash] || ''}"/>`;
    }
    const r = l.pointsOnly ? 4 : 3;
    html += pts.map(([x, y]) => (l.marker === 'square'
      ? `<rect x="${x - r}" y="${y - r}" width="${r * 2}" height="${r * 2}" fill="${l.color}"/>`
      : `<circle cx="${x}" cy="${y}" r="${r}" fill="${l.color}"/>`)).join('');
  }
  svg.innerHTML = html;
  return svg;
}

/** 凡例の小さな見本(線の形と色) */
export function lineSwatch({ color, dash, pointsOnly, step }) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '30'); svg.setAttribute('height', '12'); svg.setAttribute('viewBox', '0 0 30 12'); svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = pointsOnly
    ? `<circle cx="8" cy="6" r="3.5" fill="${color}"/><circle cx="22" cy="6" r="3.5" fill="${color}"/>`
    : `<line x1="1" x2="29" y1="6" y2="6" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${step ? '6 4' : (DASH[dash] || '')}"/>`;
  return svg;
}
