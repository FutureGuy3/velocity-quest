// まだ作っていない画面の仮表示
import { h, mount } from '../dom.js';
import { back } from '../../router.js';
import { icon } from '../dom.js';

export function renderPlaceholder(title, navKey) {
  const sub = navKey == null;
  mount(h('div', {},
    h('header', { class: 'topbar' },
      sub ? h('button', { class: 'icon-btn', 'aria-label': '戻る', onclick: () => back() }, icon('back')) : null,
      h('div', { class: 'topbar-title' }, h('span', { class: 'topbar-h' }, title))),
    h('p', { class: 'empty' }, 'この画面はこれから作ります。')),
  { showNav: !sub, navKey });
}
