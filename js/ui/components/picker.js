// 種目を選ぶ(部位タブ・器具の絞り込み・検索・複数選択)。管理モードでは選ばずに編集を開く
import { h, icon } from '../dom.js';
import { openOverlay } from './overlay.js';
import { openExerciseForm } from './exerciseForm.js';
import { listExercises } from '../../db/repo.js';
import { recordTypeLabel, BODY_PARTS, EQUIPMENT, SWIM_TAGS } from '../../domain/recordTypes.js';

const PART_KEY = 'vq.picker.part';

/**
 * mode = 'select':選んで onDone(ids) を呼ぶ / 'manage':種目の管理(タップで編集、非表示も出す)
 */
export function openPicker({ mode = 'select', context = '', onDone }) {
  const manage = mode === 'manage';
  const st = {
    q: '',
    part: readPart(),
    equip: '',
    selected: [],
    showHidden: false,
  };

  openOverlay({
    title: manage ? '種目の管理' : '種目を選ぶ',
    subtitle: context,
    render(api) {
      const list = h('ul', { class: 'ex-list' });
      const addBtn = h('button', { class: 'btn btn-primary', type: 'button', disabled: true, onclick: () => { api.close(); onDone?.(st.selected.slice()); } }, '追加');

      const search = h('input', {
        type: 'search', placeholder: '種目名で検索', 'aria-label': '種目を検索', enterkeyhint: 'search',
        oninput: (e) => { st.q = e.target.value; refresh(); },
      });

      const tabs = h('div', { class: 'part-tabs', role: 'tablist', 'aria-label': '部位' });
      // 部位のあとに水泳の目的(swim:start など)を並べる
      const tabKeys = ['', ...BODY_PARTS, ...Object.keys(SWIM_TAGS).map((k) => `swim:${k}`)];
      const tabLabel = (k) => (k.startsWith('swim:') ? SWIM_TAGS[k.slice(5)] : k || 'すべて');
      const drawTabs = () => tabs.replaceChildren(...tabKeys.map((p) => h('button', {
        role: 'tab', 'aria-selected': String(st.part === p), class: p.startsWith('swim:') ? 'swim-tab' : null,
        onclick: () => { st.part = p; savePart(p); drawTabs(); refresh(); },
      }, tabLabel(p))));
      drawTabs();

      const chips = h('div', { class: 'chips equip-chips', 'aria-label': '器具' });
      const drawChips = () => chips.replaceChildren(...['', ...EQUIPMENT].map((e) => h('button', {
        class: 'chip', 'aria-pressed': String(st.equip === e),
        onclick: () => { st.equip = e; drawChips(); refresh(); },
      }, e || 'すべて')));
      drawChips();

      let seq = 0;
      async function refresh() {
        const my = ++seq; // 入力が速いときに古い結果で上書きしない
        const rows = await listExercises({
          // 検索語があるときは、タブに関係なくすべての種目から探す
          bodyPart: !st.q.trim() && st.part && !st.part.startsWith('swim:') ? st.part : null,
          swim: !st.q.trim() && st.part.startsWith('swim:') ? st.part.slice(5) : null,
          equipment: st.equip || null, q: st.q.trim() || null,
          includeHidden: manage && st.showHidden,
        });
        if (my !== seq) return;
        list.replaceChildren(...(rows.length ? rows.map(row) : [h('li', { class: 'empty' }, '見つかりません。下の「自分で種目を登録」から足せます。')]));
        const n = st.selected.length;
        addBtn.disabled = n === 0;
        addBtn.textContent = n ? `${n}種目を追加` : '追加';
      }

      function row(ex) {
        const sel = st.selected.includes(ex.id);
        const meta = h('span', { class: 'meta' },
          `${ex.equipment} · ${recordTypeLabel(ex.recordType)}`,
          ex.unilateral ? h('span', { class: 'tag-mini' }, '片側可') : null,
          ex.starred ? h('span', { class: 'tag-mini accent' }, 'よく使う') : null,
          (ex.swim || []).map((t) => h('span', { class: 'tag-mini swim' }, SWIM_TAGS[t])),
          ex.hidden ? h('span', { class: 'tag-mini' }, '非表示') : null,
          !ex.builtin ? h('span', { class: 'tag-mini' }, '自分で登録') : null);
        const edit = () => openExerciseForm({ exercise: ex, onSaved: refresh });
        const toggle = () => {
          st.selected = sel ? st.selected.filter((x) => x !== ex.id) : [...st.selected, ex.id];
          refresh();
        };
        return h('li', { class: `ex-item${sel ? ' selected' : ''}${ex.hidden ? ' is-hidden' : ''}` },
          h('button', { class: 'info', type: 'button', onclick: manage ? edit : toggle, 'aria-label': manage ? `${ex.name}を編集` : null },
            h('span', { class: 'name' }, ex.name), meta),
          manage
            ? h('button', { class: 'check-btn', type: 'button', 'aria-label': `${ex.name}を編集`, onclick: edit }, icon('edit', 18))
            : h('button', { class: 'check-btn', type: 'button', 'aria-pressed': String(sel), 'aria-label': sel ? `${ex.name}を選択解除` : `${ex.name}を選択`, onclick: toggle },
              icon(sel ? 'check' : 'plus', 18, 2.8)));
      }

      const register = () => openExerciseForm({
        defaults: {
          bodyPart: st.part && !st.part.startsWith('swim:') ? st.part : BODY_PARTS[0],
          swim: st.part.startsWith('swim:') ? [st.part.slice(5)] : [],
          equipment: st.equip || 'ダンベル', name: st.q.trim(),
        },
        onSaved: (ex) => { if (ex && !manage) st.selected.push(ex.id); refresh(); },
      });

      refresh();
      return h('div', {},
        h('div', { class: 'search-box' }, icon('search', 18), search),
        tabs,
        chips,
        manage ? h('label', { class: 'switch-row', style: { margin: '8px var(--gutter) 0' } },
          h('span', {}, '非表示の種目も出す'),
          h('span', { class: 'switch' }, h('input', { type: 'checkbox', onchange: (e) => { st.showHidden = e.target.checked; refresh(); } }), h('span', {}))) : null,
        list,
        h('div', { class: 'picker-bar' },
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: register }, '+ 自分で種目を登録'),
          manage ? null : addBtn));
    },
  });
}

function readPart() {
  try { return sessionStorage.getItem(PART_KEY) || ''; } catch { return ''; }
}
function savePart(p) {
  try { sessionStorage.setItem(PART_KEY, p); } catch { /* 何もしない */ }
}
