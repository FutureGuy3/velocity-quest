# 段階1 実装計画(案)

2026-11-08 作成。確定した点は「6. 確定事項」に記録する。

## 1. 作るファイル

```
index.html            1枚のHTML。下部ナビと画面の差し込み口だけを持つ
manifest.json         start_url "./" / scope "./" / display standalone
sw.js                 アプリ本体を事前キャッシュ。Google Fonts は実行時キャッシュ。版つきキャッシュ名
icons/                icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png(180)
css/tokens.css        色・文字・角丸・余白の変数(--accent は設定で上書き)
css/base.css          リセット、body、文字、スクロール
css/components.css    カード、ボタン、チップ、タブ、数字入力、下部ナビ、シート
js/app.js             起動(DB準備→初期データ→ルーター開始)、SW登録
js/router.js          ハッシュルーター(#/path/:id?query)
js/db/schema.js       Dexie のテーブル定義と version()、移行処理
js/db/repo.js         データ層。画面はここだけを使う
js/db/seed.js         data/exercises.json と既定の器具の投入(足りない分だけ追加)
js/domain/recordTypes.js  記録の型ごとの入力欄・表示・ベストの決め方
js/domain/calc.js     合計の重さ、実負荷、推定1RM、体重比、試技の集計、目標の残り
js/ui/dom.js          小さな要素生成ヘルパー(h() と SVG アイコン集、画面の差し替え、日付の表示)
js/ui/screens/        placeholder.js(未作成の画面の仮表示), home.js, picker.js, exerciseEdit.js, routineEdit.js,
                      workoutStart.js, workout.js, history.js, historyDetail.js,
                      metrics.js, goalEdit.js, trialEdit.js, settings.js
js/ui/components/     restTimer.js, numberInput.js, faceScale.js, weightBreakdown.js,
                      sideModeToggle.js, sheet.js(下から出る選択パネル), wakeLock.js
data/exercises.json   既存(99種目)
vendor/dexie.mjs      Dexie 4 の ESM ビルドを固定版で同梱
tests/calc.test.html  calc.js をブラウザで実行して結果を表示
```

## 2. データベース(Dexie)

全テーブル共通:`id, createdAt, updatedAt, deleted, deviceId, ownerId("local")`。
IndexedDB は真偽値をインデックスにできないため、`deleted` での絞り込みは repo.js 内で行う(件数は少ないので問題ない)。
`updatedAt` には全テーブルでインデックスを張る(段階3の差分同期で使う)。

| テーブル | インデックス | 主な項目 |
| --- | --- | --- |
| exercises | `id, updatedAt, bodyPart` | name, bodyPart, subParts[], equipment, recordType, unilateral, increment, restSec, gearId, unit, hidden, builtin, starred |
| gear(器具) | `id, updatedAt` | name, barWeight |
| routines | `id, updatedAt` | name, order, items[{key, exerciseId, sets, reps, restSec, pap}] |
| workouts | `id, updatedAt, date, status` | date(YYYY-MM-DD), startedAt, endedAt, status(active/done), routineId, bodyweight, memo, items[{key, exerciseId, sideMode, restSec, pap}] |
| sets | `id, updatedAt, workoutId, [exerciseId+date]` | workoutId, itemKey, exerciseId, date, order, warmup, sideMode, breakdown{bar, platePerSide, added, assist}, weight, reps, left{weight,reps}, right{weight,reps}, seconds, distance, heightCm, contacts, band, rpeFace(1〜5), memo, done |
| bodyweights | `id, updatedAt, date` | date, kg(同じ日は上書き) |
| trials(試技) | `id, updatedAt, [exerciseId+date], workoutId` | exerciseId(立ち幅跳び等), date, attempts[{value, foul}], memo |
| goals | `id, updatedAt` | title, metric{type, exerciseId, stat}, target, direction(higher/lower), deadline, pinned, manualBest{value, date} |
| settings | `id` | id="user" の1件。unit, accent など(同期対象) |
| meta | `key` | 端末だけの情報:deviceId, seedVersion。**同期・書き出しの対象外** |

- ルーティンの種目並びとトレーニングの種目並びは、レコード内の配列に持つ(並べ替えが1回の更新で済む)。セットは別テーブル(種目ごとの「前回」「自己ベスト」を引くため、同期の単位を小さくするため)。
- `key` は配列内の要素を指す UUID(同じ種目を2回入れても区別できる)。
- 種目は `exerciseId` でのみ参照。名前はその都度引く。

### repo.js の関数(画面から使うのはこれだけ)

`listExercises(filter) / getExercise / saveExercise / hideExercise`、
`listGear / saveGear`、
`listRoutines / getRoutine / saveRoutine / deleteRoutine`、
`startWorkout({routineId}) / getActiveWorkout / getWorkout / updateWorkout / finishWorkout / deleteWorkout / listWorkoutsByDate`、
`listSets(workoutId) / saveSet / deleteSet / getLastSets(exerciseId) / getBest(exerciseId)`、
`saveBodyweight(date, kg) / getBodyweightOn(date) / getLatestBodyweight`、
`listTrials / saveTrial / deleteTrial`、
`listGoals / saveGoal / deleteGoal / getGoalProgress(goal)`、
`getSettings / saveSettings`、`exportAll / importAll`(JSON の書き出し・読み込みも repo.js に置く。全テーブルを1か所で扱うため)。
保存系はすべて内部の `put(table, obj)` を通り、ここで updatedAt・deviceId・ownerId を付ける。段階3ではこの1か所に同期キューを足す。

## 3. 画面と遷移

下部ナビ:ホーム / トレーニング / 指標 / 履歴(サブ画面ではナビを隠し、左上に戻る/閉じる)。

| ルート | 画面 |
| --- | --- |
| `#/home` | 目標カード(上部表示の目標)、今日の体重、ルーティン一覧、ルーティンなしで開始、右上に設定 |
| `#/routine/new` `#/routine/:id` | ルーティン編集(名前、種目の並び替え・削除、セット×回数、休憩、□PAP) |
| `#/picker?to=routine:<id>` / `?to=workout:<id>` | 種目を選ぶ(部位タブ、器具チップ、検索、片側可、複数選択して追加) |
| `#/exercise/new` `#/exercise/:id` | 種目の登録・編集・非表示 |
| `#/exercises` | 種目の管理(非表示の種目も表示して戻せる。設定から入る) |
| `#/workout` | 記録中があればそれを開く。なければ開始画面(ルーティンを選ぶ/空で開始) |
| `#/workout/:id` | トレーニング記録中。終了時に「ルーティンにも反映するか」 |
| `#/metrics` | 目標一覧、立ち幅跳び・垂直跳びの最新試技と最高・平均 |
| `#/goal/new` `#/goal/:id` | 目標の作成・編集 |
| `#/trial/new?ex=<id>` `#/trial/:id` | 試技の入力 |
| `#/history` | 日付ごとの一覧 |
| `#/history/:id` | 練習の詳細(編集は記録画面を編集モードで開く、削除) |
| `#/settings` | 単位、器具とバーの重さ、テーマの色、種目の管理、書き出し・読み込み |

## 4. 作る順番と、区切りごとの確認

0. 土台:index.html / manifest / sw / tokens.css / ルーター / schema・repo・seed / calc.js とテスト。確認:ローカルで開き、初期データの件数表示と tests/calc.test.html が全部緑
1. ホーム:体重の記録、ルーティン一覧(空)、開始ボタン、目標カードの枠
2. 種目を選ぶ・種目の登録編集・ルーティン作成
3. トレーニング記録(大きいので3回に分ける)
   - 3a:開始(ルーティン/空)、weight_reps のセット入力、重さの内訳、完了、休憩タイマー、消灯防止、前回・自己ベスト
   - 3b:他の記録の型(bw_plus / bw_minus / reps / time / height_reps / contacts / distance_band / trials)、片側の3方式、ウォームアップ、感触とメモ
   - 3c:種目の追加・削除・並べ替え、PAP の休憩、終了とルーティンへの反映
4. 履歴
5. 指標(目標・試技)と、ホームの目標カードの中身
6. 設定(単位、器具、テーマ色、書き出し・読み込み、種目の管理)
7. PWA の仕上げ(アイコン、オフライン確認、ホーム画面に追加)

## 5. 既定で決めたこと(問題があれば指摘してほしい)

- ダンベルの重さは「1個の重さ」で記録する(合計の重さ=入力値。ダンベルとわかる表示にする)。
- 重さの内訳はバーのある器具(スミス・バーベル)だけ「バー+プレート片側×2」。それ以外は合計だけ入力。
- 自己ベストの決め方:weight_reps と bw_plus は推定1RMが最大のセット(10回以下)、reps は最大回数、time は最長、height_reps は最高の台、試技は最高値。ウォームアップは除外。
- 「前回」は同じ種目を含む直近の完了済み練習のセット。
- 部位タブは試作の8つに「ケア」を足して9つ、器具チップに「バンド」「その他」を足す(タブとチップは枠内で横にスクロール、ページは横スクロールさせない)。
- `starred` の種目は一覧の先頭に寄せ、小さな印をつける。利用者が付け外しできる。
- 休憩タイマーは開始時刻を保存して残りを計算する(画面を離れても狂わない)。終了時は振動(対応端末)と短い音。アプリを閉じている間の通知は段階1では出さない。
- 記録中の練習は入力のたびに保存し、再読み込みしても続きから再開できる。
- 練習の日付は端末の現地時間で YYYY-MM-DD。
- JSON 読み込みは「統合」(同じ id は updatedAt が新しい方を残す=段階3の同期と同じ規則)。全消去して置き換える方式も確認つきで用意する。
- 段階1に入れない:調子の確認(垂直跳びが5%低い日の提案)、強度の段階、計測方法の初期値。

## 6. 確定事項(2026-11-08 依頼者の回答)

- **目標**:目標は「出したい値の宣言」(目標値と期限)。それとは別に「ベストとその日付」を手で入力する欄を設ける。ホームの「ベスト」は、手入力のベストと記録から出したベストのうち良い方を、日付と一緒に表示する(水泳タイムは段階2まで手入力のみ)。
- **PAP**:種目が重いかどうかをアプリは判断しない。ルーティン作成時に種目ごとに「□PAP」をチェックすると、休憩が3分になり、タイマーに「PAP」と表示する。
  - 組み合わせ(例:加重懸垂 → 自重懸垂)は、利用者がルーティンの並び順で自由に決める。専用の「ペア」設定は作らない。
  - PAP の種目の最後のセットを完了すると、3分タイマーに「次:(並びで次の種目)」と表示する。
  - 加重懸垂 → 自重懸垂のペアは、段階4のプリセットのサンプルとして入れる(段階1では作らない)。
  - トレーニング中も種目ごとに PAP を付け外しできる。
- **試技**:トレーニング記録の画面と指標の画面の両方から入力できる。保存先は同じ試技のテーブル。
- **単位**:kg に固定。設定に単位の項目は置かない。跳躍は立ち幅跳び m、垂直跳び cm。
- **最初から入っている種目の id**:exercises.json の id をそのまま使う(どの端末でも同じ id になり、同期で二重にならない)。自分で登録した種目は UUID。
- **作る順番**:履歴 → 指標(目標・試技)→ 設定。
- **目標の表示**:ホーム上部に複数の目標を出せる。左右のスワイプで切り替える(2026-11-08 依頼)。進み具合の棒は出さない。
- **進め方**:段階1の残りの画面をまとめて作る(2026-11-08 依頼)。
- **2026-11-10 修正依頼の反映**
  - 目標は「出したい値」なので「切り」は付けない。
  - ルーティンはセットごとに重さ・回数・休憩・ウォームアップを予定できる(データ版2。版1の「セット数×回数」は自動で移行。古い書き出しファイルも読み込み時に移行)。
  - 並べ替えは「並べ替え」ボタン → 一覧で ≡ をドラッグ。
  - 感触の顔は色(赤→橙→黄→黄緑→緑)と表情で区別する。
  - 隣の種目とのつなぎ(item.link = { type: 'superset' | 'pap', toKey })。スーパーセットは途中の種目のあと休まず次へ、最後の種目のあとに休憩して最初へ戻る。PAP ペアは前の種目を PAP(3分)で行い、最後のセットのあと次の種目へ。並びが変わって隣でなくなったつなぎは外す。
- **2026-11-10 追加依頼の反映(版 0.6.0)**
  - 休憩の既定値は1分。種目の登録画面の「休憩の初期値」はなくした。
  - 休憩は分と秒のボタン(秒は15秒ずつ)と、よく使う時間のボタンで決める。
  - 重さ・回数・秒・高さ・接地回数・距離は −/+ のボタンで入れる。重さの幅は種目の「重さの刻み」×1・×2・×4。空の欄は前のセット(なければ前回の記録)の値から始める。試技と体重はキーボードのまま。
  - 指標に「種目のベストの推移」。表示する種目は settings.trackedExercises に持つ。体重を記録し始める前の練習は、一番近い後の体重で実負荷を出す(基準をそろえるため)。
  - 種目に「水泳の目的」(swim: start/turn/pull/kick、複数可)。初期データは版2。既存の種目には、まだ持っていないときだけ入れる。
  - 「懸垂(自重)」を初期データに追加。
  - プリセット4つ(js/domain/presets.js)。選ぶと普通のルーティンとして作られ、自由に直せる。
- **2026-11-10 重ねるグラフの時期**:設計どおり段階2で、プールのタイム入力・系統と一緒に作る(依頼者が決定)。段階1の「種目のベストの推移」は1種目の一覧で、段階2の系統の1本分としてそのまま使う。
- **2026-11-10 体重と目標の推移(版 0.7.0、データ版3)**
  - 体重の画面(#/bodyweight):期間(30日/90日/1年/すべて)の推移、最新・期間の変化・最高と最低、日付を選んで記録、値を直す、削除(論理削除)。
  - 目標に targets(目標値の履歴:value, deadline, setOn, endedOn, result=achieved|changed)と bestLog(手入力のベストの記録)を持たせた。版2の目標は自動で移行、古い書き出しファイルも読み込み時に移行。
  - 編集画面で目標値を書き換えるのは「訂正」(履歴は増えない)。「次の目標を立てる」で履歴に残す。ベストが届いていれば「達成」、届いていなければ「変更」。
  - 目標ごとの小さなグラフ:目標値の段差(破線、達成は○、いまの目標は期限まで)とベストの点。段階2の重ねるグラフでは、目標の履歴も1本の系統として重ねる。
- **2026-11-10 さかのぼって入力(版 0.7.1)**:目標の履歴は「+ 過去の目標」(立てた日・終えた日・結果)で足せ、各行を押して直す・消すことができる(立てた日の順に並べ、最後の1つを「いまの目標」にする)。「次の目標を立てる」は切り替えた日と結果(達成/変更)を選べる。手で入れたベストも過去の分を足す・直す・消すことができ、「ベスト」は記録の中で一番良いものにそろえる。
- **2026-11-10 お気に入り・種目の変更・間に追加(版 0.8.0、データ版4)**
  - 初期データの「よく使う」(starred)は依頼者の主観なのでやめ、利用者が ☆ で付ける favorite にした(版4で既存の starred を外す)。種目を選ぶ画面に「お気に入り」タブ。
  - トレーニング中の「種目を変更する」:完了したセットがなければその場で入れ替え(セット数・回数・休憩・ウォームアップは残し、重さは新しい種目の前回の値)。完了したセットがあれば、その分は元の種目として残し、残りを新しい種目として直後に入れる。ルーティン作成の画面にも同じメニュー。
  - ルーティンの種目の間に「+ 種目を追加」。つないだ種目の間に入れたときは、つなぎを外して知らせる。
