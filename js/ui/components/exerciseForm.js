// 種目の登録・編集(重ねるパネルで開く)
import { h, toast } from '../dom.js';
import { openOverlay } from './overlay.js';
import { saveExercise, deleteExercise, listGear } from '../../db/repo.js';
import { RECORD_TYPES, RECORD_TYPE_KEYS, BODY_PARTS, EQUIPMENT, SWIM_TAGS, DEFAULT_REST_SEC } from '../../domain/recordTypes.js';
import { parseNumber } from '../../domain/calc.js';

export const REST_OPTIONS = [30, 45, 60, 90, 120, 180, 240, 300];
export function restLabel(sec) {
  if (sec == null) return '—';
  if (sec < 60) return `${sec}秒`;
  return sec % 60 ? `${Math.floor(sec / 60)}分${sec % 60}秒` : `${sec / 60}分`;
}

/**
 * exercise を渡すと編集、渡さないと新規登録。defaults で初期値(部位など)を渡せる。
 * onSaved(exercise | null) は保存・削除の後に呼ぶ(削除時は null)
 */
export async function openExerciseForm({ exercise = null, defaults = {}, onSaved }) {
  const gear = await listGear();
  const isNew = !exercise;
  const st = {
    name: exercise?.name ?? defaults.name ?? '',
    bodyPart: exercise?.bodyPart ?? defaults.bodyPart ?? BODY_PARTS[0],
    equipment: exercise?.equipment ?? defaults.equipment ?? 'ダンベル',
    recordType: exercise?.recordType ?? 'weight_reps',
    unilateral: exercise?.unilateral ?? false,
    increment: exercise?.increment != null ? String(exercise.increment) : '2.5',
    restSec: exercise?.restSec ?? DEFAULT_REST_SEC,
    swim: [...(exercise?.swim ?? defaults.swim ?? [])],
    favorite: exercise?.favorite ?? defaults.favorite ?? false,
    gearId: exercise?.gearId ?? '',
    unit: exercise?.unit ?? 'cm',
    hidden: exercise?.hidden ?? false,
  };

  openOverlay({
    title: isNew ? '種目を登録' : '種目の編集',
    render(api) {
      const wrap = h('div', {});
      const draw = () => wrap.replaceChildren(form(api));
      const sel = (id, key, options, onchange) => h('select', {
        id, class: 'select',
        onchange: (e) => { st[key] = e.target.value; onchange?.(); },
      }, options.map(([v, label]) => h('option', { value: v, selected: String(st[key]) === String(v) }, label)));
      const field = (label, control, hint) => h('div', { class: 'field' },
        h('label', { for: control.id }, label), control, hint ? h('p', { class: 'hint' }, hint) : null);
      const sw = (label, key) => h('label', { class: 'switch-row' }, h('span', {}, label),
        h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: st[key], onchange: (e) => { st[key] = e.target.checked; } }), h('span', {})));

      function form() {
        const usesWeight = ['weight_reps', 'bw_plus', 'bw_minus'].includes(st.recordType);
        return h('form', { class: 'form', novalidate: true, onsubmit: (e) => { e.preventDefault(); save(api); } },
          field('名前', h('input', { id: 'ex-name', class: 'input', value: st.name, autocomplete: 'off', placeholder: '例:スミス・ランジ', oninput: (e) => { st.name = e.target.value; } })),
          h('div', { class: 'row2' },
            field('部位', sel('ex-part', 'bodyPart', BODY_PARTS.map((b) => [b, b]))),
            field('器具', sel('ex-equip', 'equipment', EQUIPMENT.map((b) => [b, b])))),
          field('記録の型', sel('ex-type', 'recordType', RECORD_TYPE_KEYS.map((k) => [k, RECORD_TYPES[k].label]), draw)),
          st.recordType === 'weight_reps'
            ? field('使うバー(重さの内訳に使う)', sel('ex-gear', 'gearId', [['', 'なし(合計だけ入れる)'], ...gear.map((g) => [g.id, `${g.name}(${g.barWeight}kg)`])]))
            : null,
          st.recordType === 'trials' ? field('単位', sel('ex-unit', 'unit', [['cm', 'cm'], ['m', 'm'], ['m/s', 'm/s(速度)']])) : null,
          h('div', { class: 'field' },
            h('span', { class: 'label' }, '水泳の目的(いくつでも)'),
            h('div', { class: 'chips', style: { padding: 0, flexWrap: 'wrap' } },
              Object.entries(SWIM_TAGS).map(([k, label]) => h('button', {
                type: 'button', class: 'chip swim-chip', 'aria-pressed': String(st.swim.includes(k)),
                onclick: (e) => {
                  st.swim = st.swim.includes(k) ? st.swim.filter((x) => x !== k) : [...st.swim, k];
                  e.currentTarget.setAttribute('aria-pressed', String(st.swim.includes(k)));
                },
              }, label)))),
          usesWeight ? field('重さの刻み(kg)', h('input', { id: 'ex-inc', class: 'input num-input', inputmode: 'decimal', value: st.increment, oninput: (e) => { st.increment = e.target.value; } }),
            '重さのボタン(−/+)が、この刻みで増減します。') : null,
          sw('片側で行える', 'unilateral'),
          sw('お気に入り', 'favorite'),
          !isNew ? sw('非表示にする', 'hidden') : null,
          h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, isNew ? '登録する' : '保存'),
          !isNew && !exercise.builtin
            ? h('button', { class: 'btn btn-danger btn-block', type: 'button', onclick: () => remove(api) }, 'この種目を削除')
            : null,
          !isNew && exercise.builtin ? h('p', { class: 'hint' }, '最初から入っている種目は削除できません。使わないときは「非表示にする」をオンにしてください。') : null,
        );
      }
      draw();
      return wrap;
    },
  });

  async function save(api) {
    const name = st.name.trim();
    if (!name) { toast('名前を入れてください'); return; }
    const inc = parseNumber(st.increment);
    const saved = await saveExercise({
      ...(exercise || {}),
      name,
      bodyPart: st.bodyPart,
      equipment: st.equipment,
      recordType: st.recordType,
      unilateral: st.unilateral,
      increment: ['weight_reps', 'bw_plus', 'bw_minus'].includes(st.recordType) ? (inc && inc > 0 ? inc : 2.5) : null,
      restSec: Number(st.restSec),
      gearId: st.recordType === 'weight_reps' ? (st.gearId || null) : null,
      unit: st.recordType === 'trials' ? st.unit : null,
      favorite: st.favorite,
      swim: st.swim,
      hidden: st.hidden,
      order: exercise?.order ?? 10000,
    });
    toast(isNew ? '種目を登録しました' : '保存しました');
    api.close();
    onSaved?.(saved);
  }

  async function remove(api) {
    if (!confirm(`「${exercise.name}」を削除しますか?過去の記録は残ります。`)) return;
    await deleteExercise(exercise.id);
    toast('削除しました');
    api.close();
    onSaved?.(null);
  }
}
