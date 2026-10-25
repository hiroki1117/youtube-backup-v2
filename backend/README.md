# Backend

FastAPI の API と、S3 通知・定期実行で動くイベント処理。全 Lambda で 1 つの ZIP を共有し、handler だけを変える。Python 3.14 / x86_64、依存は [pyproject.toml](pyproject.toml) と [requirements.txt](requirements.txt)。

## 開発

`backend/` 内で:

```bash
make install # .venv を作って依存を入れる
make check   # Ruff と pytest
make export  # ../openapi/openapi.json を router から再生成（CI で差分がないことを検査）
make package # build/backend.zip を生成し、全 handler の import を ZIP 単体で検査
```

ローカル HTTP サーバーはメモリ上の repository を使い、AWS には接続しない（データは再起動で消え、再生 URL はダミー）。

```bash
export BACKEND_LOCAL_TOKEN="$(.venv/bin/python -c 'import secrets; print(secrets.token_urlsafe(32))')"
make dev
curl -H "Authorization: Bearer $BACKEND_LOCAL_TOKEN" http://127.0.0.1:8000/videos
```

AWS 上で必要な環境変数は [.env.example](.env.example) にある（値は infra が Lambda に設定する）。

## 構成

```
entrypoints/   Lambda ごとに 1 ファイル。`handler` を公開し、必要なものだけを組み立てる
api/           HTTP 層（routes・認証・app factory）。API の Lambda と OpenAPI 生成だけが使う
usecases/      業務ロジック（BackupService）とモデル
repositories/  DynamoDB・S3（videos）、Batch・SSM（jobs）、Scrapbox、ローカル用 memory 実装
wiring/        repository を組み立てて BackupService を返す（HTTP 非依存）
```

依存は `entrypoints` → `api`（API のみ）/ `wiring` → `usecases` → `repositories` の一方向。イベント系の handler は FastAPI を読み込まない。

| Lambda | handler | 起動 | 処理 |
|---|---|---|---|
| video | `entrypoints.video.handler` | HTTP API | 動画の登録・一覧・取得・タイトル更新・削除・再生 URL |
| backup | `entrypoints.backup.handler` | HTTP API | バックアップ状態の照会・失敗時の再投入・未完了バックアップの取り消し |
| s3_complete | `entrypoints.s3_complete.handler` | S3 通知 | アップロードされた動画を `complete` にする |
| scrapbox_scan | `entrypoints.scrapbox_scan.handler` | 毎時 | Scrapbox の新しい動画 URL を登録する |
| retry | `entrypoints.retry.handler` | 手動 | 失敗したジョブを最大 100 件まで再投入する |
| comments | `entrypoints.comments.handler` | HTTP API | コメントバックアップの照会・開始 |
| youtube_comments | `entrypoints.youtube_comments.handler` | S3 通知（コメント用バケット `youtube/`） | 取得した YouTube コメントを DynamoDB へ取り込む |

Lambda を足すときは `entrypoints/` に 1 ファイル追加し、[build_lambda.py](build_lambda.py) の `HANDLERS` と [deploy-backend.yml](../.github/workflows/deploy-backend.yml) の `FUNCTIONS` に 1 行足す。関数そのものは infra で作る。

## API

定義は [openapi/openapi.json](../openapi/openapi.json)。認証は API Gateway の Cognito JWT authorizer が行い、アプリは検証済みの `sub` を必須とする。

- `GET /videos`（`upload_status`・`fetch_num` 最大 1000）、`POST /videos`（body: `url`）。登録は新規なら 202 でバックアップを開始し、登録済みなら 200。
- `GET/PATCH/DELETE /videos/{video_id}`、`GET /videos/{video_id}/playback_url`（署名付き URL、1 時間）。
- `GET/POST /videos/{video_id}/backup`: 現在のバックアップの照会と、失敗したジョブの再投入。処理中・完了は再投入しない。
- `GET/POST /videos/{video_id}/comments`: コメントバックアップの照会と開始（再取得）。開始は 202、取得中なら 200 で何もしない。動画のバックアップが未完了なら 409、コメント未対応のプラットフォーム（現状 YouTube 以外）は 422。

対応 URL は YouTube（watch・shorts・live・youtu.be）とその他の URL（URL のハッシュを ID にする）。Twitter / X は未対応で 422 を返す。

## データの扱い

- 既存の DynamoDB 属性・GSI と Batch の環境変数をそのまま使い、ジョブ追跡用の属性（job ID・attempt・state・削除 lock）を必要なレコードにだけ追加する。
- 再投入ごとに S3 キーへ attempt ID を含め、遅れて届いた古い完了通知で新しい試行が完了扱いにならないようにする。
- 動画の削除（`DELETE /videos/{id}`）は `complete` の動画だけで、S3 のファイルと記録を消す。未完了（`init`）の動画は 409 を返し、代わりにバックアップの取り消し（`DELETE /videos/{id}/backup`）を使う。
- バックアップの取り消しは、実行中の Batch ジョブを止めてから未完了の記録を消す（止めないと定期再試行がジョブを再開する）。`complete` の動画には使えず 409。次の場合は何も変えずに 409 を返す: ジョブが SUCCEEDED（ファイルが届く途中）、ジョブが見つからない・状態が未知、投入中または投入結果が不明、S3 に該当キー配下のオブジェクトがある（Batch が FAILED でも拡張子付きのファイルが後から届くため）。S3 の確認はジョブを止める前に行い、拒否したときにジョブだけが止まった状態を残さない。job ID を持たない古い `init` レコードは、オブジェクトがなければ取り消せる。
- 送信結果が不明な投入や途中で失敗した削除は、自動で再試行せず状態を残す（`*_needs_reconciliation`）。job ID を持たない古い `init` レコード（`legacy_untracked`）も自動では再投入しない。

## コメントのバックアップ

動画のバックアップとは別系統で、既存のジョブ・バケット・テーブルは使わない。

```
POST /videos/{id}/comments → comments Lambda: comment_backups を submitting にして、platform のジョブ定義で Batch 投入
  → Batch（batch/scripts/youtube-comments）: yt-dlp でコメントだけ取得し、info.json を gzip で
    コメント用バケットの youtube/<video_id>/<attempt_id>.json.gz へ置く
  → S3 通知 → youtube_comments Lambda: youtube_comments テーブルへ upsert し、comment_backups を complete にする
```

- コメントの形式はプラットフォームごとに違うため、共通化するのは要求の追跡（`comment_backups`）だけ。取得ジョブ・S3 の prefix・取り込み Lambda・コメントのテーブルはプラットフォームごとに持つ。対応 platform は [usecases/comments.py](usecases/comments.py) の `PLATFORMS`。
- S3 の info.json が原本（取得ごとに attempt 別のキーで残る）。DynamoDB には検索に使う項目だけを入れる。
- 取り込みは現在の attempt のオブジェクトだけを反映する。置き換わった attempt の結果は無視するので、失敗・不明な取得は新しい attempt でやり直せる（ジョブが重複しても害がない）。
- 取り込みは upsert のみ。再取得で消えていたコメントも残り、`last_seen_attempt` で最後に取得できた回が分かる。
- 状態: `not_started` / `submitting` / `running` / `awaiting_ingest`（ジョブ成功・取り込み待ち）/ `complete` / `failed`。`running` は照会時に Batch の状態を見て判定する。投入途中で止まった `submitting` は 5 分で `failed` 扱いになる。
- 動画の削除とは連動しない（削除してもコメントは残る）。
