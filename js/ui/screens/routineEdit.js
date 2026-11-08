// ルーティンの作成・編集(種目の並び、予定のセット×回数、休憩、PAP)
import { h, icon, mount, toast } from '../dom.js';
import { openPicker } from '../components/picker.js';
import { actionSheet } from '../components/overlay.js';
import { REST_OPTIONS, restLabel } from '../components/exerciseForm.js';
import {
  getRoutine, saveRoutine, deleteRoutine, listRoutines, getExerciseMap, newRoutineItem,
} from '../../db/repo.js';
import { recordTypeLabel, planUnit, PAP_REST_SEC } from '../../domain/recordTypes.js';
import { back } from '../../router.js';

export async function renderRoutineEdit({ params }) {
  const isNew = !params.id;
  const existing = isNew ? null : await getRoutine(params.id);
  if (!isNew && !existing) { toast('ルーティンが見つかりません'); back('/home'); return; }
  let exMap = await getExerciseMap();

  const st = {
    name: existing?.name ?? '',
    items: (existing?.items ?? []).map((it) => ({ ...it })),
  };
  let dirty = false;
  const touch = () => { dirty = true; };

  async function addExercises(ids) {
    exMap = await getExerciseMap();
    for (const id of ids) {
      const ex = exMap.get(id);
      if (ex) st.items.push(newRoutineItem(ex));
    }
    touch();
    draw(true);
  }

  async function onSave() {
    const name = st.name.trim();
    if (!name) { toast('ルーティンの名前を入れてください'); document.getElementById('rt-name')?.focus(); return; }
    const order = existing?.order ?? (await listRoutines()).length + 1;
    await saveRoutine({ ...(existing || {}), name, items: st.items, order });
    dirty = false;
    toast(isNew ? 'ルーティンを作りました' : '保存しました');
    back('/home');
  }

  async function onDelete() {
    if (!confirm(`ルーティン「${existing.name}」を削除しますか?過去の記録は残ります。`)) return;
    await deleteRoutine(existing.id);
    toast('削除しました');
    back('/home');
  }

  function onBack() {
    if (dirty && !confirm('保存していない変更があります。保存せずに戻りますか?')) return;
    back('/home');
  }

  function move(i, d) {
    const j = i + d;
    if (j < 0 || j >= st.items.length) return;
    [st.items[i], st.items[j]] = [st.items[j], st.items[i]];
    touch(); draw(true);
  }

  function stepper(label, value, min, max, onChange) {
    const input = h('input', {
      inputmode: 'numeric', value: String(value), 'aria-label': label,
      onchange: (e) => {
        const n = Math.round(Number(e.target.value.normalize('NFKC')));
        const v = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : value;
        onChange(v); e.target.value = String(v);
      },
    });
    const step = (d) => { const v = Math.min(max, Math.max(min, Number(input.value) + d)); input.value = String(v); onChange(v); };
    return h('div', { class: 'field' },
      h('span', { class: 'label' }, label),
      h('div', { class: 'stepper' },
        h('button', { type: 'button', 'aria-label': `${label}を減らす`, onclick: () => step(-1) }, '−'),
        input,
        h('button', { type: 'button', 'aria-label': `${label}を増やす`, onclick: () => step(1) }, '+')));
  }

  function itemCard(it, i) {
    const ex = exMap.get(it.exerciseId);
    const name = ex?.name ?? '(削除された種目)';
    const unit = planUnit(ex?.recordType);
    const next = st.items[i + 1] ? exMap.get(st.items[i + 1].exerciseId)?.name : null;

    const restSel = h('select', {
      class: 'select', 'aria-label': '休憩', disabled: it.pap,
      onchange: (e) => { it.restSec = Number(e.target.value); touch(); },
    }, REST_OPTIONS.map((s) => h('option', { value: s, selected: s === (it.pap ? PAP_REST_SEC : it.restSec) }, `休憩 ${restLabel(s)}`)));

    return h('li', { class: `item-card${it.pap ? ' pap' : ''}` },
      h('div', { class: 'item-head' },
        h('span', { class: 'order' }, String(i + 1)),
        h('div', { class: 'info' },
          h('span', { class: 'name' }, name),
          h('span', { class: 'meta' }, ex ? `${ex.bodyPart} · ${ex.equipment} · ${recordTypeLabel(ex.recordType)}` : '')),
        h('button', {
          class: 'icon-btn', type: 'button', 'aria-label': `${name}のメニュー`,
          onclick: () => actionSheet({
            title: name,
            actions: [
              i > 0 && { label: '上へ移動', onSelect: () => move(i, -1) },
              i < st.items.length - 1 && { label: '下へ移動', onSelect: () => move(i, 1) },
              { label: 'この種目を外す', danger: true, onSelect: () => { st.items.splice(i, 1); touch(); draw(true); } },
            ],
          }),
        }, icon('more'))),
      h('div', { class: 'plan-grid' },
        stepper('セット', it.sets, 1, 20, (v) => { it.sets = v; touch(); }),
        stepper(`${unit}`, it.reps, 1, 999, (v) => { it.reps = v; touch(); })),
      h('div', { class: 'rest-row' },
        restSel,
        h('button', {
          class: 'pap-toggle', type: 'button', 'aria-pressed': String(!!it.pap),
          onclick: () => { it.pap = !it.pap; touch(); draw(true); },
        }, h('span', { class: 'box' }, it.pap ? icon('check', 14, 3) : null), 'PAP')),
      it.pap ? h('p', { class: 'pap-note' },
        `セットごとに3分休憩。最後のセットのあと「次:${next ?? '(次の種目なし)'}」と表示します。`) : null);
  }

  let first = true;
  function draw(keepScroll = false) {
    mount(h('div', {},
      h('header', { class: 'topbar' },
        h('button', { class: 'icon-btn', 'aria-label': '戻る', onclick: onBack }, icon('back')),
        h('div', { class: 'topbar-title' }, h('span', { class: 'topbar-h' }, isNew ? 'ルーティンを作る' : 'ルーティンの編集')),
        h('button', { class: 'btn btn-primary', onclick: onSave }, '保存')),
      h('div', { class: 'form', style: { paddingBottom: '0' } },
        h('div', { class: 'field' },
          h('label', { for: 'rt-name' }, '名前'),
          h('input', { id: 'rt-name', class: 'input', value: st.name, placeholder: '例:下半身・パワー', autocomplete: 'off', oninput: (e) => { st.name = e.target.value; touch(); } }))),
      h('div', { class: 'section-head' },
        h('h2', {}, `種目(${st.items.length})`)),
      h('ol', { class: 'stack', style: { listStyle: 'none', margin: 0 } },
        st.items.length ? st.items.map(itemCard) : h('li', { class: 'empty' }, 'まだ種目がありません。')),
      h('div', { class: 'form-actions' },
        h('button', {
          class: 'btn btn-dashed btn-block',
          onclick: () => openPicker({ context: `ルーティン「${st.name.trim() || '新しいルーティン'}」`, onDone: addExercises }),
        }, '+ 種目を追加'),
        h('p', { class: 'hint' }, 'PAP:重い種目に付けると、休憩が3分になります。並び順で次に行う種目(例:加重懸垂 → 自重懸垂)を決めます。'),
        !isNew ? h('button', { class: 'btn btn-danger btn-block', onclick: onDelete }, 'このルーティンを削除') : null),
    ), { showNav: false, keepScroll: keepScroll && !first });
    first = false;
  }

  draw();
}
