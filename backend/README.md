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
| backup | `entrypoints.backup.handler` | HTTP API | バックアップ状態の照会と失敗時の再投入 |
| s3_complete | `entrypoints.s3_complete.handler` | S3 通知 | アップロードされた動画を `complete` にする |
| scrapbox_scan | `entrypoints.scrapbox_scan.handler` | 毎時 | Scrapbox の新しい動画 URL を登録する |
| retry | `entrypoints.retry.handler` | 手動 | 失敗したジョブを最大 100 件まで再投入する |

Lambda を足すときは `entrypoints/` に 1 ファイル追加し、[build_lambda.py](build_lambda.py) の `HANDLERS` と [deploy-backend.yml](../.github/workflows/deploy-backend.yml) の `FUNCTIONS` に 1 行足す。関数そのものは infra で作る。

## API

定義は [openapi/openapi.json](../openapi/openapi.json)。認証は API Gateway の Cognito JWT authorizer が行い、アプリは検証済みの `sub` を必須とする。

- `GET /videos`（`upload_status`・`fetch_num` 最大 1000）、`POST /videos`（body: `url`）。登録は新規なら 202 でバックアップを開始し、登録済みなら 200。
- `GET/PATCH/DELETE /videos/{video_id}`、`GET /videos/{video_id}/playback_url`（署名付き URL、1 時間）。
- `GET/POST /videos/{video_id}/backup`: 現在のバックアップの照会と、失敗したジョブの再投入。処理中・完了は再投入しない。

対応 URL は YouTube（watch・shorts・live・youtu.be）とその他の URL（URL のハッシュを ID にする）。Twitter / X は未対応で 422 を返す。

## データの扱い

- 既存の DynamoDB 属性・GSI と Batch の環境変数をそのまま使い、ジョブ追跡用の属性（job ID・attempt・state・削除 lock）を必要なレコードにだけ追加する。
- 再投入ごとに S3 キーへ attempt ID を含め、遅れて届いた古い完了通知で新しい試行が完了扱いにならないようにする。
- 削除は `complete` の動画だけ。Batch が FAILED でも拡張子付きのファイルが後から届く可能性があるため `init` は削除しない。
- 送信結果が不明な投入や途中で失敗した削除は、自動で再試行せず状態を残す（`*_needs_reconciliation`）。job ID を持たない古い `init` レコード（`legacy_untracked`）も自動では再投入しない。
