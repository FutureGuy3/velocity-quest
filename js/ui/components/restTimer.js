// 休憩タイマー。終わる時刻を保存して残りを計算するので、画面を離れても狂わない。
import { h } from '../dom.js';
import { formatClock } from '../../domain/calc.js';
import { REST_PRESETS } from '../../domain/recordTypes.js';
import { openRestPicker } from './pads.js';

let audioCtx = null;
/** 音を鳴らせるようにする(スマホは画面を触ったときにしか音の準備ができない) */
export function unlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { /* 何もしない */ }
}

function beep() {
  try {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    [0, 0.25, 0.5].forEach((d) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(0.3, t + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.18);
      o.connect(g).connect(audioCtx.destination);
      o.start(t + d); o.stop(t + d + 0.2);
    });
  } catch { /* 何もしない */ }
}

/**
 * state: { endsAt: ms, total: 秒, label, pap } | null
 * onChange(state) で保存する
 */
export function createRestTimer({ initial = null, onChange }) {
  let state = initial && initial.endsAt > Date.now() - 5000 ? initial : null;
  let finishedAt = 0;
  let tick = null;
  let cueText = '';
  let cueAt = 0;

  const labelEl = h('span', { class: 'timer-label' });
  const timeEl = h('span', { class: 'timer-time num', role: 'timer', 'aria-live': 'off' });
  const barEl = h('div', { class: 'timer-bar-fill' });
  const plusBtn = h('button', { class: 'timer-btn', type: 'button', 'aria-label': '15秒延長', onclick: () => extend(15) }, '+15');
  const skipBtn = h('button', { class: 'timer-btn', type: 'button', onclick: () => stop() }, 'スキップ');
  const presets = h('div', { class: 'timer-presets' },
    REST_PRESETS.map((p) => h('button', {
      class: 'timer-chip', type: 'button',
      onclick: () => {
        unlockAudio();
        if (p.sec == null) {
          openRestPicker({ title: '休憩(任意の時間)', value: state?.total ?? 150, doneLabel: 'スタート', onDone: (n) => { if (n > 0) start(n, { label: '休憩' }); } });
          return;
        }
        start(p.sec, { label: p.pap ? '休憩 · PAP' : '休憩', pap: !!p.pap });
      },
    }, p.label)));

  const el = h('section', { class: 'rest-timer', 'aria-label': '休憩タイマー' },
    h('div', { class: 'timer-main' },
      h('div', { class: 'timer-read' }, labelEl, timeEl),
      h('div', { class: 'timer-actions' }, plusBtn, skipBtn)),
    h('div', { class: 'timer-bar' }, barEl),
    presets);

  function render() {
    const now = Date.now();
    const running = state && state.endsAt > now;
    el.classList.toggle('running', !!running);
    const cueOn = !running && cueText && now - cueAt < 20000;
    el.classList.toggle('done', !running && !cueOn && finishedAt && now - finishedAt < 6000);
    el.classList.toggle('cue', !!cueOn);
    if (cueOn) {
      labelEl.textContent = cueText;
      timeEl.textContent = '休まず';
      barEl.style.width = '0%';
    } else if (running) {
      const left = (state.endsAt - now) / 1000;
      labelEl.textContent = state.label || '休憩';
      timeEl.textContent = formatClock(left);
      barEl.style.width = `${Math.max(0, Math.min(100, (left / state.total) * 100))}%`;
    } else if (finishedAt && now - finishedAt < 6000) {
      labelEl.textContent = state?.next ? `休憩終わり · 次:${state.next}` : '休憩終わり';
      timeEl.textContent = '0:00';
      barEl.style.width = '0%';
    } else {
      labelEl.textContent = '休憩タイマー';
      timeEl.textContent = '—';
      barEl.style.width = '0%';
    }
    plusBtn.disabled = !running;
    skipBtn.disabled = !running;
    for (const [i, b] of [...presets.children].entries()) {
      const p = REST_PRESETS[i];
      b.setAttribute('aria-pressed', String(!!(running && p.sec === state.total)));
    }
  }

  function loop() {
    if (state && state.endsAt <= Date.now() && !finishedAt) {
      finishedAt = Date.now();
      beep();
      try { navigator.vibrate?.([300, 120, 300]); } catch { /* 何もしない */ }
      onChange?.(null);
    }
    render();
  }

  function start(sec, { label = '休憩', pap = false, next = null } = {}) {
    finishedAt = 0;
    cueText = '';
    state = { endsAt: Date.now() + sec * 1000, total: sec, label: next ? `${label} → 次:${next}` : label, pap, next };
    onChange?.(state);
    render();
  }
  function extend(sec) {
    if (!state) return;
    state = { ...state, endsAt: state.endsAt + sec * 1000, total: state.total + sec };
    onChange?.(state);
    render();
  }
  /** 休憩なしで次へ進む合図(スーパーセットの途中など) */
  function cue(text) {
    state = null; finishedAt = 0;
    cueText = text; cueAt = Date.now();
    onChange?.(null);
    render();
  }
  function stop() {
    state = null; finishedAt = 0; cueText = '';
    onChange?.(null);
    render();
  }

  tick = setInterval(loop, 250);
  render();
  return { el, start, stop, cue, destroy: () => clearInterval(tick) };
}
