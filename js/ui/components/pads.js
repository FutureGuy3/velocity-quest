// ボタンで値を入れるパネル(下から出る)
//  openValuePad:重さ・回数などを −/+ のボタンで増減する
//  openRestPicker:休憩の時間を「分」と「秒」のボタンで決める
import { h } from '../dom.js';
import { round, fmt } from '../../domain/calc.js';

/**
 * 項目ごとの増減の幅(重さは種目の「重さの刻み」をもとにする)
 * ダンベルは 1kg 刻みで並ぶので 刻み×1・×2・×5(刻み1kgなら 1・2・5)。
 * それ以外は 刻み×1・×2・×4(バーベル 2.5・5・10、ケトルベル 4・8・16)。
 */
export function stepsFor(field, increment, equipment = null) {
  const inc = Number(increment) > 0 ? Number(increment) : 2.5;
  switch (field) {
    case 'weight': case 'added': case 'assist':
      // マシンは半端な重さもあるので 1・5・10
      if (equipment === 'マシン') return [1, 5, 10];
      return equipment === 'ダンベル' ? [inc, round(inc * 2, 3), round(inc * 5, 3)] : [inc, round(inc * 2, 3), round(inc * 4, 3)];
    case 'platePerSide':
      return [inc, round(inc * 2, 3), round(inc * 4, 3)];
    case 'reps': return [1, 5];
    case 'seconds': return [1, 5, 15];
    case 'heightCm': return [5, 10];
    case 'contacts': return [1, 5, 10];
    case 'distance': return [1, 5, 10];
    default: return [1, 5];
  }
}

let current = null;

const SIDE_KEY = 'vq.pad.side';
/** ボタンの列を寄せる側(この端末で覚える) */
function padSide() {
  try { return localStorage.getItem(SIDE_KEY) === 'left' ? 'left' : 'right'; } catch { return 'right'; }
}
function closeCurrent() { current?.remove(); current = null; }

/**
 * value:今の値(null 可) start:空のときに −/+ を押したら始める値(前回の値など)
 * onChange(v) は押すたびに呼ぶ。anchor を渡すと「次へ」で同じカードの次の欄を開く
 */
export function openValuePad({ title, unit = '', value, start = null, steps, min = 0, anchor = null, onChange }) {
  closeCurrent();
  let v = value == null || value === '' ? null : Number(value);
  const display = h('span', { class: 'pad-value num' });
  const show = () => { display.textContent = v == null ? '—' : fmt(v, 3); };
  const set = (nv) => { v = nv == null ? null : Math.max(min, round(nv, 3)); show(); onChange(v); };
  const bump = (d) => set((v ?? (start != null ? Number(start) : 0)) + d);

  const nextCell = () => {
    if (!anchor) return null;
    const box = anchor.closest('.ex-card, .item-card');
    const cells = box ? [...box.querySelectorAll('.cell-btn')] : [];
    return cells[cells.indexOf(anchor) + 1] || null;
  };
  const next = nextCell();

  // −/+ を同じ幅で左右に並べ、ボタンの列を片手で届く側(左寄せ/右寄せ)に寄せる
  const grid = h('div', { class: `pad-grid ${padSide()}` },
    steps.map((s) => h('div', { class: 'pad-pair' },
      h('button', { type: 'button', class: 'pad-btn minus', onclick: () => bump(-s), 'aria-label': `${fmt(s, 3)}減らす` }, `−${fmt(s, 3)}`),
      h('button', { type: 'button', class: 'pad-btn plus', onclick: () => bump(s), 'aria-label': `${fmt(s, 3)}増やす` }, `+${fmt(s, 3)}`))));
  const sideBtn = h('button', {
    type: 'button', class: 'pad-side', 'aria-label': 'ボタンの寄せる側を切り替える',
    onclick: () => {
      const next = padSide() === 'right' ? 'left' : 'right';
      try { localStorage.setItem(SIDE_KEY, next); } catch { /* 何もしない */ }
      grid.className = `pad-grid ${next}`;
      tools.className = `pad-tools ${next}`;
      sideBtn.textContent = next === 'right' ? '左に寄せる' : '右に寄せる';
    },
  }, padSide() === 'right' ? '左に寄せる' : '右に寄せる');
  const tools = h('div', { class: `pad-tools ${padSide()}` }, sideBtn);
  const backdrop = h('div', { class: 'pad-backdrop', onclick: (e) => { if (e.target === backdrop) closeCurrent(); } },
    h('div', { class: 'pad', role: 'dialog', 'aria-label': title },
      h('div', { class: 'pad-head' },
        h('span', { class: 'label' }, title),
        h('span', { class: 'pad-read' }, display, unit ? h('span', { class: 'pad-unit' }, unit) : null)),
      tools,
      grid,
      h('div', { class: 'pad-actions' },
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => set(null) }, 'クリア'),
        next ? h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { closeCurrent(); next.click(); } }, '次へ') : null,
        h('button', { type: 'button', class: 'btn btn-primary', onclick: closeCurrent }, '完了'))));
  show();
  // 空の欄を開いたら、前回の値をそのまま入れておく(+/− で調整するだけで済むように)
  if (v == null && start != null) set(Number(start));
  current = backdrop;
  document.body.appendChild(backdrop);
}

/** 秒 → 「1分30秒」 */
export function restText(sec) {
  if (sec == null) return '—';
  if (sec === 0) return 'なし';
  const m = Math.floor(sec / 60), s = sec % 60;
  return m ? (s ? `${m}分${s}秒` : `${m}分`) : `${s}秒`;
}
/** 秒 → 「1:30」(表の中の短い表示) */
export function restShort(sec) {
  if (sec == null) return '—';
  if (sec === 0) return 'なし';
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

const QUICK = [30, 60, 90, 120, 180];

/** 休憩の時間を分と秒のボタンで決める。onDone(秒) */
export function openRestPicker({ title = '休憩', value = 60, allowZero = false, doneLabel = '決定', onDone }) {
  closeCurrent();
  let v = Math.max(0, Number(value) || 0);
  const minEl = h('span', { class: 'num rp-num' });
  const secEl = h('span', { class: 'num rp-num' });
  const textEl = h('span', { class: 'pad-value num' });
  const quick = h('div', { class: 'pad-steps', style: { gridTemplateColumns: `repeat(${QUICK.length}, minmax(0, 1fr))` } });
  const lower = allowZero ? 0 : 5;
  const show = () => {
    minEl.textContent = String(Math.floor(v / 60));
    secEl.textContent = String(v % 60).padStart(2, '0');
    textEl.textContent = restShort(v);
    [...quick.children].forEach((b, i) => b.setAttribute('aria-pressed', String(QUICK[i] === v)));
  };
  const add = (d) => { v = Math.min(3600, Math.max(lower, v + d)); show(); };
  QUICK.forEach((q) => quick.appendChild(h('button', { type: 'button', class: 'pad-btn quick', onclick: () => { v = q; show(); } }, restText(q))));

  const row = (label, el, dMinus, dPlus, unitText) => h('div', { class: 'rp-row' },
    h('button', { type: 'button', class: 'pad-btn minus', 'aria-label': `${label}を減らす`, onclick: () => add(dMinus) }, '−'),
    h('div', { class: 'rp-mid' }, el, h('span', { class: 'pad-unit' }, unitText)),
    h('button', { type: 'button', class: 'pad-btn plus', 'aria-label': `${label}を増やす`, onclick: () => add(dPlus) }, '+'));

  const backdrop = h('div', { class: 'pad-backdrop', onclick: (e) => { if (e.target === backdrop) closeCurrent(); } },
    h('div', { class: 'pad', role: 'dialog', 'aria-label': title },
      h('div', { class: 'pad-head' }, h('span', { class: 'label' }, title), h('span', { class: 'pad-read' }, textEl)),
      row('分', minEl, -60, 60, '分'),
      row('秒', secEl, -15, 15, '秒(15秒ずつ)'),
      quick,
      h('div', { class: 'pad-actions' },
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: closeCurrent }, 'やめる'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { closeCurrent(); onDone(v); } }, doneLabel))));
  show();
  current = backdrop;
  document.body.appendChild(backdrop);
}

/** 押すとパネルが開く、値を表示するボタン(入力欄の代わり) */
export function cellButton({ value, placeholder = '—', label, onOpen, className = '' }) {
  const b = h('button', { type: 'button', class: `cell-btn ${className}`, 'aria-label': label, onclick: () => onOpen(b) });
  const set = (v) => {
    b.textContent = v == null || v === '' ? placeholder : fmt(v, 3);
    b.classList.toggle('empty', v == null || v === '');
  };
  set(value);
  b.setValue = set;
  return b;
}
