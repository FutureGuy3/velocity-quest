// 水泳選手(スプリント)向けのルーティンのプリセット。選ぶと、自由に直せるルーティンとして作られる。
// 重さは空にしてあり、記録するときに前回の値が入る。休憩は秒。
// 書き方:種目 id、sets(セットの予定の配列)、pap、linkNext('superset' | 'pap' で次の種目とつなぐ)

const W = (reps, rest = 60, extra = {}) => ({ warmup: true, reps, restSec: rest, ...extra });
const S = (n, reps, rest, extra = {}) => Array.from({ length: n }, () => ({ warmup: false, reps, restSec: rest, ...extra }));

export const PRESETS = [
  {
    id: 'upper',
    name: '上半身',
    note: 'プル強化が中心。加重懸垂 → 自重懸垂(PAP ペア)、プルダウンとプッシュダウンのスーパーセット、肩のケア',
    items: [
      { ex: 'back-pullup-weighted', sets: [W(5, 60, { added: 0 }), ...S(3, 3, 180)], pap: true, linkNext: 'pap' },
      { ex: 'back-pullup-bw', sets: S(1, 5, 120) },
      { ex: 'back-straight-arm-pulldown', sets: S(3, 10, 60), linkNext: 'superset' },
      { ex: 'arm-tri-pushdown', sets: S(3, 12, 60) },
      { ex: 'sh-db-press', sets: S(3, 8, 90) },
      { ex: 'sh-face-pull', sets: S(2, 15, 60), linkNext: 'superset' },
      { ex: 'care-side-lying-er', sets: S(2, 15, 60) },
    ],
  },
  {
    id: 'lower',
    name: '下半身',
    note: 'スタートとキック。垂直跳びで調子を確かめ、スクワット → ボックスジャンプ(PAP ペア)、片脚とキックの補強',
    items: [
      { ex: 'test-vertical-jump', sets: [] },
      { ex: 'leg-smith-squat', sets: [W(8, 60), W(5, 90), ...S(3, 3, 180)], pap: true, linkNext: 'pap' },
      { ex: 'plyo-box-jump', sets: S(3, 3, 90) },
      { ex: 'leg-smith-rdl', sets: S(3, 5, 120) },
      { ex: 'leg-smith-bulgarian', sets: S(3, 6, 90) },
      { ex: 'leg-extension', sets: S(2, 12, 60), linkNext: 'superset' },
      { ex: 'glute-hip-adduction', sets: S(2, 15, 60) },
      { ex: 'plyo-ankle-hop', sets: Array.from({ length: 3 }, () => ({ warmup: false, contacts: 20, restSec: 60 })) },
    ],
  },
  {
    id: 'full1',
    name: '全身1',
    note: 'パワー(スタート・プル)。立ち幅跳び、ジャンプスクワット、加重懸垂 → 自重懸垂(PAP ペア)、ヒップスラスト、体幹',
    items: [
      { ex: 'test-standing-long-jump', sets: [] },
      { ex: 'leg-bb-jump-squat', sets: [W(5, 60), ...S(4, 3, 120)] },
      { ex: 'back-pullup-weighted', sets: S(3, 3, 180), pap: true, linkNext: 'pap' },
      { ex: 'back-pullup-bw', sets: S(1, 5, 120) },
      { ex: 'glute-smith-hip-thrust', sets: S(3, 5, 120) },
      { ex: 'core-mb-slam', sets: S(3, 6, 60) },
      { ex: 'core-hanging-leg-raise', sets: S(3, 10, 60) },
    ],
  },
  {
    id: 'full2',
    name: '全身2',
    note: '筋力と補強(キック・プル・ターン)。スクワット、ラットプルダウンとディップスのスーパーセット、レッグプレス、脚の補強、体幹',
    items: [
      { ex: 'test-vertical-jump', sets: [] },
      { ex: 'leg-smith-squat', sets: [W(8, 60), ...S(3, 5, 150)] },
      { ex: 'back-lat-pulldown', sets: S(3, 8, 60), linkNext: 'superset' },
      { ex: 'chest-dips', sets: S(3, 8, 90, { added: 0 }) },
      { ex: 'leg-press', sets: S(3, 10, 90) },
      { ex: 'leg-curl', sets: S(2, 12, 60), linkNext: 'superset' },
      { ex: 'leg-calf-raise', sets: S(2, 15, 60) },
      { ex: 'core-plank', sets: Array.from({ length: 2 }, () => ({ warmup: false, seconds: 45, restSec: 60 })) },
    ],
  },
];
