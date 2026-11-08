// 画面の上に重ねる全画面のパネル(種目を選ぶ、種目の登録 など)。
// 端末の「戻る」操作でも閉じられるよう、開くときに履歴を1つ積む(URL のハッシュは変えない)。
import { h, icon } from '../dom.js';

const stack = [];
let ignorePops = 0; // 自分で history.back() した分の popstate は無視する

window.addEventListener('popstate', () => {
  if (ignorePops > 0) { ignorePops--; return; }
  const top = stack[stack.length - 1];
  if (top && !top.closing) {
    top.closing = true;
    finish(top);
  }
});

function finish(entry) {
  const i = stack.indexOf(entry);
  if (i >= 0) stack.splice(i, 1);
  entry.el.remove();
  if (!stack.length) document.body.classList.remove('overlay-open');
  entry.onClose?.();
}

/**
 * パネルを開く。
 * render(api) は中身の要素を返す。api.close() で閉じる。api.setBody(node) で中身を差し替える。
 * 戻り値は api。
 */
export function openOverlay({ title, subtitle = '', closeIcon = 'close', onClose = null, render }) {
  const body = h('div', { class: 'overlay-body' });
  const titleEl = h('span', { class: 'topbar-h' }, title);
  const subEl = h('span', { class: 'topbar-sub' }, subtitle);
  const entry = { el: null, onClose, closing: false };

  const api = {
    close() {
      if (entry.closing) return;
      entry.closing = true;
      // 積んだ履歴を戻す(その popstate では閉じない)
      ignorePops++;
      history.back();
      finish(entry);
    },
    setBody(node) { body.replaceChildren(node); },
    setTitle(t, sub) { titleEl.textContent = t; if (sub != null) subEl.textContent = sub; },
    body,
  };

  entry.el = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('header', { class: 'topbar overlay-head' },
      h('button', { class: 'icon-btn', 'aria-label': '閉じる', onclick: () => api.close() }, icon(closeIcon)),
      h('div', { class: 'topbar-title' }, subtitle ? subEl : null, titleEl)),
    body);

  stack.push(entry);
  document.body.classList.add('overlay-open');
  document.body.appendChild(entry.el);
  history.pushState({ overlay: stack.length }, '');
  const content = render(api);
  if (content) body.appendChild(content);
  return api;
}

/** 開いているパネルをすべて閉じる(画面を移るとき) */
export function closeAllOverlays() {
  while (stack.length) {
    const e = stack[stack.length - 1];
    e.closing = true;
    finish(e);
  }
}

/**
 * 下から出る選択肢のパネル。actions: [{ label, danger, onSelect }]
 */
export function actionSheet({ title, actions }) {
  const close = () => { backdrop.remove(); };
  const backdrop = h('div', { class: 'sheet-backdrop', onclick: (e) => { if (e.target === backdrop) close(); } },
    h('div', { class: 'sheet', role: 'dialog', 'aria-label': title },
      title ? h('p', { class: 'sheet-title' }, title) : null,
      actions.filter(Boolean).map((a) => h('button', {
        class: `sheet-btn${a.danger ? ' danger' : ''}`,
        onclick: () => { close(); a.onSelect(); },
      }, a.label)),
      h('button', { class: 'sheet-btn cancel', onclick: close }, 'やめる')));
  document.body.appendChild(backdrop);
}
