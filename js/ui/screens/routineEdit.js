// ルーティンの作成・編集
// 種目ごとに「セットごとの予定(重さ・回数・休憩)」、□PAP、次の種目とのつなぎ(スーパーセット・PAP ペア)
import { h, icon, mount, toast } from '../dom.js';
import { openPicker } from '../components/picker.js';
import { openReorder } from '../components/reorder.js';
import { actionSheet } from '../components/overlay.js';
import { openValuePad, openRestPicker, cellButton, stepsFor, restShort } from '../components/pads.js';
import {
  getRoutine, saveRoutine, deleteRoutine, listRoutines, getExerciseMap, newRoutineItem,
  normalizeLinks, LINK_TYPES,
} from '../../db/repo.js';
import { recordTypeLabel, PAP_REST_SEC } from '../../domain/recordTypes.js';
import { FIELD_META, TYPE_FIELDS } from '../setFormat.js';
import { back } from '../../router.js';

export async function renderRoutineEdit({ params }) {
  const isNew = !params.id;
  const existing = isNew ? null : await getRoutine(params.id);
  if (!isNew && !existing) { toast('ルーティンが見つかりません'); back('/home'); return; }
  let exMap = await getExerciseMap();

  const st = {
    name: existing?.name ?? '',
    items: (existing?.items ?? []).map((it) => ({ ...it, setPlans: (it.setPlans || []).map((p) => ({ ...p })) })),
  };
  let dirty = false;
  const touch = () => { dirty = true; };

  /** 種目を足す。at を渡すとその位置に入れる(省略で一番下) */
  async function addExercises(ids, at = null) {
    exMap = await getExerciseMap();
    const added = ids.map((id) => exMap.get(id)).filter(Boolean).map((ex) => newRoutineItem(ex));
    if (at == null) st.items.push(...added);
    else {
      const prev = st.items[at - 1];
      if (prev?.link) { prev.link = null; toast('つないでいた種目の間に入れたので、つなぎを外しました'); }
      st.items.splice(at, 0, ...added);
    }
    touch();
    draw(true);
  }

  /** 種目を別の種目に変える(セット数・回数・休憩は残し、重さなどは空にして前回の値を使う) */
  function changeExercise(it) {
    openPicker({
      single: true,
      title: '変更する種目を選ぶ',
      context: `${exMap.get(it.exerciseId)?.name ?? ''} から変更`,
      onDone: async ([id]) => {
        if (!id || id === it.exerciseId) return;
        exMap = await getExerciseMap();
        const ex = exMap.get(id);
        if (!ex) return;
        if (ex.recordType === 'trials') it.setPlans = [];
        else if (!it.setPlans.length) it.setPlans = newRoutineItem(ex).setPlans;
        else it.setPlans = it.setPlans.map((p) => ({ warmup: !!p.warmup, restSec: p.restSec, ...(p.reps != null && ex.recordType !== 'time' && ex.recordType !== 'distance_band' ? { reps: p.reps } : {}) }));
        it.exerciseId = id;
        toast(`${ex.name}に変更しました`);
        touch(); draw(true);
      },
    });
  }

  async function onSave() {
    const name = st.name.trim();
    if (!name) { toast('ルーティンの名前を入れてください'); document.getElementById('rt-name')?.focus(); return; }
    const order = existing?.order ?? (await listRoutines()).length + 1;
    await saveRoutine({ ...(existing || {}), name, items: normalizeLinks(st.items), order });
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

  function reorder() {
    openReorder({
      title: '種目の並べ替え',
      rows: st.items.map((it) => {
        const ex = exMap.get(it.exerciseId);
        return { key: it.key, label: ex?.name ?? '(削除された種目)', sub: `${it.setPlans.length}セット${it.pap ? ' · PAP' : ''}` };
      }),
      onDone: (keys) => {
        const byKey = new Map(st.items.map((it) => [it.key, it]));
        const before = st.items.filter((it) => it.link).length;
        st.items = normalizeLinks(keys.map((k) => byKey.get(k)));
        const after = st.items.filter((it) => it.link).length;
        if (after < before) toast('並びが変わったので、離れた種目のつなぎを外しました');
        touch(); draw(true);
      },
    });
  }

  /* ---------- 種目のメニュー ---------- */
  function itemMenu(it, i) {
    const ex = exMap.get(it.exerciseId);
    actionSheet({
      title: ex?.name,
      actions: [
        { label: '種目を変更する', onSelect: () => changeExercise(it) },
        ex?.recordType !== 'trials' && !it.pap && { label: '休憩をまとめて変える', onSelect: () => openRestPicker({
          title: `${ex?.name} のすべてのセットの休憩`, value: it.restSec,
          onDone: (s) => { it.restSec = s; it.setPlans.forEach((p) => { p.restSec = s; }); touch(); draw(true); },
        }) },
        { label: 'この種目を外す', danger: true, onSelect: () => {
          if (i > 0 && st.items[i - 1].link) st.items[i - 1].link = null;
          st.items.splice(i, 1); touch(); draw(true);
        } },
      ],
    });
  }

  function setPap(it, on) {
    it.pap = on;
    if (on) it.setPlans.forEach((p) => { if (!p.warmup) p.restSec = PAP_REST_SEC; });
    touch();
  }

  /* ---------- 次の種目とのつなぎ ---------- */
  function linkControl(it, next) {
    const pick = () => actionSheet({
      title: '次の種目とのつなぎ方',
      actions: [
        { label: 'スーパーセット(交互に行い、2つ目のあとに休憩)', onSelect: () => { it.link = { type: 'superset', toKey: next.key }; touch(); draw(true); } },
        { label: 'PAP ペア(重い種目を3分休憩で行い、そのあと次の種目)', onSelect: () => { it.link = { type: 'pap', toKey: next.key }; setPap(it, true); draw(true); } },
        it.link && { label: 'つなぎを外す', danger: true, onSelect: () => { it.link = null; touch(); draw(true); } },
      ],
    });
    if (it.link) {
      return h('li', { class: 'link-row' },
        h('button', { class: `link-chip ${it.link.type}`, type: 'button', onclick: pick, 'aria-label': `つなぎ:${LINK_TYPES[it.link.type]}(変更)` },
          icon('link', 16), LINK_TYPES[it.link.type]),
        addHere(it));
    }
    return h('li', { class: 'link-row' },
      h('button', { class: 'link-add', type: 'button', onclick: pick }, '+ 次の種目とつなぐ'),
      addHere(it));
  }

  /** この位置(it のすぐ後ろ)に種目を足すボタン */
  function addHere(it) {
    return h('button', {
      class: 'link-add', type: 'button',
      onclick: () => openPicker({
        context: `${exMap.get(it.exerciseId)?.name ?? ''} のあとに追加`,
        onDone: (ids) => addExercises(ids, st.items.indexOf(it) + 1),
      }),
    }, '+ 種目を追加');
  }

  /* ---------- セットごとの予定 ---------- */
  function planTable(it, ex) {
    const fields = TYPE_FIELDS[ex.recordType] || ['reps'];
    let n = 0;
    const header = h('div', { class: `plan-row head cols-${fields.length}` },
      h('span', {}, 'セット'),
      fields.map((f) => h('span', {}, FIELD_META[f].label)),
      h('span', {}, '休憩'));
    const rows = it.setPlans.map((p, k) => {
      const label = p.warmup ? 'W' : String(++n);
      const papFixed = it.pap && !p.warmup;
      const rest = h('button', {
        type: 'button', class: 'cell-btn rest-btn', 'aria-label': `セット ${label} の休憩 ${restShort(p.restSec ?? it.restSec)}`,
        disabled: papFixed,
        onclick: (e) => {
          const btn = e.currentTarget;
          openRestPicker({
            title: `${ex.name} · セット ${label} のあとの休憩`, value: p.restSec ?? it.restSec,
            onDone: (s) => { p.restSec = s; btn.textContent = restShort(s); touch(); },
          });
        },
      }, restShort(papFixed ? PAP_REST_SEC : (p.restSec ?? it.restSec)));
      return h('div', { class: `plan-row cols-${fields.length}${p.warmup ? ' warm' : ''}` },
        h('button', {
          class: 'set-label', type: 'button', 'aria-label': `セット ${label} のメニュー`,
          onclick: () => actionSheet({
            title: `セット ${label}`,
            actions: [
              { label: p.warmup ? '本番のセットにする' : 'ウォームアップにする', onSelect: () => { p.warmup = !p.warmup; touch(); draw(true); } },
              it.setPlans.length > 1 && { label: 'このセットを削除', danger: true, onSelect: () => { it.setPlans.splice(k, 1); touch(); draw(true); } },
            ],
          }),
        }, label),
        fields.map((f) => (FIELD_META[f].mode === 'text'
          ? h('input', {
            class: 'cell-input text', value: p[f] ?? '', placeholder: '—', 'aria-label': `セット ${label} の${FIELD_META[f].label}`,
            oninput: (e) => { p[f] = e.target.value; touch(); },
          })
          : cellButton({
            value: p[f], label: `セット ${label} の${FIELD_META[f].label}`,
            onOpen: (btn) => {
              // 空の欄は、前のセットの値から始める
              const prev = it.setPlans.slice(0, k).reverse().find((x) => x[f] != null);
              openValuePad({
                title: `${ex.name} · セット ${label} · ${FIELD_META[f].label}`,
                value: p[f], start: prev?.[f] ?? null, steps: stepsFor(f, ex.increment, ex.equipment), anchor: btn,
                onChange: (v) => { p[f] = v; btn.setValue(v); touch(); },
              });
            },
          }))),
        rest);
    });
    const copyLast = (warmup) => {
      const base = warmup ? (it.setPlans.find((p) => p.warmup) || {}) : (it.setPlans.filter((p) => !p.warmup).slice(-1)[0] || {});
      const p = { ...base, warmup, restSec: it.pap && !warmup ? PAP_REST_SEC : (base.restSec ?? it.restSec) };
      if (warmup) {
        const firstWork = it.setPlans.findIndex((x) => !x.warmup);
        it.setPlans.splice(firstWork < 0 ? it.setPlans.length : firstWork, 0, p);
      } else it.setPlans.push(p);
      touch(); draw(true);
    };
    return [
      h('div', { class: 'plan-table' }, header, rows),
      h('p', { class: 'hint' }, '空の欄は、記録するときに前回の値が入ります。'),
      h('div', { class: 'card-actions' },
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => copyLast(false) }, '+ セット'),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => copyLast(true) }, '+ ウォームアップ')),
    ];
  }

  function itemCard(it, i) {
    const ex = exMap.get(it.exerciseId);
    const name = ex?.name ?? '(削除された種目)';
    const prevLinked = i > 0 && st.items[i - 1].link;
    return h('li', { class: `item-card${it.pap ? ' pap' : ''}${it.link || prevLinked ? ' linked' : ''}` },
      h('div', { class: 'item-head' },
        h('span', { class: 'order' }, String(i + 1)),
        h('div', { class: 'info' },
          h('span', { class: 'name' }, name),
          h('span', { class: 'meta' }, ex ? `${ex.bodyPart} · ${ex.equipment} · ${recordTypeLabel(ex.recordType)}` : '')),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': `${name}のメニュー`, onclick: () => itemMenu(it, i) }, icon('more'))),
      ex && ex.recordType !== 'trials' ? planTable(it, ex) : h('p', { class: 'hint' }, '試技の本数と値は、記録するときに入れます。'),
      ex && ex.recordType !== 'trials' ? h('button', {
        class: 'pap-toggle', type: 'button', 'aria-pressed': String(!!it.pap), style: { alignSelf: 'flex-start' },
        onclick: () => { setPap(it, !it.pap); draw(true); },
      }, h('span', { class: 'box' }, it.pap ? icon('check', 14, 3) : null), 'PAP(休憩3分)') : null);
  }

  let first = true;
  function draw(keepScroll = false) {
    const list = [];
    st.items.forEach((it, i) => {
      list.push(itemCard(it, i));
      if (i < st.items.length - 1) list.push(linkControl(it, st.items[i + 1]));
    });
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
        h('h2', {}, `種目(${st.items.length})`),
        st.items.length > 1 ? h('button', { class: 'link-btn', type: 'button', onclick: reorder }, icon('sort', 16), ' 並べ替え') : null),
      h('ol', { class: 'stack routine-list', style: { listStyle: 'none', margin: 0 } },
        st.items.length ? list : h('li', { class: 'empty' }, 'まだ種目がありません。')),
      h('div', { class: 'form-actions' },
        h('button', {
          class: 'btn btn-dashed btn-block',
          onclick: () => openPicker({ context: `ルーティン「${st.name.trim() || '新しいルーティン'}」`, onDone: addExercises }),
        }, '+ 種目を追加'),
        h('p', { class: 'hint' }, 'PAP:重い種目に付けると、本番のセットの休憩が3分になります。種目の間の「+ 次の種目とつなぐ」で、スーパーセットや PAP ペアにできます。'),
        !isNew ? h('button', { class: 'btn btn-danger btn-block', onclick: onDelete }, 'このルーティンを削除') : null),
    ), { showNav: false, keepScroll: keepScroll && !first, redraw: !first });
    first = false;
  }

  draw();
}
