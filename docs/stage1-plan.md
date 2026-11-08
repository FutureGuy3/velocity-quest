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
