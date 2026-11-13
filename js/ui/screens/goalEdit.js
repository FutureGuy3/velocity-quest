// 目標の作成・編集
import { h, icon, mount, toast, formatDateShort } from '../dom.js';

/** 2026-10-15 → 2026/10/15(過去の記録は年もわかるように) */
const formatDateJaShort = (d) => d.replace(/-/g, '/');
import {
  getGoal, saveGoal, deleteGoal, listExercises, getExerciseMap, localDate,
  getGoalBest, getGoalHistory, setNextGoal, saveGoalTargets, saveGoalBestLog, listSeries, listAllSwimTimes,
} from '../../db/repo.js';
import { parseNumber, goalProgress, formatSeconds } from '../../domain/calc.js';
import { openOverlay } from '../components/overlay.js';
import { miniChart } from '../components/miniChart.js';
import { BODY_PARTS } from '../../domain/recordTypes.js';
import { GOAL_UNITS, fmtGoalValue } from '../goalFormat.js';
import { back } from '../../router.js';
import { CONDITIONS, SWIM_GOAL_DEFAULT, swimGoalName, matchesSwimGoal, normalizeConditions, optionLabel } from '../../domain/swim.js';

const SWIM_GOAL_DISTANCES = [25, 50, 100, 200, 400, 800, 1500];

const METRICS = [
  { key: 'manual', label: '手入力' },
  { key: 'swim', label: '水泳タイム' },
  { key: 'series', label: '練習の系統' },
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
  const seriesList = await listSeries();
  const swimTimes = await listAllSwimTimes();
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
    seriesId: existing.metric?.seriesId || '',
    swim: { ...SWIM_GOAL_DEFAULT, ...(existing.metric?.type === 'swim' ? existing.metric.swim : {}) },
    stat: existing.metric?.stat || 'best',
    target: existing.target != null ? fmtGoalValue(existing.target, existing.unit) : '',
    unit: existing.unit || '秒',
    direction: existing.direction || 'higher',
    deadline: existing.deadline || '',
    bestValue: existing.manualBest?.value != null ? fmtGoalValue(existing.manualBest.value, existing.unit) : '',
    bestDate: existing.manualBest?.date || '',
    pinned: !!existing.pinned,
  } : {
    title: '', metricType: 'manual', exerciseId: '', seriesId: '', stat: 'best', swim: { ...SWIM_GOAL_DEFAULT },
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
    } else if (type === 'swim') {
      st.exerciseId = '';
      st.unit = '秒';
      st.direction = 'lower';
    } else if (type === 'series') {
      st.exerciseId = '';
      if (!seriesList.some((s) => s.id === st.seriesId)) st.seriesId = seriesList[0]?.id || '';
      st.unit = '秒';
      st.direction = 'lower';
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
    if (st.metricType === 'series') return seriesList.find((s) => s.id === st.seriesId)?.name || '';
    if (st.metricType === 'swim') return swimGoalName(st.swim);
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
    if (st.metricType === 'swim' && !st.swim.timings.length) errors.push('ベストに数える計測方法を1つ以上選んでください');
    if (st.metricType === 'series' && !st.seriesId) errors.push('練習タイムの系統を選んでください(スイム記録でタイムを入れると系統ができます)');
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
        seriesId: st.metricType === 'series' ? st.seriesId : null,
        stat: st.metricType === 'trial' ? st.stat : null,
        swim: st.metricType === 'swim' ? { ...st.swim } : null,
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

  function segmented(label, options, key, onPick, cols = 0) {
    return h('div', { class: 'field' },
      h('span', { class: 'label', id: `seg-${key}` }, label),
      h('div', { class: `segmented${cols ? ' grid' : ''}`, style: cols ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : null, role: 'radiogroup', 'aria-labelledby': `seg-${key}` },
        options.map((o) => h('button', {
          type: 'button', role: 'radio', 'aria-checked': String(st[key] === o.key),
          onclick: () => (onPick ? onPick(o.key) : (st[key] = o.key, render())),
        }, o.label))));
  }

  /** 水泳タイムの目標:距離・泳法・プール・ベストに数える計測方法 */
  function swimFields() {
    const sw = st.swim;
    const opts = (key) => CONDITIONS.find((c) => c.key === key).options;
    const dists = [...new Set([...SWIM_GOAL_DISTANCES, Number(sw.distance)])].sort((a, b) => a - b);
    const chip = (on, label, onclick) => h('button', { type: 'button', class: 'cond-opt', role: 'checkbox', 'aria-checked': String(on), onclick }, label);
    return [
      h('div', { class: 'row2' },
        field('距離', h('select', { id: 'goal-swim-dist', class: 'select', onchange: (e) => { sw.distance = Number(e.target.value); render(); } },
          dists.map((d) => h('option', { value: d, selected: d === Number(sw.distance) }, `${d}m`)))),
        field('泳法', h('select', { id: 'goal-swim-stroke', class: 'select', onchange: (e) => { sw.stroke = e.target.value; render(); } },
          opts('stroke').map(([v, l]) => h('option', { value: v, selected: v === sw.stroke }, l))))),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'プール'),
        h('div', { class: 'cond-opts' }, [['long', '長水路'], ['short', '短水路'], ['any', 'どちらでも']].map(([v, l]) => h('button', {
          type: 'button', class: 'cond-opt', role: 'radio', 'aria-checked': String(sw.pool === v), onclick: () => { sw.pool = v; render(); },
        }, l)))),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'ベストに数える計測方法'),
        h('div', { class: 'cond-opts' }, opts('timing').map(([v, l]) => chip(sw.timings.includes(v), l, () => {
          sw.timings = sw.timings.includes(v) ? sw.timings.filter((x) => x !== v) : [...sw.timings, v];
          render();
        })))),
      h('p', { class: 'hint', style: { marginTop: '-10px' } }, 'スイム記録で、この距離・泳法・プールで選んだ計測方法のタイムからベストを出し、手で入れたベストと速い方を表示します。'),
    ];
  }

  /** 水泳タイムの目標:どのタイムを数え、どれを数えていないか(理由つき)と、ホームに出るベスト */
  function swimCheck() {
    const sw = st.swim;
    const sameEvent = swimTimes.filter((t) => {
      const n = normalizeConditions(t.conditions);
      return Number(n.distance) === Number(sw.distance) && n.stroke === sw.stroke;
    });
    const counted = sameEvent.filter((t) => matchesSwimGoal(t.conditions, sw)).sort((a, b) => a.seconds - b.seconds);
    const reasonOf = (t) => {
      const n = normalizeConditions(t.conditions);
      const r = [];
      if (sw.pool !== 'any' && n.pool !== sw.pool) r.push(`プールが${optionLabel('pool', n.pool)}`);
      if (!sw.timings.includes(n.timing)) r.push(`計測が${optionLabel('timing', n.timing)}`);
      return r.join('、');
    };
    const notCounted = sameEvent.filter((t) => !matchesSwimGoal(t.conditions, sw)).sort((a, b) => b.date.localeCompare(a.date));
    const manual = st.bestValue.trim() ? parseNumber(st.bestValue, { allowClock: true }) : null;
    const rec = counted[0] || null;
    let used = '—';
    if (rec && (manual == null || rec.seconds <= manual)) used = `${formatSeconds(rec.seconds)}秒(スイム記録 ${formatDateShort(rec.date)})`;
    else if (manual != null) used = `${formatSeconds(manual)}秒(手で入れたベスト)`;
    const line = (t, extra) => h('div', { class: 'swim-check-row' },
      h('span', {}, formatDateShort(t.date)), h('span', { class: 'num' }, `${formatSeconds(t.seconds)}秒`), h('span', { class: 'k' }, extra));
    return h('div', { class: 'card swim-check' },
      h('p', { class: 'label' }, 'ホームに出るベスト(保存後)'),
      h('p', { class: 'num', style: { fontSize: '18px', fontWeight: 700 } }, used),
      h('p', { class: 'label', style: { marginTop: '10px' } }, `ベストに数えているタイム(${counted.length}本)`),
      counted.length ? counted.slice(0, 5).map((t) => line(t, `${optionLabel('pool', normalizeConditions(t.conditions).pool)}・${optionLabel('timing', normalizeConditions(t.conditions).timing)}`))
        : h('p', { class: 'hint' }, 'まだありません。'),
      notCounted.length ? [
        h('p', { class: 'label', style: { marginTop: '10px' } }, `同じ距離・泳法で数えていないタイム(${notCounted.length}本)`),
        notCounted.slice(0, 5).map((t) => line(t, reasonOf(t))),
        h('p', { class: 'hint' }, '数えたいときは、上のプールや計測方法のボタンで足すか、スイム記録でそのタイムの条件を直してください。'),
      ] : null);
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

  /* ---------- 目標の推移(さかのぼって入力・修正できる) ---------- */
  let historySection = null;
  if (existing) {
    const today = localDate();
    const [best, hist] = await Promise.all([getGoalBest(existing), getGoalHistory(existing)]);
    const unit = existing.unit || '';
    const lower = existing.direction === 'lower';
    const clock = unit === '秒';
    const achieved = goalProgress(existing, best, today).achieved;
    const f = (v) => fmtGoalValue(v, unit);
    const RESULT = { achieved: '達成', changed: '変更' };
    const reload = () => renderGoalEdit({ params });
    const targets = hist.targets.map((t) => ({ ...t }));
    const bestLog = (existing.bestLog || []).map((x) => ({ ...x }));

    // フォームの部品
    const numIn = (id, value) => h('input', { id, class: 'input num-input', inputmode: clock ? 'text' : 'decimal', value: value == null ? '' : f(value), placeholder: clock ? '30.00' : '' });
    const dateIn = (id, value, opts = {}) => h('input', { id, class: 'input', type: 'date', value: value || '', ...opts });
    const fieldOf = (label, ctrl) => h('div', { class: 'field' }, h('label', { for: ctrl.id }, label), ctrl);
    const readNum = (el) => parseNumber(el.value, { allowClock: clock });
    const resultSeg = (initial) => {
      let v = initial;
      const wrap = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': '結果' });
      const draw = () => wrap.replaceChildren(...[['achieved', '達成'], ['changed', '変更']].map(([k, l]) => h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(v === k), onclick: () => { v = k; draw(); },
      }, l)));
      draw();
      return { el: wrap, get: () => v };
    };
    const clockHint = clock ? h('p', { class: 'hint', style: { marginTop: '-10px' } }, '1分を超えるタイムは 1:02.50 のように入れられます') : null;

    /* 次の目標を立てる(切り替えた日と結果を選べる) */
    const openNext = () => openOverlay({
      title: '次の目標を立てる',
      subtitle: existing.title,
      render(api) {
        const tIn = numIn('next-target', null);
        const onIn = dateIn('next-on', today, { max: today, min: targets[targets.length - 1]?.setOn });
        const dIn = dateIn('next-deadline', '');
        const seg = resultSeg(achieved ? 'achieved' : 'changed');
        return h('form', {
          class: 'form', novalidate: true,
          onsubmit: async (e) => {
            e.preventDefault();
            const v = readNum(tIn);
            if (v == null) { toast('新しい目標値を数字で入れてください'); return; }
            await setNextGoal(existing.id, { target: v, deadline: dIn.value || null, on: onIn.value || today, result: seg.get() });
            toast('次の目標を立てました');
            api.close();
            reload();
          },
        },
        h('div', { class: 'field' }, h('span', { class: 'label' }, `いまの目標 ${f(existing.target)}${unit} の結果`), seg.el),
        fieldOf('切り替えた日(達成・変更した日)', onIn),
        h('div', { class: 'row2' }, fieldOf(`新しい目標値(${unit})`, tIn), fieldOf('期限(なくてもよい)', dIn)),
        clockHint,
        h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, '次の目標にする'));
      },
    });

    /* 目標の履歴を足す・直す・消す(i が null なら過去の目標を足す) */
    const editTarget = (i) => {
      const isAdd = i == null;
      const t = isAdd ? { value: null, setOn: '', endedOn: '', result: 'achieved', deadline: '' } : targets[i];
      const isCurrent = !isAdd && i === targets.length - 1;
      openOverlay({
        title: isAdd ? '過去の目標を足す' : (isCurrent ? 'いまの目標を直す' : '目標の履歴を直す'),
        subtitle: existing.title,
        render(api) {
          const vIn = numIn('t-value', t.value);
          const sIn = dateIn('t-set', t.setOn, { max: today });
          const eIn = dateIn('t-end', t.endedOn, { max: today });
          const dIn = dateIn('t-deadline', t.deadline);
          const seg = resultSeg(t.result || 'achieved');
          return h('form', {
            class: 'form', novalidate: true,
            onsubmit: async (e) => {
              e.preventDefault();
              const value = readNum(vIn);
              if (value == null) { toast('目標値を数字で入れてください'); return; }
              if (!sIn.value) { toast('立てた日を入れてください'); return; }
              if (!isCurrent) {
                if (!eIn.value) { toast('終えた日(達成・変更した日)を入れてください'); return; }
                if (eIn.value < sIn.value) { toast('終えた日は、立てた日と同じか後にしてください'); return; }
              }
              const cur = targets[targets.length - 1];
              if (isAdd && cur && sIn.value > cur.setOn) { toast(`いまの目標(${formatDateShort(cur.setOn)}に立てた)より前の日付で入れてください`); return; }
              const entry = { value, setOn: sIn.value, endedOn: isCurrent ? null : eIn.value, result: isCurrent ? null : seg.get(), deadline: dIn.value || null };
              const next = targets.slice();
              if (isAdd) next.push(entry); else next[i] = entry;
              await saveGoalTargets(existing.id, next);
              toast(isAdd ? '過去の目標を足しました' : '直しました');
              api.close();
              reload();
            },
          },
          isAdd ? h('p', { class: 'hint' }, '例:5月に立てて10月に達成した目標。いまの目標より前に立てた日付で入れます。') : null,
          h('div', { class: 'row2' }, fieldOf(`目標値(${unit})`, vIn), fieldOf('期限(なくてもよい)', dIn)),
          clockHint,
          h('div', { class: 'row2' },
            fieldOf('立てた日', sIn),
            isCurrent ? h('div', { class: 'field' }, h('span', { class: 'label' }, '終えた日'), h('p', { class: 'hint', style: { minHeight: '44px', display: 'flex', alignItems: 'center' } }, 'いまの目標です')) : fieldOf('終えた日', eIn)),
          !isCurrent ? h('div', { class: 'field' }, h('span', { class: 'label' }, '結果'), seg.el) : null,
          h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, isAdd ? '足す' : '保存'),
          !isAdd && targets.length > 1 ? h('button', {
            class: 'btn btn-danger btn-block', type: 'button',
            onclick: async () => {
              if (!confirm(`${f(t.value)}${unit} の目標を履歴から消しますか?`)) return;
              await saveGoalTargets(existing.id, targets.filter((_, k) => k !== i));
              toast('消しました'); api.close(); reload();
            },
          }, 'この目標を履歴から消す') : null);
        },
      });
    };

    /* 手で入れたベストを足す・直す・消す(i が null なら過去のベストを足す) */
    const editBest = (i) => {
      const isAdd = i == null;
      const x = isAdd ? { value: null, date: '' } : bestLog[i];
      openOverlay({
        title: isAdd ? '過去のベストを足す' : 'ベストの記録を直す',
        subtitle: existing.title,
        render(api) {
          const vIn = numIn('b-value', x.value);
          const dIn = dateIn('b-date', x.date, { max: today });
          return h('form', {
            class: 'form', novalidate: true,
            onsubmit: async (e) => {
              e.preventDefault();
              const v = readNum(vIn);
              if (v == null) { toast('ベストを数字で入れてください'); return; }
              if (!dIn.value) { toast('日付を入れてください'); return; }
              const next = bestLog.slice();
              const entry = { value: v, date: dIn.value };
              if (isAdd) next.push(entry); else next[i] = entry;
              await saveGoalBestLog(existing.id, next);
              toast(isAdd ? 'ベストを足しました' : '直しました');
              api.close();
              reload();
            },
          },
          h('div', { class: 'row2' }, fieldOf(`ベスト(${unit})`, vIn), fieldOf('出した日', dIn)),
          clockHint,
          h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, isAdd ? '足す' : '保存'),
          !isAdd ? h('button', {
            class: 'btn btn-danger btn-block', type: 'button',
            onclick: async () => {
              if (!confirm(`${formatDateShort(x.date)} の ${f(x.value)}${unit} を消しますか?`)) return;
              await saveGoalBestLog(existing.id, bestLog.filter((_, k) => k !== i));
              toast('消しました'); api.close(); reload();
            },
          }, 'この記録を消す') : null);
        },
      });
    };

    const steps = targets.filter((t) => t.value != null).map((t) => ({
      // いまの目標は期限まで(期限がなければ今日まで)線を引く
      from: t.setOn, to: t.endedOn || (t.deadline && t.deadline > today ? t.deadline : null), value: t.value, result: t.result,
    }));
    const showBestLog = existing.metric?.type !== 'bodyweight';

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
        h('p', { class: 'hint' }, '破線が目標値(○は達成)、オレンジの点と線がベスト。行を押すと直せます。'),
        h('div', { class: 'trial-past' },
          targets.map((t, i) => ({ t, i })).reverse().map(({ t, i }) => h('button', {
            class: 'target-row', type: 'button', onclick: () => editTarget(i), 'aria-label': `${f(t.value)}${unit} の目標を直す`,
          },
          h('span', {}, `${formatDateShort(t.setOn)}〜${t.endedOn ? formatDateShort(t.endedOn) : 'いま'}`),
          h('span', { class: 'num' }, `${f(t.value)}${unit}`),
          h('span', { class: `tag-mini${t.result === 'achieved' ? ' accent' : ''}` }, t.result ? RESULT[t.result] : (t.deadline ? `期限 ${formatDateShort(t.deadline)}` : 'いまの目標'))))),
        h('div', { class: 'card-actions' },
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => editTarget(null) }, '+ 過去の目標'),
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: openNext }, '次の目標を立てる'))),
      showBestLog ? h('section', { class: 'card trial-card', 'aria-label': '手で入れたベスト' },
        h('div', { class: 'trial-head' }, h('h2', {}, '手で入れたベスト'),
          h('span', { class: 'label' }, existing.metric?.type === 'manual' ? '' : '記録からのベストとは別')),
        bestLog.length ? h('div', { class: 'trial-past' },
          bestLog.map((x, i) => ({ x, i })).reverse().map(({ x, i }) => h('button', {
            class: 'target-row', type: 'button', onclick: () => editBest(i), 'aria-label': `${formatDateShort(x.date)} のベストを直す`,
          },
          h('span', {}, formatDateJaShort(x.date)),
          h('span', { class: 'num' }, `${f(x.value)}${unit}`),
          h('span', {})))) : h('p', { class: 'hint' }, 'まだありません。'),
        h('button', { class: 'btn btn-ghost btn-block', type: 'button', onclick: () => editBest(null) }, '+ 過去のベストを足す')) : null,
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

      segmented('何で測るか', METRICS, 'metricType', setMetric, 3),
      st.metricType === 'swim' ? swimFields() : null,

      st.metricType === 'trial' ? [
        exerciseSelect(trialExercises),
        segmented('どの値で比べるか', [{ key: 'best', label: '最高' }, { key: 'average', label: '平均' }], 'stat'),
      ] : null,
      st.metricType === 'series' ? (seriesList.length
        ? [field('系統', h('select', {
          id: 'goal-series', class: 'select',
          onchange: (e) => { st.seriesId = e.target.value; render(); },
        }, seriesList.map((s) => h('option', { value: s.id, selected: s.id === st.seriesId }, s.name)))),
        h('p', { class: 'hint', style: { marginTop: '-10px' } }, 'この系統の練習タイムからベストを出し、手で入れたベストと良い方を表示します。')]
        : h('p', { class: 'hint' }, 'まだ系統がありません。スイム記録でタイムを入れると、条件ごとに系統ができます。')) : null,
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
      st.metricType === 'swim' ? swimCheck() : null,
      st.metricType === 'manual' && st.unit === '秒' && swimTimes.length
        ? h('p', { class: 'hint', style: { marginTop: '-10px' } }, '「手入力」の目標は、スイム記録のタイムをベストに数えません。数えるには「何で測るか」を「水泳タイム」にしてください。')
        : null,
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
