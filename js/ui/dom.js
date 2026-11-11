// 小さな要素生成ヘルパーと、線画アイコン集
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const PATHS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  swim: '<circle cx="16.5" cy="6.5" r="2"/><path d="m5 12 4.5-4 3 2.5L9 13"/><path d="M2 16.5c1.7 0 1.7-1.2 3.3-1.2s1.7 1.2 3.4 1.2 1.6-1.2 3.3-1.2 1.7 1.2 3.3 1.2 1.7-1.2 3.4-1.2 1.6 1.2 3.3 1.2"/><path d="M2 20.5c1.7 0 1.7-1.2 3.3-1.2s1.7 1.2 3.4 1.2 1.6-1.2 3.3-1.2 1.7 1.2 3.3 1.2 1.7-1.2 3.4-1.2 1.6 1.2 3.3 1.2"/>',
  dumbbell: '<path d="M6.5 6.5v11"/><path d="M17.5 6.5v11"/><path d="M3 9v6"/><path d="M21 9v6"/><path d="M6.5 12h11"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-7"/>',
  calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18"/><path d="M8 2v4"/><path d="M16 2v4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  forward: '<path d="m9 18 6-6-6-6"/>',
  play: '<path d="M7 4.5v15a1 1 0 0 0 1.52.85l12-7.5a1 1 0 0 0 0-1.7l-12-7.5A1 1 0 0 0 7 4.5z" fill="currentColor" stroke="none"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  more: '<circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/>',
  star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8-4.3-4.1 5.9-.9z"/>',
  starFill: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8-4.3-4.1 5.9-.9z" fill="currentColor"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.76V6h6v4.76l2 3.24H7z"/><path d="M8 6h8"/>',
  grip: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  sort: '<path d="M7 4v16"/><path d="m3 8 4-4 4 4"/><path d="M17 20V4"/><path d="m13 16 4 4 4-4"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/>',
};

export function icon(name, size = 20, strokeWidth = 2) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', strokeWidth);
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = PATHS[name] || '';
  return svg;
}

let cleanups = [];
/** 次に画面を差し替えるときに実行する後片付け(タイマーの停止など) */
export function onUnmount(fn) { cleanups.push(fn); }

/** 画面を差し替える。showNav=false でサブ画面(下部ナビを隠す) */
/** redraw = true は同じ画面の描き直し(後片付けをしない) */
export function mount(node, { showNav = true, navKey = null, keepScroll = false, redraw = false } = {}) {
  const y = window.scrollY;
  if (!redraw) {
    const pending = cleanups; cleanups = [];
    for (const fn of pending) { try { fn(); } catch (e) { console.error(e); } }
  }
  const app = document.getElementById('app');
  app.replaceChildren(node);
  const nav = document.getElementById('nav');
  nav.hidden = !showNav;
  document.body.classList.toggle('no-nav', !showNav);
  for (const a of nav.querySelectorAll('a')) {
    if (a.dataset.key === navKey) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  window.scrollTo(0, keepScroll ? y : 0);
}

let toastTimer = null;
export function toast(message) {
  document.querySelector('.toast')?.remove();
  const el = h('div', { class: 'toast', role: 'status' }, message);
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 2400);
}

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
/** 2026-11-08 → 11月8日(日) */
export function formatDateJa(date) {
  const [y, m, d] = date.split('-').map(Number);
  const w = WEEK[new Date(y, m - 1, d).getDay()];
  return `${m}月${d}日(${w})`;
}
/** 2026-11-08 → 11/8 */
export function formatDateShort(date) {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}`;
}

/** 顔の5段階(1=とてもきつい … 5=とても良い)。色と表情で見分けられるようにする */
export const FACE_COLORS = ['#F87171', '#FB923C', '#FACC15', '#A3E635', '#34D399'];
const FACE_PARTS = [
  // 1 とてもきつい:> < の目、深いへの字
  '<path d="M7.6 8.6l2.4 1.4-2.4 1.4"/><path d="M16.4 8.6l-2.4 1.4 2.4 1.4"/><path d="M7.8 17.2q4.2-4.4 8.4 0"/>',
  // 2 きつい:下がった眉、への字
  '<path d="M7.4 8.2l3 1.1"/><path d="M16.6 8.2l-3 1.1"/><circle cx="9" cy="11.2" r="0.9" fill="currentColor"/><circle cx="15" cy="11.2" r="0.9" fill="currentColor"/><path d="M8.6 16.6q3.4-2.2 6.8 0"/>',
  // 3 ふつう:点の目、まっすぐな口
  '<circle cx="9" cy="10.2" r="0.9" fill="currentColor"/><circle cx="15" cy="10.2" r="0.9" fill="currentColor"/><path d="M8.6 15.4h6.8"/>',
  // 4 良い:点の目、笑った口
  '<circle cx="9" cy="10.2" r="0.9" fill="currentColor"/><circle cx="15" cy="10.2" r="0.9" fill="currentColor"/><path d="M8 14.2q4 3.6 8 0"/>',
  // 5 とても良い:にっこりした目、大きく開けた口
  '<path d="M7.4 10.6q1.6-2.2 3.2 0"/><path d="M13.4 10.6q1.6-2.2 3.2 0"/><path d="M7.6 13.4h8.8q-.6 4.8-4.4 4.8t-4.4-4.8z" fill="currentColor"/>',
];
export function faceIcon(level, size = 26) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', size); svg.setAttribute('height', size); svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
  const parts = level ? FACE_PARTS[level - 1] : '<circle cx="9" cy="10.2" r="0.9" fill="currentColor"/><circle cx="15" cy="10.2" r="0.9" fill="currentColor"/><path d="M8.6 15.4h6.8"/>';
  svg.innerHTML = `<circle cx="12" cy="12" r="9.5"/>${parts}`;
  return svg;
}

/** テーマの色(アクセント)を変える */
export function applyAccent(color) {
  document.documentElement.style.setProperty('--accent', color);
}

/** JSON をファイルにして保存する(スマホでは共有シート、使えなければダウンロード) */
export async function saveJsonFile(data, name) {
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return true; } catch (e) { if (e.name === 'AbortError') return false; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('書き出しました');
  return true;
}
