// 記録の型の定義(docs/design.md「記録の型と計算ルール」)
export const RECORD_TYPES = {
  weight_reps:   { label: '重量×回数',     fields: ['weight', 'reps'] },
  bw_plus:       { label: '自重+加重',     fields: ['added', 'reps'] },
  bw_minus:      { label: '自重−アシスト', fields: ['assist', 'reps'] },
  reps:          { label: '回数のみ',       fields: ['reps'] },
  time:          { label: '時間',           fields: ['seconds'] },
  height_reps:   { label: '高さ×回数',     fields: ['heightCm', 'reps'] },
  contacts:      { label: '接地回数',       fields: ['contacts', 'seconds'] },
  distance_band: { label: '距離+バンド',   fields: ['distance', 'band'] },
  trials:        { label: '試技',           fields: ['attempts'] },
};

export const RECORD_TYPE_KEYS = Object.keys(RECORD_TYPES);

export function recordTypeLabel(key) {
  return RECORD_TYPES[key]?.label ?? key;
}

/** 片側の記録方式 */
export const SIDE_MODES = {
  both: '両側',
  same: '片側・左右同じ',
  split: '片側・左右別',
};

export const BODY_PARTS = ['胸', '背中', '肩', '腕', '脚', '臀部', '体幹', 'プライオ', 'ケア'];
export const EQUIPMENT = ['スミス', 'バーベル', 'ダンベル', 'ケーブル', 'マシン', 'ケトルベル', '自重', 'バンド', 'その他'];

/** 感触(顔5段階) */
export const FACES = ['とてもきつい', 'きつい', 'ふつう', '良い', 'とても良い'];

/** 休憩タイマーの選択肢(秒)。null は任意 */
export const REST_PRESETS = [
  { label: '30秒', sec: 30 },
  { label: '1分', sec: 60 },
  { label: '90秒', sec: 90 },
  { label: '2分', sec: 120 },
  { label: '3分 PAP', sec: 180, pap: true },
  { label: '任意', sec: null },
];
export const PAP_REST_SEC = 180;

/** ルーティンの「予定の回数」の単位(記録の型ごと) */
export function planUnit(recordType) {
  switch (recordType) {
    case 'time': return '秒';
    case 'distance_band': return 'm';
    case 'trials': return '本';
    default: return '回';
  }
}
