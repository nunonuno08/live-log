# ライブ記録アプリ（live-log）引き継ぎメモ

ライブ参戦を記録する個人用アプリ。iPhone の Safari から「ホーム画面に追加」して使う PWA。
ユーザー本人と、将来は友達1人が使う想定。

- 公開URL: https://nunonuno08.github.io/live-log/
- リポジトリ: https://github.com/nunonuno08/live-log （main に push すると GitHub Pages に自動反映）
- 現在のバージョン: v0.8.1（`js/views/settings.js` の `VERSION`）

## ユーザーとの約束・好み（必ず守る）

- **返答は日本語**。説明は専門用語を避けて分かりやすく。
- **無料のサービスだけ**を使う（有料プランや有料の開発者登録は提案しない）。
- ユーザーは説明が面倒なタイプ。**ある程度は推測して進めてよい**が、仕様を勝手に変えすぎない。
- デザインは元アプリ（LiveRock）に寄せない独自デザイン。ただしライブ詳細の写真の見せ方は元アプリ風が希望。
- 変更したら、ローカルのブラウザで動作確認 → コミット → push → 日本語で報告、の流れ。
- iPhone 実機でしか確認できないこと（共有、OCR の速度、Spotify ログインの戻り等）は「未確認」と伝える。

### これまでに却下・指定された仕様（戻さないこと）
- 開場・開演の時刻入力: 独自UI（時と分のグリッド、横スクロール、ボタン並べ、独自ホイール）は全て不評。
  **iPhone標準の time ピッカー**を使う。空欄をタップしたら**過去の記録から予測した時刻**を入れる
  （同じツアー名 → 同じ会場 → よく使う時刻 → 17:00）。**固定の15:00初期値は廃止**。
  開演は同じツアー/会場の時刻、なければ**開場の2時間後**を自動入力。
- iTunes に登録された曲名（例「燦然 - Sanzen」）は**表示を変えない**。照合（検索・読み取り）のときだけ英字部分を無視する。
- 不要とされた項目: 評価(★)、お気に入り、同行者、URL、カレンダー追加、MC/SE/VCR（セトリの区切りは**アンコールのみ**）。
- 写真は**1ライブ1枚**（クラウド容量節約のため）。
- Spotify プレイリストの説明文にアプリ名は入れない（「◯◯ のセットリスト」だけ）。

## 技術構成

- ビルドなしの素の HTML/CSS/JS（ES Modules）。PC は Windows、**Node/Python は入っていない**。
- 端末内保存: IndexedDB（`js/db.js`）。オフラインでも動く（`sw.js` がキャッシュ）。
- クラウド同期: Supabase（無料プラン）。`js/vendor/supabase.js` に supabase-js 2.117.1 を同梱。
- 外部データ（すべて無料・キー不要、端末から直接呼ぶ）:
  - iTunes Search API: アーティスト候補、曲一覧、ジャケット画像（CORS可）
  - Deezer API（JSONP）: アーティスト写真
  - Photon（OpenStreetMap）: 会場検索
  - 日本語版 Wikipedia API: ツアー名の候補
  - Tesseract.js 7（jsDelivr から遅延読み込み）: 画像からセトリを読み取る（端末内処理）
- Spotify Web API（PKCE。Client ID は公開前提の値）: プレイリスト作成。開発モードのためオーナーは Premium 必須・最大5ユーザー。

### 外部サービスの設定値（すべて公開して問題ない値）
- Supabase: プロジェクト `orytpvfmcganvnyyruye`（https://orytpvfmcganvnyyruye.supabase.co）、
  publishable key は `js/sync.js` に記載。テーブル定義は `supabase/schema.sql`（実行済み）。
  Email ログイン、Confirm email はオフ。Secret/service_role キーは**絶対に使わない・受け取らない**。
- Spotify: Client ID は `js/spotify.js`。Redirect URI は `https://nunonuno08.github.io/live-log/`。
- 休止対策: `.github/workflows/keepalive.yml` が3日ごとに Supabase の `rpc/ping` を呼ぶ（無料プランは7日無アクセスで停止するため）。

## ファイル構成

| ファイル | 役割 |
|---|---|
| `index.html` | 画面の骨組み、下部タブ（アーティスト/ライブ/統計/設定）、テーマの先読み |
| `css/style.css` | 全スタイル。ライト/ダーク（`html[data-theme]` で手動切替も可） |
| `sw.js` | オフライン用キャッシュ。**更新時は `CACHE` の番号を上げる** |
| `js/app.js` | ルーティング（`#/`, `#/lives`, `#/artist/:id`, `#/live/:id`, `#/new`, `#/edit/:id`, `#/stats`, `#/song/:id`, `#/venue/:id`, `#/settings`）、起動処理 |
| `js/store.js` | データの読み書き、曲・会場の名寄せ、削除記録（tombstone）、旧データの変換 |
| `js/util.js` | 文字列の正規化（`matchKey`/`songKey`/`venueKey`/`baseTitle`/`stripRomaji`）、類似度、テーマ切替など |
| `js/music.js` | iTunes/Deezer/Photon/Wikipedia の取得、会場リスト |
| `js/setlist.js` | 貼り付け・OCR テキストの解析、曲一覧との照合 |
| `js/sync.js` | Supabase 同期、ログイン |
| `js/spotify.js` | Spotify で開くリンク、PKCE ログイン、プレイリスト作成 |
| `js/share.js` | セトリのシェア画像（1080×1920）を canvas で描画 |
| `js/ui.js` | ボトムシート、候補表示、アーティスト選択、画像の範囲選択 |
| `js/components.js` | チケット風のライブ行、アバター等の共通部品 |
| `js/views/*.js` | 各画面（home=アーティスト一覧, lives, artist, live=詳細, edit=入力, stats, detail=曲/会場, settings） |
| `serve.ps1` / `.claude/launch.json` | ローカル確認用サーバー（http://localhost:8080） |

## データモデル（IndexedDB `livelog` v2）

- `artists`: `{id, name, itunesId, photoId, createdAt, updatedAt}`
- `songs`: `{id, artistId, title, key, aliases[], artwork, ...}` — 曲は**ID で数える**。
  `key = songKey(title)`: 全角半角・大小・カタカナ/ひらがな・記号を無視、「(ALBUM ver.)」「feat.」等を除去、
  日本語曲名の末尾の英字（「 - Sanzen」「(AA1)」）も照合時だけ無視。重複は「まとめる」で統合し旧表記は `aliases` に残す。
- `venues`: `{id, name, key, aliases[], area, lat, lon}` — 「(TOKYO)」等の括弧は照合時に無視。
- `lives`: `{id, artistIds[], title, type, date, venueId, openTime, startTime, setlist[{kind:'song',songId}|{kind:'en'}], seat, expenses[{category,amount}], memo, photoIds[], createdAt, updatedAt}`
- `photos`: `{id, blob}`（圧縮JPEG）、`catalogs`: iTunes 曲一覧 / `tours:<artistId>` のキャッシュ（30日、バックアップ・同期対象外）
- 変換処理: 起動時に v1 形式（曲名・会場名を直書き）を自動変換。曲キーのルール変更時は `SONG_KEYS_VERSION` を上げると再計算・統合される。
  カタログ/ツアーのキャッシュは `CATALOG_VERSION` / `TOURS_VERSION` を上げると作り直される。
- **ユーザーのデータは消さずに使い続ける前提**。形式を変えるときは必ず自動変換を書く。

## 同期の仕様（`js/sync.js`）

- Supabase の `records` テーブル（1行=1レコード、`kind`/`id`/`data`/`deleted`/`updated_at`/`server_at`）。RLS で本人の行だけ。
- 変更の数秒後・起動時・ネット復帰時に同期。アップロード→写真→ダウンロードの順。**新しい方の変更が勝つ**。
- 削除は tombstone（localStorage）で送る。削除時刻は必ずそのレコードの最終更新より新しくする。
- 写真は Storage の `photos/<user id>/<photo id>.jpg`。
- ログアウト中の「データ削除」は端末のみ（クラウドには送らない）。ログイン中は端末＋クラウド。

## 主な機能（v0.8.1 時点）

- アーティスト登録: iTunes 候補から選択（写真付き表示）。写真は自動設定、候補から選び直し可。
- ライブ記録: アーティスト（複数可）、日付、種別、ツアー名（過去の記録＋Wikipedia の候補、開催年が近い順）、
  会場（履歴＋主要会場＋地図検索）、開場/開演（予測入力）、セトリ、座席、支出、写真1枚、メモ。
- セトリ入力: 曲名の予測（曲一覧＋履歴、表記ゆれ対応）、アンコール区切り、並べ替え、貼り付け、
  画像から読む（範囲指定 → OCR 2パス → 曲一覧と照合、一覧にない行は「もしかして」候補）。
- 複数アーティストのセトリは**アーティストごとに見出し＋番号**（アンコールで戻ったら続きの番号）。
- ライブ詳細: 写真が背景に溶け込む大きな表示、各曲に「初/N回目」と Spotify ボタン、複製、共有（画像/テキスト）、Spotify プレイリスト作成。
- 統計: 概要（アーティストのリング、ハイライト、支出内訳）、アーティスト（表彰台）、曲（上位3曲カード）、年、会場（座席の履歴）。
- 設定: クラウド同期ログイン、Spotify 接続解除、バックアップ保存/復元、表示（端末に合わせる/ライト/ダーク）、データ削除。

## 開発・確認・公開の手順

1. ローカル確認: ブラウザペインで `preview_start`（name: `live-app`）→ モバイル表示で動作確認。
   確認用のテストデータは最後に必ず削除する（IndexedDB と localStorage を消す）。
2. 変更したら `sw.js` の `CACHE` 番号と `settings.js` の `VERSION` を上げる。
3. コミット（日本語の要約＋`Co-Authored-By` 行）→ `git push origin main`。1〜2分で公開URLに反映。
4. iPhone 側はアプリを1〜2回開き直すと新しい版になる。
- 参考用スクショ（`IMG_*.png`）は `.gitignore` 済み。公開しない。

## 既知の制約・注意

- Wikipedia の表記が省略形のアーティストがいる（例: Kroi の最近のツアー）。候補には「Wikipedia・年」と出典を表示している。
- OCR は凝った字体に弱い。写真アプリの「テキスト認識表示」でコピー→「貼り付け」も案内済み。
- iOS のホーム画面アプリと Safari はデータが別。記録はホーム画面のアプリから。

## 今後の候補（ユーザーが検討中）

- **setlist.fm 連携**（正式なツアー名・セトリの取り込み。無料APIキー＋CORS対策が必要）→「今後の予定」扱い
- 提案済みで未着手: セトリ予想、曲の達成率、会場マップ、チケット管理（当落・入金期限）、年間まとめ、カウントダウン表示
