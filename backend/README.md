# Backend

FastAPI の API と、S3 通知・定期実行のイベント処理。全 Lambda で 1 つの ZIP を共有し、handler だけを変える。Python 3.14 / x86_64、依存は [pyproject.toml](pyproject.toml) と [requirements.txt](requirements.txt)。

## 開発

`backend/` 内で:

```bash
make install # .venv を作って依存を入れる
make check   # Ruff と pytest
make export  # ../openapi/openapi.json を再生成（CI で差分なしを検査）
make package # build/backend.zip を生成し、全 handler の import を検査
```

ローカルサーバーはメモリ上の repository を使い、AWS には接続しない（再起動でデータは消え、再生 URL はダミー）。

```bash
export BACKEND_LOCAL_TOKEN="$(.venv/bin/python -c 'import secrets; print(secrets.token_urlsafe(32))')"
make dev
curl -H "Authorization: Bearer $BACKEND_LOCAL_TOKEN" http://127.0.0.1:8000/videos
```

AWS 上の環境変数は [.env.example](.env.example)（値は infra が設定）。

## 構成

```
entrypoints/   Lambda ごとに 1 ファイル。handler を公開
api/           HTTP 層（routes・認証）。API Lambda と OpenAPI 生成だけが使う
usecases/      業務ロジック（BackupService）とモデル
repositories/  DynamoDB・S3、Batch・SSM、Scrapbox、ローカル用 memory 実装
wiring/        repository を組み立てて BackupService を返す
```

依存は `entrypoints` → `api` / `wiring` → `usecases` → `repositories` の一方向。イベント系 handler は FastAPI を読み込まない。

| Lambda | handler | 起動 | 処理 |
|---|---|---|---|
| video | `entrypoints.video.handler` | HTTP API | 動画の登録・一覧・取得・更新・削除・再生 URL |
| backup | `entrypoints.backup.handler` | HTTP API | バックアップの照会・再投入・取り消し |
| s3_complete | `entrypoints.s3_complete.handler` | S3 通知 | 動画を `complete` にし、対応 platform ならコメントのバックアップを開始する |
| scrapbox_scan | `entrypoints.scrapbox_scan.handler` | 毎時 | Scrapbox の新しい動画 URL を登録 |
| retry | `entrypoints.retry.handler` | 手動 | 失敗ジョブを最大 100 件再投入 |
| comments | `entrypoints.comments.handler` | HTTP API | コメントバックアップの照会・開始、コメントの一覧 |
| youtube_comments | `entrypoints.youtube_comments.handler` | S3 通知（コメント用バケット `youtube/`） | 取得した YouTube コメントを DynamoDB へ取り込む |
| comments_backfill | `entrypoints.comments_backfill.handler` | 毎時（一時的） | コメントのバックアップがない完了済み動画を、1 回に `limit` 本ずつ開始する（下記） |

Lambda を足すときは `entrypoints/` に 1 ファイル追加し、[build_lambda.py](build_lambda.py) の `HANDLERS` と [deploy-backend.yml](../.github/workflows/deploy-backend.yml) の `FUNCTIONS` に 1 行足す。関数本体は infra で作る。

## API

定義は [openapi/openapi.json](../openapi/openapi.json)。認証は API Gateway の Cognito JWT authorizer が行い、アプリは検証済みの `sub` を必須とする。

| エンドポイント | 内容 |
|---|---|
| `GET /videos` | 一覧（`upload_status`、`fetch_num` 最大 1000） |
| `POST /videos` | 登録（body: `url`）。新規は 202 でバックアップ開始、登録済みは 200 |
| `GET/PATCH /videos/{id}` | 取得・タイトル更新 |
| `DELETE /videos/{id}` | 削除。`complete` のみ（S3 ファイルと記録、コメントのバックアップを消す）。未完了は 409 |
| `GET /videos/{id}/playback_url` | 署名付き URL（1 時間） |
| `GET /videos/{id}/backup` | バックアップ状態の照会 |
| `POST /videos/{id}/backup` | 失敗ジョブの再投入。処理中・完了は不可 |
| `DELETE /videos/{id}/backup` | 未完了バックアップの取り消し。`complete` は 409 |
| `GET /videos/{id}/comments/backup` | コメントバックアップの状態の照会 |
| `POST /videos/{id}/comments/backup` | コメントの取得開始（再取得も同じ）。開始は 202、取得中は 200。動画が未完了なら 409、YouTube 以外は 422 |
| `GET /videos/{id}/comments` | バックアップしたコメントをスレッド単位で返す（`offset`・`limit` 最大 100）。形式は platform ごと（現状 YouTube のみ、それ以外は 422） |

対応 URL は YouTube（watch・shorts・live・youtu.be）とその他の URL（URL のハッシュを ID にする）。Twitter / X は未対応で 422。

## データの扱い

- 既存の DynamoDB 属性・GSI と Batch の環境変数を使い、ジョブ追跡用属性（job ID・attempt・state・削除 lock）を必要なレコードにだけ追加する。
- 再投入ごとに S3 キーへ attempt ID を含め、古い完了通知で新しい試行が完了扱いにならないようにする。
- 取り消しは S3 を確認してから Batch ジョブを止め、未完了の記録を消す（ジョブを止めないと定期再試行が再開する）。次の場合は何も変えず 409:
  - ジョブが SUCCEEDED、見つからない、状態が未知
  - 投入中、または投入結果が不明
  - S3 に該当キー配下のオブジェクトがある（FAILED でも拡張子付きファイルが後から届くため）
- job ID を持たない古い `init` レコードは、オブジェクトがなければ取り消せる。
- 送信結果が不明な投入や途中で失敗した削除は、自動再試行せず状態を残す（`*_needs_reconciliation`）。job ID のない古い `init`（`legacy_untracked`）も自動では再投入しない。

## コメントのバックアップ

動画のバックアップとは別系統で、既存のジョブ・バケット・テーブルは使わない。

```
POST /videos/{id}/comments/backup（comments Lambda）または動画の complete（s3_complete Lambda）
  → CommentService.start: comment_backups を submitting にして、platform のジョブ定義で Batch 投入
  → Batch（batch/scripts/youtube-comments）: yt-dlp でコメントだけ取得し、コメント JSON を gzip で
    コメント用バケットの youtube/<video_id>/<attempt_id>.json.gz へ置く
  → S3 通知 → youtube_comments Lambda: youtube_comments テーブルへ upsert し、comment_backups を complete にする
```

- コメントの形式はプラットフォームごとに違うため、共通化するのは要求の追跡（`comment_backups`）だけ。取得ジョブ・S3 の prefix・取り込み Lambda・コメントのテーブルはプラットフォームごとに持つ。対応 platform は [usecases/comments.py](usecases/comments.py) の `PLATFORMS`。
- S3 のコメント JSON（yt-dlp の `id`・`comment_count`・`comments` だけ。字幕・フォーマット一覧は含まない）が原本で、取得ごとに attempt 別のキーで残る。DynamoDB には検索に使う項目だけを入れる。
- 取り込みは現在の attempt のオブジェクトだけを反映する。置き換わった attempt の結果は無視するので、失敗・不明な取得は新しい attempt でやり直せる（ジョブが重複しても害がない）。
- 取り込みは upsert のみ。再取得で消えていたコメントも残り、`last_seen_attempt` で最後に取得できた回が分かる。
- 一覧は動画 1 本分のコメントをまとめて読み、固定コメント→新しい順に親コメントを並べ、返信を古い順で親の下に付けてからページを切り出す。最後に完了した取得（`completed_attempt`）に含まれなかったコメントは `removed`（YouTube では削除済み）になる。
- 状態: `not_started` / `submitting` / `running` / `awaiting_ingest`（ジョブ成功・取り込み待ち）/ `complete` / `failed`。`running` は照会時に Batch の状態を見て判定する。投入途中で止まった `submitting` は 5 分で `failed` 扱いになる。
- 動画のバックアップが完了すると、`s3_complete` が続けてコメントのバックアップを開始する（Scrapbox から登録した動画も含む）。開始に失敗してもログに残すだけで、動画の完了は失敗にしない（画面から後で開始できる）。
- 動画を削除すると、削除ロックを取った後・動画を消す前に、実行中のコメント取得ジョブを止め、`comment_backups` の記録、コメント用バケットの原本、コメントのテーブルを消す。途中で失敗したらロックを残して止まる（動画の部分削除と同じく要照合）。バケットは versioning 有効なので、原本は削除マーカーが付くだけで過去のバージョンは残る。

### 既存動画のコメントの一括取得（一時的）

コメントのバックアップ導入前に完了していた動画は、`comments_backfill` が毎時少しずつ取得する。

- 毎時の入力 `{"limit": N}`（infra が設定）の本数まで、`complete` の YouTube 動画のうち `comment_backups` に記録がないものを新しい順に `CommentService.start` で開始する。
- 記録がない動画だけを選ぶので、失敗した動画をここで再試行することはなく、一巡すると終わる（失敗分は画面から再取得する）。投入が 503 で失敗したら、その回はそこで止める。
- 開始する動画がなくなると、自分のスケジュール（`COMMENTS_BACKFILL_RULE_NAME`）を無効化する。手動で `{"limit": N}` を渡して invoke してもよい。
- 一巡したら、[entrypoints/comments_backfill.py](entrypoints/comments_backfill.py)・[tests/test_comments_backfill.py](tests/test_comments_backfill.py)・`CommentService.backfill` と、`HANDLERS`・`FUNCTIONS` の行を消す。先に infra の関数を消すと配布が失敗するため、アプリ側を先に消す。
