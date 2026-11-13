// スイム:スイムタブと、スイム記録(タイムの入力。試作 design/TimeEntry.dc.html)
import { h, icon, mount, toast, formatDateJa } from '../dom.js';
import { actionSheet, openOverlay } from '../components/overlay.js';
import { seriesSection } from './compare.js';
import {
  startPoolSession, getActivePoolSession, getPoolSession, savePoolSession, finishPoolSession, deletePoolSession,
  addSwimTime, listSwimTimes, saveSwimTime, deleteSwimTime, getLastConditions, listSeries, seriesIdOf,
  setPoolSessionDate, localDate,
} from '../../db/repo.js';
import { formatSeconds } from '../../domain/calc.js';
import {
  CONDITIONS, normalizeConditions, seriesAutoName, cutoffInfo, conditionsText,
} from '../../domain/swim.js';
import { navigate, back } from '../../router.js';

/** スイム記録を始める(date を渡すと過去の日付で記録)。今日の分で記録中があればそれを開く */
export async function startPool({ date = null } = {}) {
  const active = await getActivePoolSession();
  if (active && !date) { navigate(`/pool/${active.id}`); return; }
  const s = await startPoolSession({ date });
  navigate(`/pool/${s.id}`);
}

/* ======================= #/swim(スイムタブ) ======================= */

export async function renderSwimTab() {
  const active = await getActivePoolSession();
  const series = await seriesSection(renderSwimTab);
  const startPast = () => openOverlay({
    title: '日付を選んで記録',
    render(api) {
      const dIn = h('input', { id: 'swim-date', class: 'input', type: 'date', max: localDate(), value: localDate() });
      return h('div', { class: 'form' },
        h('div', { class: 'field' }, h('label', { for: 'swim-date' }, '泳いだ日'), dIn),
        h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: () => { const d = dIn.value || localDate(); api.close(); startPool({ date: d }); } }, 'この日のスイム記録を始める'));
    },
  });
  mount(h('div', {},
    h('header', { class: 'topbar' }, h('div', { class: 'topbar-title' }, h('h1', { class: 'topbar-h' }, 'スイム'))),
    active ? h('section', { class: 'active-card', 'aria-label': '記録中のスイム記録' },
      h('div', {},
        h('p', { class: 'label', style: { color: 'var(--accent)', fontWeight: 700 } }, '記録中'),
        h('p', { style: { fontSize: '15px', fontWeight: 700 } }, `スイム記録 · ${formatDateJa(active.date)}`)),
      h('div', { class: 'row' }, h('button', { class: 'btn btn-primary', onclick: () => navigate(`/pool/${active.id}`) }, '再開'))) : null,
    h('div', { class: 'section-head', style: { paddingTop: '8px' } }, h('h2', {}, 'スイム記録(タイム)')),
    h('div', { class: 'stack' },
      h('button', { class: 'btn btn-primary btn-block pool-start', onclick: () => startPool() }, active ? 'スイム記録を再開' : 'スイム記録を始める'),
      h('button', { class: 'btn btn-ghost btn-block', onclick: startPast }, '日付を選んで記録(過去の分)'),
      h('p', { class: 'hint', style: { padding: '0 4px' } }, '終えたスイム記録は、ジムと同じく「履歴」タブに日付ごとに並びます。')),
    h('div', { class: 'section-head' }, h('h2', {}, '練習タイムの系統')),
    series,
    h('div', { class: 'section-head' }, h('h2', {}, 'スイム練習・ルーティン')),
    h('p', { class: 'empty', style: { paddingTop: 0 } }, 'スイム練習の記録と、スイムのルーティンの作成は、今後の段階で作ります。'),
  ), { showNav: true, navKey: 'swim' });
}

/**
 * 数字キーの入力 → 秒。小数点がないときはストップウォッチの表示どおりに読む:
 *   3〜4桁は 秒・1/100秒(1308 → 13.08)
 *   5〜6桁は 分・秒・1/100秒(10234 → 1:02.34 = 62.34秒)
 * 小数点を打ったときは秒として読む(62.34 → 62.34)
 */
export function digitsToSeconds(d) {
  if (!d) return null;
  let v;
  if (!d.includes('.') && d.length >= 5) {
    const m = Number(d.slice(0, -4)), sec = Number(d.slice(-4, -2)), cs = Number(d.slice(-2));
    if (sec >= 60) return null;
    v = m * 60 + sec + cs / 100;
  } else if (!d.includes('.') && d.length >= 3) {
    v = Number(`${d.slice(0, -2)}.${d.slice(-2)}`);
  } else {
    v = Number(d);
  }
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null;
}

export async function renderPool({ params }) {
  let session = await getPoolSession(params.id);
  if (!session) { toast('スイム記録が見つかりません'); navigate('/swim', { replace: true }); return; }
  const live = session.status === 'active';
  let times = await listSwimTimes(session.id);
  let seriesMap = new Map((await listSeries()).map((s) => [s.id, s]));

  // 最初の条件:この記録の最後のタイムの条件 → 前回の条件
  const last = times.length ? times[times.length - 1].conditions : await getLastConditions();
  let cond = normalizeConditions(last);
  const sameAsLast = !times.length;
  let digits = '';
  // 条件の欄:この練習でまだ記録がなければ開いておく。記録したら1行にたたんで、数字キーを画面に収める
  let condOpen = !times.length;

  const curSeriesId = () => seriesIdOf(cond);
  const seriesTimes = (id) => times.filter((t) => t.seriesId === id);

  async function record() {
    const sec = digitsToSeconds(digits);
    if (sec == null) { toast('タイムを入れてください'); return; }
    if (cond.gear === 'other' && !cond.gearOther) { toast('器具の名前を入れてください'); return; }
    await addSwimTime(session, cond, sec);
    condOpen = false;
    times = await listSwimTimes(session.id);
    seriesMap = new Map((await listSeries()).map((s) => [s.id, s]));
    digits = '';
    const info = cutoffInfo(seriesTimes(curSeriesId()));
    if (info.suggestStop) toast(`目安(${formatSeconds(info.cut)})を超えました。この系統は終了を提案します`);
    draw(true);
  }

  function timeMenu(t, n) {
    actionSheet({
      title: `${n}本目 ${formatSeconds(t.seconds)}`,
      actions: [
        { label: t.valid === false ? '有効に戻す' : '無効にする(フライングなど。平均と判定から外す)', onSelect: async () => { await saveSwimTime({ ...t, valid: t.valid === false }); times = await listSwimTimes(session.id); draw(true); } },
        { label: 'この記録を削除', danger: true, onSelect: async () => { await deleteSwimTime(t.id); times = await listSwimTimes(session.id); draw(true); } },
      ],
    });
  }

  async function onFinish() {
    if (!times.length && !confirm('タイムがまだありません。終了しますか?(この練習は残りません)')) return;
    if (!times.length) { await deletePoolSession(session.id); navigate('/swim', { replace: true }); return; }
    await finishPoolSession(session.id);
    toast('お疲れさまでした');
    navigate('/swim', { replace: true });
  }
  async function onDelete() {
    if (!confirm('このスイム記録を削除しますか?タイムも消えます。')) return;
    await deletePoolSession(session.id);
    toast('削除しました');
    navigate(live ? '/home' : '/history', { replace: true });
  }

  /* ---------- 部品 ---------- */
  function conditionRows() {
    return CONDITIONS.map((c) => h('div', { class: 'cond-row', role: 'radiogroup', 'aria-label': c.label },
      h('span', { class: 'cond-label' }, c.label),
      h('div', { class: 'cond-opts' },
        c.options.map(([v, label]) => h('button', {
          type: 'button', role: 'radio', class: 'cond-opt', 'aria-checked': String(String(cond[c.key]) === String(v)),
          onclick: () => { cond = normalizeConditions({ ...cond, [c.key]: v }); draw(true); },
        }, label)),
        // 距離は任意の値も入れられる
        c.key === 'distance' ? h('button', {
          type: 'button', role: 'radio', class: 'cond-opt',
          'aria-checked': String(!c.options.some(([v]) => Number(v) === Number(cond.distance))),
          onclick: () => {
            const v = prompt('距離(m)', c.options.some(([x]) => Number(x) === Number(cond.distance)) ? '' : String(cond.distance));
            const n = Math.round(Number(String(v ?? '').normalize('NFKC')));
            if (!v) return;
            if (!(n > 0 && n <= 1500)) { toast('距離は 1〜1500 の数字で入れてください'); return; }
            cond = normalizeConditions({ ...cond, distance: n }); draw(true);
          },
        }, c.options.some(([v]) => Number(v) === Number(cond.distance)) ? '任意' : `${cond.distance}m(任意)`) : null)));
  }

  function keypad(display, note) {
    const press = (k) => {
      if (k === 'del') digits = digits.slice(0, -1);
      else if (k === '.') { if (!digits.includes('.')) digits = (digits || '0') + '.'; }
      else if (digits.replace('.', '').length < 6) digits += k;
      const sec = digitsToSeconds(digits);
      display.textContent = digits ? (sec != null ? formatSeconds(sec) : digits) : '--.--';
      display.classList.toggle('empty', !digits);
      note.textContent = digits && !digits.includes('.') && digits.length >= 3
        ? (sec != null ? `「${digits}」→ ${formatSeconds(sec)}` : '秒の部分は 59 までです') : ' ';
    };
    return h('div', { class: 'keypad' },
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'].map((k) => h('button', {
        type: 'button', class: 'key', 'aria-label': k === 'del' ? '1文字消す' : k === '.' ? '小数点' : k, onclick: () => press(k),
      }, k === 'del' ? '⌫' : k)));
  }

  /* ---------- 画面 ---------- */
  let first = true;
  function draw(keepScroll = false) {
    const sid = curSeriesId();
    const known = seriesMap.get(sid);
    const mine = seriesTimes(sid);
    const info = cutoffInfo(mine);
    const display = h('span', { class: `time-display num${digits ? '' : ' empty'}` }, digits ? formatSeconds(digitsToSeconds(digits)) : '--.--');
    const note = h('span', { class: 'hint key-note' }, ' ');
    const others = [...new Set(times.map((t) => t.seriesId))].filter((id) => id !== sid);

    mount(h('div', {},
      h('header', { class: 'topbar workout-top' },
        h('button', { class: 'icon-btn', 'aria-label': '戻る', onclick: () => (live ? navigate('/swim') : back('/swim')) }, icon('back')),
        h('div', { class: 'topbar-title' },
          h('span', { class: 'topbar-sub' }, formatDateJa(session.date)),
          h('span', { class: 'topbar-h' }, 'スイム記録')),
        live ? h('button', { class: 'btn btn-light', onclick: onFinish }, '終了')
          : h('button', { class: 'btn btn-light', onclick: () => navigate('/swim', { replace: true }) }, '完了')),

      h('section', { class: 'card cond-card', 'aria-label': '計測の条件' },
        h('div', { class: 'series-head' },
          h('div', { class: 'info' },
            h('span', { class: 'label' }, '記録先の系統'),
            h('span', { class: `series-name${known ? '' : ' new'}` }, known ? known.name : '新しい系統(この記録で作成)')),
          sameAsLast && first ? h('span', { class: 'tag-mini' }, '前回と同じ条件') : null),
        condOpen ? conditionRows() : h('div', { class: 'cond-summary' },
          h('span', { class: 'hint' }, conditionsText(cond)),
          h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { condOpen = true; draw(true); } }, '条件を変える')),
        condOpen && times.length ? h('button', { type: 'button', class: 'btn btn-ghost btn-block', onclick: () => { condOpen = false; draw(true); } }, '条件をたたむ') : null,
        condOpen && cond.gear === 'other' ? h('div', { class: 'field' },
          h('label', { for: 'gear-other' }, '器具名'),
          h('input', { id: 'gear-other', class: 'input', value: cond.gearOther, placeholder: '例:シュノーケル', onchange: (e) => { cond = normalizeConditions({ ...cond, gearOther: e.target.value }); draw(true); } })) : null),

      h('section', { class: 'time-entry', 'aria-label': 'タイム' },
        h('span', { class: 'label' }, `${mine.length + 1}本目`),
        h('div', { class: 'time-read' }, display, h('span', { class: 'muted' }, '秒')),
        note,
        keypad(display, note),
        h('button', { class: 'btn btn-primary btn-block record-btn', type: 'button', onclick: record }, '記録する')),

      h('section', { class: 'card', 'aria-label': '今日の記録', style: { margin: '12px var(--gutter) 0' } },
        h('div', { class: 'trial-head' },
          h('h2', { style: { fontSize: '16px' } }, '今日の記録'),
          h('span', { class: 'label' }, info.cut != null ? `打ち切り目安 ${formatSeconds(info.cut)}秒` : '3本で目安を出します')),
        info.suggestStop ? h('p', { class: 'stop-banner' }, '目安を超えました。この系統は終了を提案します。') : null,
        mine.length ? h('div', { class: 'swim-list' },
          mine.map((t, i) => {
            const flag = t.valid === false ? '無効' : info.flags[i] ? '目安超え · 平均から外す' : (i < 3 && info.base != null ? '基準' : '');
            return h('button', { type: 'button', class: `swim-row${info.flags[i] ? ' over' : ''}${t.valid === false ? ' invalid' : ''}`, onclick: () => timeMenu(t, i + 1) },
              h('span', { class: 'n' }, `${i + 1}`),
              h('span', { class: 'num t' }, formatSeconds(t.seconds)),
              h('span', { class: 'f' }, flag));
          })) : h('p', { class: 'hint' }, 'この条件のタイムはまだありません。'),
        h('div', { class: 'calc-box' },
          h('div', { class: 'cb' }, h('span', { class: 'k' }, '最高'), h('span', { class: 'num big' }, info.best != null ? formatSeconds(info.best) : '—')),
          h('div', { class: 'cb' }, h('span', { class: 'k' }, `平均(有効 ${info.validCount}/${info.total})`), h('span', { class: 'num big' }, info.average != null ? formatSeconds(info.average) : '—')))),

      others.length ? h('section', { class: 'card', style: { margin: '12px var(--gutter) 0' }, 'aria-label': 'この練習のほかの系統' },
        h('h2', { style: { fontSize: '15px', marginBottom: '6px' } }, 'この練習のほかの系統'),
        h('div', { class: 'trial-past' }, others.map((id) => {
          const list = seriesTimes(id);
          const inf = cutoffInfo(list);
          const s = seriesMap.get(id);
          return h('button', {
            type: 'button', class: 'target-row', onclick: () => { cond = normalizeConditions(list[list.length - 1].conditions); condOpen = false; draw(); },
            'aria-label': `${s?.name ?? ''} に切り替える`,
          },
          h('span', {}, s?.name ?? seriesAutoName(list[0].conditions)),
          h('span', { class: 'num' }, `${list.length}本 · 最高 ${formatSeconds(inf.best)}`),
          h('span', {}));
        }))) : null,

      h('div', { class: 'form-actions' },
        h('div', { class: 'field' },
          h('label', { for: 'pool-date' }, '泳いだ日'),
          h('input', {
            id: 'pool-date', class: 'input', type: 'date', value: session.date, max: localDate(),
            onchange: async (e) => {
              if (!e.target.value) return;
              session = await setPoolSessionDate(session.id, e.target.value);
              times = await listSwimTimes(session.id);
              toast(`日付を ${formatDateJa(session.date)} にしました`);
              draw(true);
            },
          })),
        h('div', { class: 'field' },
          h('label', { for: 'pool-memo' }, 'このスイム記録のメモ'),
          h('textarea', { id: 'pool-memo', class: 'input textarea', rows: 2, onchange: async (e) => { session = await savePoolSession({ ...session, memo: e.target.value }); } }, session.memo || '')),
        h('button', { class: 'btn btn-danger btn-block', onclick: onDelete }, live ? 'このスイム記録を破棄' : 'このスイム記録を削除')),
    ), { showNav: false, keepScroll: keepScroll && !first, redraw: !first });
    first = false;
  }

  draw();
}

