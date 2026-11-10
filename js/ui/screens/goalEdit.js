// 目標の作成・編集
import { h, icon, mount, toast, formatDateShort } from '../dom.js';
import {
  getGoal, saveGoal, deleteGoal, listExercises, getExerciseMap, localDate,
  getGoalBest, getGoalHistory, setNextGoal,
} from '../../db/repo.js';
import { parseNumber, goalProgress } from '../../domain/calc.js';
import { openOverlay } from '../components/overlay.js';
import { miniChart } from '../components/miniChart.js';
import { BODY_PARTS } from '../../domain/recordTypes.js';
import { GOAL_UNITS, fmtGoalValue } from '../goalFormat.js';
import { back } from '../../router.js';

const METRICS = [
  { key: 'manual', label: '手入力' },
  { key: 'trial', label: '試技' },
  { key: 'e1rm', label: '推定1RM' },
  { key: 'bodyweight', label: '体重' },
];
const E1RM_TYPES = ['weight_reps', 'bw_plus', 'bw_minus'];

export async function renderGoalEdit({ params }) {
  const isNew = !params.id;
  const existing = isNew ? null : await getGoal(params.id);
  if (!isNew && !existing) {
    toast('目標が見つかりません');
    back('/metrics');
    return;
  }
  const exMap = await getExerciseMap();
  const visible = await listExercises();
  const trialExercises = [...exMap.values()].filter((e) => e.recordType === 'trials' && (!e.hidden || e.id === existing?.metric?.exerciseId));
  const e1rmExercises = visible.filter((e) => E1RM_TYPES.includes(e.recordType));
  if (existing?.metric?.exerciseId && !e1rmExercises.some((e) => e.id === existing.metric.exerciseId)) {
    const ex = exMap.get(existing.metric.exerciseId);
    if (ex && E1RM_TYPES.includes(ex.recordType)) e1rmExercises.push(ex);
  }

  // 画面の状態(入力中は文字のまま持ち、保存時に数値へ直す)
  const st = existing ? {
    title: existing.title || '',
    metricType: existing.metric?.type || 'manual',
    exerciseId: existing.metric?.exerciseId || '',
    stat: existing.metric?.stat || 'best',
    target: existing.target != null ? fmtGoalValue(existing.target, existing.unit) : '',
    unit: existing.unit || '秒',
    direction: existing.direction || 'higher',
    deadline: existing.deadline || '',
    bestValue: existing.manualBest?.value != null ? fmtGoalValue(existing.manualBest.value, existing.unit) : '',
    bestDate: existing.manualBest?.date || '',
    pinned: !!existing.pinned,
  } : {
    title: '', metricType: 'manual', exerciseId: '', stat: 'best',
    target: '', unit: '秒', direction: 'lower', deadline: '', bestValue: '', bestDate: '',
    pinned: true,
  };

  function setMetric(type) {
    st.metricType = type;
    if (type === 'trial') {
      if (!trialExercises.some((e) => e.id === st.exerciseId)) st.exerciseId = trialExercises[0]?.id || '';
      st.unit = exMap.get(st.exerciseId)?.unit || 'm';
      st.direction = 'higher';
    } else if (type === 'e1rm') {
      if (!e1rmExercises.some((e) => e.id === st.exerciseId)) st.exerciseId = e1rmExercises[0]?.id || '';
      st.unit = 'kg';
      st.direction = 'higher';
    } else if (type === 'bodyweight') {
      st.exerciseId = '';
      st.unit = 'kg';
    } else {
      st.exerciseId = '';
      if (!GOAL_UNITS.includes(st.unit)) st.unit = '秒';
      st.direction = st.unit === '秒' ? 'lower' : 'higher';
    }
    render();
  }

  function autoTitle() {
    const ex = exMap.get(st.exerciseId);
    if (st.metricType === 'trial') return ex ? `${ex.name}${st.stat === 'average' ? '(平均)' : ''}` : '';
    if (st.metricType === 'e1rm') return ex ? `${ex.name} 推定1RM` : '';
    if (st.metricType === 'bodyweight') return '体重';
    return '';
  }

  async function onSave(e) {
    e.preventDefault();
    const clock = st.unit === '秒';
    const target = parseNumber(st.target, { allowClock: clock });
    const title = st.title.trim() || autoTitle();
    const errors = [];
    if (!title) errors.push('名前を入れてください');
    if (target == null) errors.push(clock ? '目標値を数字で入れてください(例 30.00 や 1:02.50)' : '目標値を数字で入れてください');
    if ((st.metricType === 'trial' || st.metricType === 'e1rm') && !st.exerciseId) errors.push('種目を選んでください');
    let manualBest = null;
    if (st.metricType !== 'bodyweight' && st.bestValue.trim()) {
      const v = parseNumber(st.bestValue, { allowClock: clock });
      if (v == null) errors.push('ベストを数字で入れてください');
      else manualBest = { value: v, date: st.bestDate || null };
    }
    if (errors.length) { toast(errors[0]); return; }

    await saveGoal({
      ...(existing || {}),
      title,
      metric: {
        type: st.metricType,
        exerciseId: st.exerciseId || null,
        stat: st.metricType === 'trial' ? st.stat : null,
      },
      target,
      unit: st.unit,
      direction: st.direction,
      deadline: st.deadline || null,
      manualBest,
      pinned: st.pinned,
    });
    toast(isNew ? '目標を作りました' : '目標を保存しました');
    back('/metrics');
  }

  async function onDelete() {
    if (!confirm(`目標「${existing.title}」を削除しますか?`)) return;
    await deleteGoal(existing.id);
    toast('削除しました');
    back('/metrics');
  }

  /* ---------- 部品 ---------- */

  const field = (label, control, hint) => h('div', { class: 'field' },
    h('label', { for: control.id }, label), control, hint ? h('p', { class: 'hint' }, hint) : null);

  const textInput = (id, key, props = {}) => h('input', {
    id, class: 'input', value: st[key], autocomplete: 'off',
    oninput: (e) => { st[key] = e.target.value; }, ...props,
  });

  function segmented(label, options, key, onPick) {
    return h('div', { class: 'field' },
      h('span', { class: 'label', id: `seg-${key}` }, label),
      h('div', { class: 'segmented', role: 'radiogroup', 'aria-labelledby': `seg-${key}` },
        options.map((o) => h('button', {
          type: 'button', role: 'radio', 'aria-checked': String(st[key] === o.key),
          onclick: () => (onPick ? onPick(o.key) : (st[key] = o.key, render())),
        }, o.label))));
  }

  function exerciseSelect(list) {
    const groups = BODY_PARTS.map((bp) => [bp, list.filter((e) => e.bodyPart === bp)]).filter(([, l]) => l.length);
    const sel = h('select', {
      id: 'goal-ex', class: 'select',
      onchange: (e) => {
        st.exerciseId = e.target.value;
        if (st.metricType === 'trial') st.unit = exMap.get(st.exerciseId)?.unit || st.unit;
        render();
      },
    }, groups.map(([bp, l]) => h('optgroup', { label: bp },
      l.map((e) => h('option', { value: e.id, selected: e.id === st.exerciseId }, e.name)))));
    return field('種目', sel);
  }

  /* ---------- 描画 ---------- */

  /* ---------- 目標の推移と「次の目標を立てる」 ---------- */
  let historySection = null;
  if (existing) {
    const today = localDate();
    const [best, hist] = await Promise.all([getGoalBest(existing), getGoalHistory(existing)]);
    const unit = existing.unit || '';
    const lower = existing.direction === 'lower';
    const achieved = goalProgress(existing, best, today).achieved;
    const f = (v) => fmtGoalValue(v, unit);
    const RESULT = { achieved: '達成', changed: '変更' };

    const openNext = () => openOverlay({
      title: '次の目標を立てる',
      subtitle: existing.title,
      render(api) {
        const clock = unit === '秒';
        const tIn = h('input', { id: 'next-target', class: 'input num-input', inputmode: clock ? 'text' : 'decimal', placeholder: f(existing.target) });
        const dIn = h('input', { id: 'next-deadline', class: 'input', type: 'date', min: today });
        return h('form', {
          class: 'form', novalidate: true,
          onsubmit: async (e) => {
            e.preventDefault();
            const v = parseNumber(tIn.value, { allowClock: clock });
            if (v == null) { toast('新しい目標値を数字で入れてください'); return; }
            await setNextGoal(existing.id, { target: v, deadline: dIn.value || null });
            toast(achieved ? '達成した目標を記録して、次の目標を立てました' : 'いまの目標を「変更」として記録して、次の目標を立てました');
            api.close();
            renderGoalEdit({ params });
          },
        },
        h('p', { class: 'hint' }, achieved
          ? `いまの目標 ${f(existing.target)}${unit} は「達成」として推移に残ります。`
          : `いまの目標 ${f(existing.target)}${unit} はまだ届いていないので、「変更」として推移に残ります。`),
        h('div', { class: 'row2' },
          h('div', { class: 'field' }, h('label', { for: 'next-target' }, `新しい目標値(${unit})`), tIn),
          h('div', { class: 'field' }, h('label', { for: 'next-deadline' }, '期限(なくてもよい)'), dIn)),
        clock ? h('p', { class: 'hint', style: { marginTop: '-10px' } }, '1分を超えるタイムは 1:02.50 のように入れられます') : null,
        h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, '次の目標にする'));
      },
    });

    // いまの目標は期限まで(期限がなければ今日まで)線を引き、どこまで先を見た目標かが分かるようにする
    const steps = hist.targets.filter((t) => t.value != null).map((t) => ({ from: t.setOn, to: t.endedOn || (t.deadline && t.deadline > today ? t.deadline : null), value: t.value, result: t.result }));
    historySection = h('div', { class: 'stack', style: { marginBottom: '6px' } },
      achieved ? h('div', { class: 'achieved-banner' },
        h('span', {}, `目標 ${f(existing.target)}${unit} を達成しています`),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: openNext }, '次の目標を立てる')) : null,
      h('section', { class: 'card trial-card', 'aria-label': '目標の推移' },
        h('div', { class: 'trial-head' }, h('h2', {}, '目標の推移'),
          h('span', { class: 'label' }, lower ? '上ほど速い(小さい)' : '上ほど大きい')),
        miniChart({
          points: hist.bests.map((b) => ({ date: b.date, value: b.value })), steps, today,
          better: lower ? 'lower' : 'higher', format: f, label: '目標値とベストの推移',
        }),
        h('p', { class: 'hint' }, '破線が目標値(○は達成)、オレンジの点と線がベスト。'),
        h('div', { class: 'trial-past' },
          hist.targets.slice().reverse().map((t) => h('div', { class: 'target-row' },
            h('span', {}, `${formatDateShort(t.setOn)}〜${t.endedOn ? formatDateShort(t.endedOn) : 'いま'}`),
            h('span', { class: 'num' }, `${f(t.value)}${unit}`),
            h('span', { class: `tag-mini${t.result === 'achieved' ? ' accent' : ''}` }, t.result ? RESULT[t.result] : (t.deadline ? `期限 ${formatDateShort(t.deadline)}` : 'いまの目標'))))),
        !achieved ? h('button', { class: 'btn btn-ghost btn-block', type: 'button', onclick: openNext }, '次の目標を立てる(目標を変える)') : null),
      h('p', { class: 'hint', style: { padding: '0 4px' } }, '下の欄で目標値を書き換えると、いまの目標の訂正になります(推移には残りません)。'));
  }

  let firstRender = true;
  function render() {
    const clock = st.unit === '秒';
    const numProps = { inputmode: clock ? 'text' : 'decimal', class: 'input num-input' };
    const unitFixed = st.metricType !== 'manual';
    const auto = autoTitle();

    const form = h('form', { class: 'form', onsubmit: onSave, novalidate: true },
      field('名前', textInput('goal-title', 'title', { placeholder: auto || '例:長水路 50m自由形', enterkeyhint: 'next' }),
        auto ? '空のままなら上の例の名前になります' : null),

      segmented('何で測るか', METRICS, 'metricType', setMetric),

      st.metricType === 'trial' ? [
        exerciseSelect(trialExercises),
        segmented('どの値で比べるか', [{ key: 'best', label: '最高' }, { key: 'average', label: '平均' }], 'stat'),
      ] : null,
      st.metricType === 'e1rm' ? [
        exerciseSelect(e1rmExercises),
        h('p', { class: 'hint', style: { marginTop: '-10px' } }, '10回以下のセットから計算します。加重懸垂は体重+加重で計算します。'),
      ] : null,

      h('div', { class: 'row2' },
        field('目標値', textInput('goal-target', 'target', { ...numProps, placeholder: clock ? '30.00' : '0' })),
        unitFixed
          ? h('div', { class: 'field' }, h('span', { class: 'label' }, '単位'),
            h('div', { class: 'input', style: { display: 'flex', alignItems: 'center', color: 'var(--muted)' } }, st.unit))
          : field('単位', h('select', {
            id: 'goal-unit', class: 'select',
            onchange: (e) => { st.unit = e.target.value; st.direction = st.unit === '秒' ? 'lower' : st.direction; render(); },
          }, GOAL_UNITS.map((u) => h('option', { value: u, selected: u === st.unit }, u))))),
      clock ? h('p', { class: 'hint', style: { marginTop: '-10px' } }, '1分を超えるタイムは 1:02.50 のように入れられます') : null,

      st.metricType === 'manual' || st.metricType === 'bodyweight'
        ? segmented('良い方向', [{ key: 'lower', label: '小さいほど良い' }, { key: 'higher', label: '大きいほど良い' }], 'direction')
        : null,

      field('期限(なくてもよい)', textInput('goal-deadline', 'deadline', { type: 'date', min: localDate() })),

      st.metricType !== 'bodyweight' ? h('div', { class: 'row2' },
        field('ベスト(なくてもよい)', textInput('goal-best', 'bestValue', { ...numProps, placeholder: '—' })),
        field('その日付', textInput('goal-best-date', 'bestDate', { type: 'date', max: localDate() }))) : null,
      st.metricType === 'trial' || st.metricType === 'e1rm'
        ? h('p', { class: 'hint', style: { marginTop: '-10px' } }, '記録からもベストを出し、良い方をホームに表示します。')
        : st.metricType === 'bodyweight'
          ? h('p', { class: 'hint', style: { marginTop: '-10px' } }, 'ホームには最新の体重を表示します。')
          : null,

      h('label', { class: 'switch-row' },
        h('span', {}, 'ホーム上部に表示'),
        h('span', { class: 'switch' },
          h('input', { type: 'checkbox', checked: st.pinned, onchange: (e) => { st.pinned = e.target.checked; } }),
          h('span', {}))),
      h('p', { class: 'hint', style: { marginTop: '-10px' } }, '上部に表示する目標が複数あるときは、ホームで左右にスワイプして切り替えます。'),

      h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, isNew ? '目標を作る' : '保存'),
      !isNew ? h('button', { class: 'btn btn-danger btn-block', type: 'button', onclick: onDelete }, 'この目標を削除') : null,
    );

    mount(h('div', {},
      h('header', { class: 'topbar' },
        h('button', { class: 'icon-btn', 'aria-label': '戻る', onclick: () => back('/metrics') }, icon('back')),
        h('div', { class: 'topbar-title' }, h('span', { class: 'topbar-h' }, isNew ? '目標を作る' : '目標の編集'))),
      historySection,
      form,
      h('div', { style: { height: '24px' } })), { showNav: false, keepScroll: !firstRender });
    firstRender = false;
  }

  render();
}
