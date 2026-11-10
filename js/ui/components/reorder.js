// 並べ替え:種目の一覧を出し、右の「≡」をつかんで上下にドラッグして並べ替える
import { h, icon } from '../dom.js';
import { openOverlay } from './overlay.js';

/**
 * rows: [{ key, label, sub }]
 * onDone(keys) は並べ替えた後の key の順で呼ぶ(「完了」を押したとき)
 */
export function openReorder({ title = '並べ替え', rows, onDone }) {
  let order = rows.slice();
  openOverlay({
    title,
    render(api) {
      const list = h('ul', { class: 'reorder-list' });
      const scroller = () => list.closest('.overlay');

      function draw() {
        list.replaceChildren(...order.map((r, i) => h('li', { class: 'reorder-row', 'data-key': r.key },
          h('span', { class: 'reorder-no' }, String(i + 1)),
          h('div', { class: 'info' }, h('span', { class: 'name' }, r.label), r.sub ? h('span', { class: 'meta' }, r.sub) : null),
          h('span', { class: 'reorder-handle', 'aria-label': `${r.label}をドラッグして移動`, onpointerdown: (e) => startDrag(e, i) }, icon('grip', 22)))));
      }

      function startDrag(e, from) {
        e.preventDefault();
        const handle = e.currentTarget;
        handle.setPointerCapture?.(e.pointerId);
        const rowsEls = [...list.children];
        const row = rowsEls[from];
        const listTop0 = list.getBoundingClientRect().top;
        const tops = rowsEls.map((el) => el.offsetTop);
        const height = row.offsetHeight + 8; // 行の高さ+すき間
        const grabY = e.clientY - (listTop0 + tops[from]);
        let to = from;
        let lastY = e.clientY;
        let raf = 0;
        row.classList.add('dragging');

        const place = () => {
          const listTop = list.getBoundingClientRect().top;
          const y = lastY - listTop - grabY; // 行の上端(一覧の中での位置)
          row.style.transform = `translateY(${y - tops[from]}px)`;
          const center = y + row.offsetHeight / 2;
          to = 0;
          for (let i = 0; i < tops.length; i++) {
            if (i === from) continue;
            if (center > tops[i] + rowsEls[i].offsetHeight / 2) to++;
          }
          rowsEls.forEach((el, i) => {
            if (i === from) return;
            let shift = 0;
            if (from < to && i > from && i <= to) shift = -height;
            if (from > to && i >= to && i < from) shift = height;
            el.style.transform = shift ? `translateY(${shift}px)` : '';
          });
        };
        const autoScroll = () => {
          const sc = scroller();
          if (!sc) return;
          const edge = 80;
          let d = 0;
          if (lastY < edge + 60) d = -8;
          else if (lastY > window.innerHeight - edge) d = 8;
          if (d) { sc.scrollTop += d; place(); }
          raf = requestAnimationFrame(autoScroll);
        };
        const move = (ev) => { lastY = ev.clientY; place(); };
        const up = () => {
          cancelAnimationFrame(raf);
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', up);
          handle.removeEventListener('pointercancel', up);
          const [it] = order.splice(from, 1);
          order.splice(to, 0, it);
          rowsEls.forEach((el) => { el.style.transform = ''; });
          row.classList.remove('dragging');
          draw();
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', up);
        raf = requestAnimationFrame(autoScroll);
      }

      draw();
      return h('div', {},
        h('p', { class: 'hint', style: { padding: '0 var(--gutter) 8px' } }, '右の ≡ をつかんで上下に動かします。'),
        list,
        h('div', { class: 'picker-bar' },
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { api.close(); onDone(order.map((r) => r.key)); } }, '完了')));
    },
  });
}
