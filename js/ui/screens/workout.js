// トレーニング記録(記録中/過去の練習の編集)
import { h, icon, mount, toast, onUnmount, faceIcon, formatDateJa, FACE_COLORS } from '../dom.js';
import { openReorder } from '../components/reorder.js';
import { openPicker } from '../components/picker.js';
import { actionSheet } from '../components/overlay.js';
import { createRestTimer, unlockAudio } from '../components/restTimer.js';
import { keepScreenOn, allowScreenOff } from '../components/wakeLock.js';
import { openValuePad, openRestPicker, cellButton, stepsFor, restText } from '../components/pads.js';
import {
  getWorkout, saveWorkout, listSets, saveSet, deleteSet, addSet, getExerciseMap, getGear,
  getLastSets, getBestSet, addWorkoutItems, removeWorkoutItem, finishWorkout, deleteWorkout,
  workoutDiffersFromRoutine, applyWorkoutToRoutine, getWorkoutTrial, saveTrial,
  saveBodyweight, getActiveWorkout, listRoutines, startWorkout, normalizeLinks, LINK_TYPES,
  changeWorkoutItemExercise,
} from '../../db/repo.js';
import {
  totalWeight, effectiveLoad, bodyweightRatio, formatElapsed, parseNumber, fmt, trialStats, round,
} from '../../domain/calc.js';
import { recordTypeLabel, SIDE_MODES, FACES, PAP_REST_SEC, DEFAULT_REST_SEC } from '../../domain/recordTypes.js';
import { FIELD_META, TYPE_FIELDS, formatSet, summarizeSets } from '../setFormat.js';
import { navigate, back } from '../../router.js';
import { choosePreset } from './home.js';

/* ======================= #/workout(開始画面) ======================= */

export async function renderWorkoutStart() {
  const active = await getActiveWorkout();
  if (active) { navigate(`/workout/${active.id}`, { replace: true }); return; }
  const routines = await listRoutines();
  const start = async (routineId) => {
    const w = await startWorkout({ routineId });
    navigate(`/workout/${w.id}`);
  };
  mount(h('div', {},
    h('header', { class: 'topbar' }, h('div', { class: 'topbar-title' }, h('h1', { class: 'topbar-h' }, 'トレーニング'))),
    h('div', { class: 'section-head', style: { paddingTop: '8px' } }, h('h2', {}, 'ルーティンから開始'),
      h('div', { style: { display: 'flex', gap: '16px' } },
        h('button', { class: 'link-btn', type: 'button', onclick: choosePreset }, 'プリセット'),
        h('a', { href: '#/routine/new' }, '+ 新規作成'))),
    h('div', { class: 'stack' },
      routines.length ? routines.map((r) => h('div', { class: 'routine-row' },
        h('a', { class: 'info', href: `#/routine/${r.id}` },
          h('span', { class: 'name' }, r.name), h('span', { class: 'meta' }, `${r.items.length}種目`)),
        h('button', { class: 'play-btn', 'aria-label': `${r.name}を開始`, onclick: () => start(r.id) }, icon('play'))))
        : h('p', { class: 'empty', style: { padding: '8px 4px' } }, 'ルーティンはまだありません。'),
      h('button', { class: 'btn btn-dashed btn-block', onclick: () => start(null) }, 'ルーティンなしで開始')),
  ), { showNav: true, navKey: 'workout' });
}

/* ======================= #/workout/:id ======================= */

export async function renderWorkout({ params }) {
  let w = await getWorkout(params.id);
  if (!w) { toast('練習が見つかりません'); navigate('/home', { replace: true }); return; }
  const live = w.status === 'active';
  let exMap = await getExerciseMap();
  let sets = await listSets(w.id);
  const gearCache = new Map();
  const info = new Map();        // exerciseId → { last, best }
  const trials = new Map();      // itemKey → trial
  const activeSet = new Map();   // itemKey → setId
  const cardEls = new Map();     // itemKey → element
  const derivedFns = new Map();  // itemKey → () => void(表示の更新)

  async function loadInfo() {
    for (const it of w.items) {
      const ex = exMap.get(it.exerciseId);
      if (!ex) continue;
      if (!info.has(ex.id)) {
        info.set(ex.id, {
          last: await getLastSets(ex.id, { excludeWorkoutId: w.id }),
          best: await getBestSet(ex.id, ex.recordType, { excludeWorkoutId: w.id }),
        });
      }
      if (ex.gearId && !gearCache.has(ex.gearId)) gearCache.set(ex.gearId, await getGear(ex.gearId));
      if (ex.recordType === 'trials' && !trials.has(it.key)) trials.set(it.key, await getWorkoutTrial(w.id, it.key));
    }
  }
  await loadInfo();

  /* ---------- 保存(入力のたびに少し待ってまとめて保存) ---------- */
  const timers = new Map();
  function scheduleSave(set) {
    clearTimeout(timers.get(set.id));
    timers.set(set.id, setTimeout(() => { timers.delete(set.id); saveSet(set); }, 400));
  }
  async function flush() {
    const ids = [...timers.keys()];
    for (const id of ids) { clearTimeout(timers.get(id)); timers.delete(id); const s = sets.find((x) => x.id === id); if (s) await saveSet(s); }
  }
  const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
  document.addEventListener('visibilitychange', onHide);

  async function saveW() { w = await saveWorkout(w); }

  /* ---------- 体重 ---------- */
  const bodyweight = () => (w.bodyweight != null ? Number(w.bodyweight) : null);

  /* ---------- 休憩タイマー ---------- */
  const timer = live ? createRestTimer({
    initial: w.timer,
    onChange: (state) => { w.timer = state; saveW(); },
  }) : null;

  let elapsedTick = null;

  /* ---------- 共通 ---------- */
  const itemSets = (key) => sets.filter((x) => x.itemKey === key);
  const restOf = (it) => (it.pap ? PAP_REST_SEC : (it.restSec ?? DEFAULT_REST_SEC));

  function pickActive(it) {
    const mine = itemSets(it.key);
    const cur = mine.find((x) => x.id === activeSet.get(it.key));
    if (cur) return cur;
    const next = mine.find((x) => !x.done) || mine[mine.length - 1] || null;
    if (next) activeSet.set(it.key, next.id);
    return next;
  }

  function redrawCard(it) {
    const old = cardEls.get(it.key);
    const neu = buildCard(it);
    if (old) old.replaceWith(neu);
  }

  /* ---------- セットの完了 ---------- */
  /** スーパーセットでつながった種目のまとまり(it を含む)。つながっていなければ [it] */
  function supersetChain(it) {
    let i = w.items.indexOf(it);
    while (i > 0 && w.items[i - 1].link?.type === 'superset' && w.items[i - 1].link.toKey === w.items[i].key) i--;
    const chain = [w.items[i]];
    while (chain[chain.length - 1].link?.type === 'superset' && w.items[i + chain.length]?.key === chain[chain.length - 1].link.toKey) {
      chain.push(w.items[i + chain.length]);
    }
    return chain;
  }
  const nameOf = (item) => (item ? exMap.get(item.exerciseId)?.name : null);
  const hasUndone = (item) => itemSets(item.key).some((x) => !x.done);
  function focusNext(item) {
    const s = itemSets(item.key).find((x) => !x.done);
    if (s) activeSet.set(item.key, s.id);
    redrawCard(item);
    setTimeout(() => cardEls.get(item.key)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
  }

  async function toggleDone(it, set) {
    unlockAudio();
    set.done = !set.done;
    await saveSet(set);
    if (!set.done || !live) { redrawCard(it); return; }

    const mine = itemSets(it.key);
    const nextSet = mine.find((x) => !x.done);
    if (nextSet) activeSet.set(it.key, nextSet.id);
    const rest = it.pap && !set.warmup ? PAP_REST_SEC : (set.restSec ?? restOf(it));

    // スーパーセット:途中の種目は休まず次へ、最後の種目のあとに休憩して最初の種目へ戻る
    const chain = supersetChain(it);
    if (chain.length > 1 && !set.warmup) {
      const pos = chain.indexOf(it);
      const after = w.items[w.items.indexOf(chain[chain.length - 1]) + 1];
      if (pos < chain.length - 1) {
        const nxt = chain.slice(pos + 1).find(hasUndone) || chain[pos + 1];
        timer.cue(`スーパーセット → 次:${nameOf(nxt)}`);
        redrawCard(it);
        focusNext(nxt);
        return;
      }
      const again = chain.find(hasUndone);
      timer.start(rest, { label: '休憩 · スーパーセット', next: nameOf(again || after) });
      redrawCard(it);
      if (again) focusNext(again); else if (after) focusNext(after);
      return;
    }

    const allDone = mine.filter((x) => !x.warmup).every((x) => x.done);
    const nextItem = w.items[w.items.indexOf(it) + 1];
    if (it.pap && !set.warmup) {
      timer.start(PAP_REST_SEC, { label: '休憩 · PAP', pap: true, next: allDone ? nameOf(nextItem) : null });
    } else {
      timer.start(rest, { label: '休憩', next: allDone ? nameOf(nextItem) : null });
    }
    if (allDone && nextItem) { redrawCard(it); focusNext(nextItem); return; }
    redrawCard(it);
  }

  /* ---------- 種目のメニュー ---------- */
  function itemMenu(it, i) {
    const ex = exMap.get(it.exerciseId);
    actionSheet({
      title: ex?.name,
      actions: [
        { label: '種目を変更する(マシンが空いていないときなど)', onSelect: () => changeExercise(it) },
        w.items.length > 1 && { label: '種目を並べ替える', onSelect: reorderItems },
        i < w.items.length - 1 && { label: it.link ? `つなぎを変える(今 ${LINK_TYPES[it.link.type]})` : '次の種目とつなぐ', onSelect: () => linkMenu(it, w.items[i + 1]) },
        { label: it.pap ? 'PAP を外す' : 'PAP にする(休憩3分)', onSelect: async () => { it.pap = !it.pap; await saveW(); redrawCard(it); } },
        !it.pap && { label: `休憩を変える(今 ${restText(restOf(it))})`, onSelect: () => restMenu(it) },
        { label: 'この種目を外す', danger: true, onSelect: async () => {
          if (!confirm(`「${ex?.name}」を外しますか?入力したセットも消えます。`)) return;
          if (i > 0 && w.items[i - 1].link) { w.items[i - 1].link = null; await saveW(); }
          w = await removeWorkoutItem(w, it.key);
          sets = await listSets(w.id);
          draw(true);
        } },
      ],
    });
  }
  function restMenu(it) {
    openRestPicker({
      title: `${nameOf(it)} の休憩(まだ完了していないセット)`, value: restOf(it),
      onDone: async (s) => {
        it.restSec = s;
        await saveW();
        for (const x of itemSets(it.key).filter((x) => !x.done)) { x.restSec = s; await saveSet(x); }
        redrawCard(it);
      },
    });
  }
  function changeExercise(it) {
    const doneCount = itemSets(it.key).filter((x) => x.done).length;
    openPicker({
      single: true,
      title: '変更する種目を選ぶ',
      context: `${nameOf(it)} から変更`,
      onDone: async ([id]) => {
        if (!id || id === it.exerciseId) return;
        w = await changeWorkoutItemExercise(w, it.key, id);
        exMap = await getExerciseMap();
        sets = await listSets(w.id);
        await loadInfo();
        const newName = exMap.get(id)?.name;
        toast(doneCount ? `完了した${doneCount}セットは${nameOf(it)}のまま残し、残りを${newName}にしました` : `${newName}に変更しました`);
        draw(true);
      },
    });
  }

  function reorderItems() {
    openReorder({
      title: '種目の並べ替え',
      rows: w.items.map((it) => ({ key: it.key, label: nameOf(it) ?? '(削除された種目)', sub: `${itemSets(it.key).filter((x) => x.done).length}/${itemSets(it.key).length} セット完了` })),
      onDone: async (keys) => {
        const byKey = new Map(w.items.map((it) => [it.key, it]));
        w.items = normalizeLinks(keys.map((k) => byKey.get(k)));
        await saveW();
        draw(true);
      },
    });
  }
  function linkMenu(it, next) {
    actionSheet({
      title: `${nameOf(it)} と ${nameOf(next)} のつなぎ方`,
      actions: [
        { label: 'スーパーセット(交互に行い、2つ目のあとに休憩)', onSelect: async () => { it.link = { type: 'superset', toKey: next.key }; await saveW(); draw(true); } },
        { label: 'PAP ペア(重い種目を3分休憩で行い、そのあと次の種目)', onSelect: async () => { it.link = { type: 'pap', toKey: next.key }; it.pap = true; await saveW(); draw(true); } },
        it.link && { label: 'つなぎを外す', danger: true, onSelect: async () => { it.link = null; await saveW(); draw(true); } },
      ],
    });
  }


  function setMenu(it, set, label) {
    actionSheet({
      title: `セット ${label}`,
      actions: [
        { label: set.warmup ? '本番のセットにする' : 'ウォームアップにする', onSelect: async () => { set.warmup = !set.warmup; await saveSet(set); redrawCard(it); } },
        { label: 'このセットを削除', danger: true, onSelect: async () => { await deleteSet(set.id); sets = sets.filter((x) => x.id !== set.id); redrawCard(it); } },
      ],
    });
  }

  /* ---------- 片側の方式 ---------- */
  async function setSideMode(it, mode) {
    it.sideMode = mode;
    for (const s of itemSets(it.key)) {
      if (mode === 'split' && s.sideMode !== 'split') {
        const base = Object.fromEntries(TYPE_FIELDS[exMap.get(it.exerciseId).recordType].map((f) => [f, s[f] ?? null]));
        s.left = s.left || { ...base };
        s.right = s.right || { ...base };
      }
      s.sideMode = mode;
      await saveSet(s);
    }
    await saveW();
    redrawCard(it);
  }

  /* ---------- 入力欄 ---------- */
  function valueInput(it, set, field, side = null) {
    const meta = FIELD_META[field];
    const target = side ? (set[side] = set[side] || {}) : set;
    const label = `${side === 'left' ? '左 ' : side === 'right' ? '右 ' : ''}${meta.label}`;
    const activate = () => { if (activeSet.get(it.key) !== set.id) { activeSet.set(it.key, set.id); markActive(it); } };
    if (meta.mode === 'text') {
      return h('input', {
        class: 'cell-input text', value: target[field] ?? '', placeholder: '—', 'aria-label': label,
        onfocus: activate,
        oninput: (e) => { target[field] = e.target.value; scheduleSave(set); },
      });
    }
    const ex = exMap.get(it.exerciseId);
    return cellButton({
      value: target[field], label,
      onOpen: (btn) => {
        activate();
        // 空の欄は、このセットの前のセット(なければ前回の記録)の値から始める
        const mine = itemSets(it.key);
        const before = mine.slice(0, mine.indexOf(set)).reverse().find((x) => (side ? x[side]?.[field] : x[field]) != null);
        const lastRec = (info.get(it.exerciseId)?.last || []).find((x) => x[field] != null);
        const start = before ? (side ? before[side][field] : before[field]) : lastRec?.[field] ?? null;
        openValuePad({
          title: `${ex?.name ?? ''} · セット ${setLabel(it, set)} · ${label}`,
          value: target[field], start, steps: stepsFor(field, ex?.increment, ex?.equipment), anchor: btn,
          onChange: (v) => { target[field] = v; btn.setValue(v); scheduleSave(set); derivedFns.get(it.key)?.(); },
        });
      },
    });
  }

  function markActive(it) {
    const card = cardEls.get(it.key);
    if (!card) return;
    const id = activeSet.get(it.key);
    card.querySelectorAll('.set-row').forEach((r) => r.classList.toggle('active', r.dataset.id === id));
    const panel = card.querySelector('.face-panel');
    if (panel) panel.replaceWith(facePanel(it));
    derivedFns.get(it.key)?.();
  }

  function facePanel(it) {
    const set = pickActive(it);
    if (!set) return h('div', { class: 'face-panel' });
    const label = setLabel(it, set);
    return h('div', { class: 'face-panel' },
      h('span', { class: 'label' }, `セット ${label} の感触`, set.face ? h('span', { class: 'face-name', style: { '--fc': FACE_COLORS[set.face - 1] } }, `:${FACES[set.face - 1]}`) : ''),
      h('div', { class: 'faces', role: 'radiogroup', 'aria-label': '感触' },
        FACES.map((name, i) => h('button', {
          type: 'button', role: 'radio', 'aria-checked': String(set.face === i + 1), 'aria-label': name, style: { '--fc': FACE_COLORS[i] },
          onclick: async () => {
            set.face = set.face === i + 1 ? null : i + 1;
            await saveSet(set);
            redrawCard(it);
          },
        }, faceIcon(i + 1, 28)))),
      h('input', {
        class: 'input', placeholder: 'メモ', value: set.memo || '', 'aria-label': `セット ${label} のメモ`,
        oninput: (e) => { set.memo = e.target.value; scheduleSave(set); },
      }));
  }

  function setLabel(it, set) {
    if (set.warmup) return 'W';
    const work = itemSets(it.key).filter((x) => !x.warmup);
    return String(work.indexOf(set) + 1);
  }

  /* ---------- 種目カード ---------- */
  function buildCard(it) {
    const i = w.items.indexOf(it);
    const ex = exMap.get(it.exerciseId);
    const el = ex?.recordType === 'trials' ? trialCard(it, i, ex) : setCard(it, i, ex);
    cardEls.set(it.key, el);
    return el;
  }

  function cardHead(it, i, ex, extraMeta = '') {
    const meta = ex ? [ex.bodyPart, ex.equipment, recordTypeLabel(ex.recordType)].join(' · ') : '';
    return h('div', { class: 'ex-head' },
      h('div', { class: 'info' },
        h('h3', {}, ex?.name ?? '(削除された種目)'),
        h('span', { class: 'meta' }, meta, extraMeta ? ` · ${extraMeta}` : ''),
        h('span', { class: 'tags' },
          it.pap ? h('span', { class: 'tag-mini accent' }, 'PAP 3分') : h('span', { class: 'tag-mini' }, `休憩 ${restText(restOf(it))}`)),
        linkBanner(it, i)),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': `${ex?.name ?? ''}のメニュー`, onclick: () => itemMenu(it, i) }, icon('more')));
  }

  function linkBanner(it, i) {
    const prev = w.items[i - 1];
    const parts = [];
    if (prev?.link && prev.link.toKey === it.key) parts.push(h('span', { class: `link-banner ${prev.link.type}` }, icon('link', 12), `${LINK_TYPES[prev.link.type]} ← ${nameOf(prev)}`));
    if (it.link) parts.push(h('span', { class: `link-banner ${it.link.type}` }, icon('link', 12), `${LINK_TYPES[it.link.type]} → ${nameOf(w.items[i + 1])}`));
    return parts.length ? h('span', { class: 'tags', style: { flexWrap: 'wrap' } }, parts) : null;
  }

  function setCard(it, i, ex) {
    if (!ex) return h('article', { class: 'ex-card' }, cardHead(it, i, ex));
    const rt = ex.recordType;
    const fields = TYPE_FIELDS[rt] || ['reps'];
    const mode = it.sideMode || 'both';
    const mine = itemSets(it.key);
    const active = pickActive(it);
    const gear = ex.gearId ? gearCache.get(ex.gearId) : null;
    const inf = info.get(ex.id) || {};

    // 重さの内訳(バーのある種目)/実負荷(自重系)
    const derived = h('div', {});
    const updateDerived = () => {
      const s = pickActive(it);
      derived.replaceChildren();
      if (!s) return;
      const src = mode === 'split' ? (s.left || {}) : s;
      if (rt === 'weight_reps' && gear) {
        const bar = gear.barWeight;
        const plate = src.weight != null ? round((Number(src.weight) - bar) / 2, 2) : null;
        derived.append(breakdownBox(it, s, src, bar, plate, mode === 'split'));
      } else if (rt === 'bw_plus' || rt === 'bw_minus') {
        derived.append(loadBox(rt, src));
      }
    };
    derivedFns.set(it.key, updateDerived);
    updateDerived();

    const lastText = summarizeSets(rt, inf.last || []);
    const bestText = inf.best ? formatSet(rt, inf.best.set) : '';

    const header = h('div', { class: `set-row head cols-${mode === 'split' ? 1 : fields.length}` },
      h('span', {}, 'セット'),
      mode === 'split'
        ? h('span', {}, `左右 ${fields.map((f) => FIELD_META[f].short || FIELD_META[f].label).join(' × ')}`)
        : fields.map((f) => h('span', {}, FIELD_META[f].label)),
      h('span', { class: 'c' }, '感触'), h('span', { class: 'c' }, '完了'));

    const rows = mine.map((s) => {
      const label = setLabel(it, s);
      const cells = mode === 'split'
        ? h('div', { class: 'split-cells' },
          ['left', 'right'].map((side) => h('div', { class: 'split-line' },
            h('span', { class: 'side' }, side === 'left' ? '左' : '右'),
            fields.map((f) => valueInput(it, s, f, side)))))
        : fields.map((f) => valueInput(it, s, f));
      return h('div', {
        class: `set-row cols-${mode === 'split' ? 1 : fields.length}${s.id === active?.id ? ' active' : ''}${s.warmup ? ' warm' : ''}${s.done ? ' done' : ''}`,
        'data-id': s.id,
      },
      h('button', { class: 'set-label', type: 'button', 'aria-label': `セット ${label} のメニュー`, onclick: () => setMenu(it, s, label) }, label),
      cells,
      h('button', {
        class: `face-btn${s.face ? ' on' : ''}`, type: 'button', 'aria-label': `感触:${s.face ? FACES[s.face - 1] : '未入力'}`,
        style: s.face ? { '--fc': FACE_COLORS[s.face - 1] } : null,
        onclick: () => { activeSet.set(it.key, s.id); markActive(it); cardEls.get(it.key)?.querySelector('.face-panel')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); },
      }, faceIcon(s.face, 26)),
      h('button', {
        class: 'done-btn', type: 'button', 'aria-pressed': String(!!s.done), 'aria-label': s.done ? '完了を取り消す' : '完了',
        onclick: () => toggleDone(it, s),
      }, icon('check', 20, 3)));
    });

    return h('article', { class: `ex-card${it.pap ? ' pap' : ''}`, 'data-key': it.key },
      cardHead(it, i, ex),
      ex.unilateral ? h('div', { class: 'segmented side-modes', role: 'radiogroup', 'aria-label': '左右の記録方法' },
        Object.entries(SIDE_MODES).map(([k, label]) => h('button', {
          type: 'button', role: 'radio', 'aria-checked': String(mode === k), onclick: () => setSideMode(it, k),
        }, label))) : null,
      derived,
      (lastText || bestText) ? h('p', { class: 'prev-line' },
        lastText ? `前回 ${lastText}` : '', lastText && bestText ? ' · ' : '', bestText ? `自己ベスト ${bestText}` : '') : null,
      h('div', { class: 'set-table' }, header, rows),
      mine.length ? facePanel(it) : null,
      h('div', { class: 'card-actions' },
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => {
          const s = await addSet(w, it); sets = await listSets(w.id); activeSet.set(it.key, s.id); redrawCard(it);
        } }, '+ セットを追加'),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => {
          const s = await addSet(w, it, { warmup: true });
          // ウォームアップは本番のセットの前に置く
          const first = itemSets(it.key)[0];
          if (first) { s.order = first.order - 0.0001; await saveSet(s); }
          sets = await listSets(w.id); activeSet.set(it.key, s.id); redrawCard(it);
        } }, '+ ウォームアップ')));
  }

  function breakdownBox(it, set, src, bar, plate, split) {
    const ex = exMap.get(it.exerciseId);
    const inc = ex.increment || 2.5;
    let plateVal = plate;
    const plateInput = cellButton({
      value: plate, placeholder: '0', label: 'プレート片側 kg',
      onOpen: (btn) => openValuePad({
        title: `${ex.name} · プレート片側(×2 で合計)`, unit: 'kg', value: plateVal, start: 0,
        steps: stepsFor('platePerSide', inc / 2),
        onChange: (v) => { btn.setValue(v); applyPlate(v); },
      }),
    });
    const totalEl = h('span', { class: 'num big' }, src.weight != null ? `${fmt(src.weight)}kg` : '—');
    function applyPlate(p) {
      plateVal = p;
      const total = p == null ? null : totalWeight({ bar, platePerSide: p });
      src.weight = total;
      src.breakdown = p == null ? null : { bar, platePerSide: p };
      scheduleSave(set);
      totalEl.textContent = total != null ? `${fmt(total)}kg` : '—';
      const row = cardEls.get(it.key)?.querySelector(`.set-row[data-id="${set.id}"]`);
      const cell = row?.querySelector('.cell-btn');
      cell?.setValue(total);
    }
    const step = (d) => {
      const p = Math.max(0, round((plateVal ?? 0) + d * inc / 2, 2));
      plateInput.setValue(p);
      applyPlate(p);
    };
    return h('div', { class: 'calc-box', role: 'group', 'aria-label': '重さの内訳' },
      h('div', { class: 'cb' }, h('span', { class: 'k' }, 'バー'), h('span', { class: 'num' }, fmt(bar))),
      h('div', { class: 'cb grow' }, h('span', { class: 'k' }, `プレート片側 ×2${split ? '(左)' : ''}`),
        h('div', { class: 'mini-stepper' },
          h('button', { type: 'button', 'aria-label': 'プレートを減らす', onclick: () => step(-1) }, '−'),
          plateInput,
          h('button', { type: 'button', 'aria-label': 'プレートを増やす', onclick: () => step(1) }, '+'))),
      h('div', { class: 'cb' }, h('span', { class: 'k' }, '合計'), totalEl));
  }

  function loadBox(rt, src) {
    const bw = bodyweight();
    if (bw == null) {
      const inp = h('input', { class: 'cell-input', inputmode: 'decimal', placeholder: '体重', 'aria-label': '体重 kg' });
      return h('div', { class: 'calc-box' },
        h('div', { class: 'cb grow' }, h('span', { class: 'k' }, '体重を入れると実負荷と体重比を出します'),
          h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, inp,
            h('button', { class: 'btn btn-light', type: 'button', onclick: async () => {
              const kg = parseNumber(inp.value);
              if (kg == null || kg < 20 || kg > 300) { toast('体重は 20〜300 の数字で入れてください'); return; }
              w.bodyweight = round(kg, 1);
              await saveW();
              await saveBodyweight(w.date, w.bodyweight);
              draw(true);
            } }, '記録'))));
    }
    const load = effectiveLoad(rt, src, bw);
    const ratio = bodyweightRatio(load, bw);
    const extra = rt === 'bw_plus' ? `+ ${fmt(src.added ?? 0)}` : `− ${fmt(src.assist ?? 0)}`;
    return h('div', { class: 'calc-box' },
      h('div', { class: 'cb grow' }, h('span', { class: 'k' }, rt === 'bw_plus' ? '体重+加重' : '体重−アシスト'), h('span', { class: 'num' }, `${bw.toFixed(1)} ${extra}`)),
      h('div', { class: 'cb' }, h('span', { class: 'k' }, '実負荷'), h('span', { class: 'num big' }, load != null ? `${load.toFixed(1)}kg` : '—')),
      h('div', { class: 'cb' }, h('span', { class: 'k' }, '体重比'), h('span', { class: 'num' }, ratio != null ? fmt(ratio, 2) : '—')));
  }

  /* ---------- 試技のカード(立ち幅跳び・垂直跳び) ---------- */
  function trialCard(it, i, ex) {
    let t = trials.get(it.key);
    const unit = ex.unit || 'cm';
    const attempts = t?.attempts?.length ? t.attempts.map((a) => ({ ...a })) : [{ value: null, foul: false }, { value: null, foul: false }, { value: null, foul: false }];
    const statsEl = h('div', { class: 'calc-box' });
    let saveTimer = null;
    async function persist() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        t = await saveTrial({ ...(t || {}), exerciseId: ex.id, date: w.date, workoutId: w.id, itemKey: it.key, attempts: attempts.filter((a) => a.value != null || a.foul) });
        trials.set(it.key, t);
      }, 300);
    }
    function updateStats() {
      const st = trialStats(attempts.filter((a) => a.value != null || a.foul));
      statsEl.replaceChildren(
        h('div', { class: 'cb' }, h('span', { class: 'k' }, '最高'), h('span', { class: 'num big' }, st.best != null ? `${fmt(st.best, 2)}${unit}` : '—')),
        h('div', { class: 'cb' }, h('span', { class: 'k' }, `平均(有効${st.validCount}本)`), h('span', { class: 'num big' }, st.average != null ? `${fmt(st.average, 2)}${unit}` : '—')));
    }
    updateStats();
    const grid = h('div', { class: 'attempts' });
    const drawAttempts = () => grid.replaceChildren(...attempts.map((a, k) => h('div', { class: `attempt${a.foul ? ' foul' : ''}` },
      h('span', { class: 'k' }, `${k + 1}本目`),
      h('input', {
        class: 'cell-input', inputmode: 'decimal', value: a.value ?? '', placeholder: '—', 'aria-label': `${k + 1}本目 ${unit}`,
        oninput: (e) => { a.value = parseNumber(e.target.value); persist(); updateStats(); },
      }),
      h('button', { class: 'foul-btn', type: 'button', 'aria-pressed': String(!!a.foul), onclick: () => { a.foul = !a.foul; persist(); updateStats(); drawAttempts(); } }, 'ファウル'))));
    drawAttempts();
    return h('article', { class: 'ex-card', 'data-key': it.key },
      cardHead(it, i, ex, `単位 ${unit}`),
      grid,
      statsEl,
      h('div', { class: 'card-actions' },
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { attempts.push({ value: null, foul: false }); drawAttempts(); } }, '+ 試技')));
  }

  /* ---------- 終了 ---------- */
  async function onFinish() {
    await flush();
    sets = await listSets(w.id);
    const undone = sets.filter((x) => !x.done).length;
    const doneCount = sets.filter((x) => x.done).length;
    const differs = await workoutDiffersFromRoutine(w);
    const note = [
      `完了したセット ${doneCount}`,
      undone ? `未完了のセット ${undone} は記録に残りません` : '',
      differs ? '種目の並び・PAP・休憩がルーティンと違います' : '',
    ].filter(Boolean).join('。');
    const finish = async (apply) => {
      await flush();
      if (apply) await applyWorkoutToRoutine(w);
      await finishWorkout(w.id);
      toast(apply ? 'お疲れさまでした。ルーティンにも反映しました' : 'お疲れさまでした');
      navigate(`/history/${w.id}`, { replace: true });
    };
    actionSheet({
      title: `トレーニングを終了します。${note}`,
      actions: differs ? [
        { label: '終了してルーティンにも反映', onSelect: () => finish(true) },
        { label: '終了(ルーティンは変えない)', onSelect: () => finish(false) },
      ] : [
        { label: '終了する', onSelect: () => finish(false) },
      ],
    });
  }

  async function onDiscard() {
    if (!confirm('この練習を削除しますか?入力したセットも消えます。')) return;
    await deleteWorkout(w.id);
    toast('削除しました');
    navigate('/home', { replace: true });
  }

  /* ---------- 画面 ---------- */
  let first = true;
  function draw(keepScroll = false) {
    cardEls.clear();
    const sub = h('span', { class: 'topbar-sub' });
    const updateSub = () => {
      const bw = bodyweight() != null ? ` · 体重 ${bodyweight().toFixed(1)}kg` : '';
      sub.textContent = live
        ? `${formatElapsed(Date.now() - new Date(w.startedAt).getTime())}${bw}`
        : `${formatDateJa(w.date)}${bw}`;
    };
    updateSub();
    clearInterval(elapsedTick);
    if (live) elapsedTick = setInterval(updateSub, 1000);

    const titleInput = h('input', {
      class: 'title-input', value: w.title || '', 'aria-label': '練習の名前',
      onchange: async (e) => { w.title = e.target.value.trim() || 'フリー'; await saveW(); },
    });

    mount(h('div', { class: 'workout' },
      h('header', { class: 'topbar workout-top' },
        h('button', { class: 'icon-btn', 'aria-label': live ? 'ホームに戻る' : '戻る', onclick: async () => { await flush(); live ? navigate('/home') : back(`/history/${w.id}`); } }, icon('back')),
        h('div', { class: 'topbar-title' }, titleInput, sub),
        live
          ? h('button', { class: 'btn btn-light', onclick: onFinish }, '終了')
          : h('button', { class: 'btn btn-light', onclick: async () => { await flush(); navigate(`/history/${w.id}`, { replace: true }); } }, '完了')),
      timer ? timer.el : null,
      h('div', { class: 'ex-cards' }, w.items.map(buildCard)),
      !w.items.length ? h('p', { class: 'empty' }, '下の「種目を追加」から種目を足してください。') : null,
      h('div', { class: 'form-actions' },
        h('button', {
          class: 'btn btn-dashed btn-block',
          onclick: () => openPicker({
            context: w.title || 'トレーニング',
            onDone: async (ids) => {
              w = await addWorkoutItems(w.id, ids);
              exMap = await getExerciseMap();
              sets = await listSets(w.id);
              await loadInfo();
              draw(true);
              const lastItem = w.items[w.items.length - 1];
              setTimeout(() => cardEls.get(lastItem?.key)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
            },
          }),
        }, '+ 種目を追加'),
        w.items.length > 1 ? h('button', { class: 'btn btn-ghost btn-block', onclick: reorderItems }, icon('sort', 18), '種目を並べ替える') : null,
        h('div', { class: 'field' },
          h('label', { for: 'w-memo' }, 'この練習のメモ'),
          h('textarea', { id: 'w-memo', class: 'input textarea', rows: 2, oninput: (e) => { w.memo = e.target.value; clearTimeout(memoT); memoT = setTimeout(saveW, 500); } }, w.memo || '')),
        h('button', { class: 'btn btn-danger btn-block', onclick: onDiscard }, live ? 'この練習を破棄' : 'この練習を削除')),
    ), { showNav: false, keepScroll: keepScroll && !first, redraw: !first });
    first = false;
  }
  let memoT = null;

  draw();
  /* ---------- 画面の後片付け ---------- */
  onUnmount(() => {
    flush();
    timer?.destroy();
    clearInterval(elapsedTick);
    document.removeEventListener('visibilitychange', onHide);
    allowScreenOff();
  });
  if (live) keepScreenOn();
}
