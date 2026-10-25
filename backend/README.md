# Backend

FastAPI の API と、S3 通知・定期実行のイベント処理。全 Lambda で 1 つの ZIP を共有し、handler だけを変える。Python 3.14 / x86_64。

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
| s3_complete | `entrypoints.s3_complete.handler` | S3 通知 | 動画を `complete` にする |
| scrapbox_scan | `entrypoints.scrapbox_scan.handler` | 毎時 | Scrapbox の新しい動画 URL を登録 |
| retry | `entrypoints.retry.handler` | 手動 | 失敗ジョブを最大 100 件再投入 |

Lambda を足すときは `entrypoints/` に 1 ファイル追加し、[build_lambda.py](build_lambda.py) の `HANDLERS` と [deploy-backend.yml](../.github/workflows/deploy-backend.yml) の `FUNCTIONS` に 1 行足す。関数本体は infra で作る。

## API

定義は [openapi/openapi.json](../openapi/openapi.json)。認証は API Gateway の Cognito JWT authorizer が行い、アプリは検証済みの `sub` を必須とする。

| エンドポイント | 内容 |
|---|---|
| `GET /videos` | 一覧（`upload_status`、`fetch_num` 最大 1000） |
| `POST /videos` | 登録（body: `url`）。新規は 202 でバックアップ開始、登録済みは 200 |
| `GET/PATCH /videos/{id}` | 取得・タイトル更新 |
| `DELETE /videos/{id}` | 削除。`complete` のみ（S3 ファイルと記録を消す）。未完了は 409 |
| `GET /videos/{id}/playback_url` | 署名付き URL（1 時間） |
| `GET /videos/{id}/backup` | バックアップ状態の照会 |
| `POST /videos/{id}/backup` | 失敗ジョブの再投入。処理中・完了は不可 |
| `DELETE /videos/{id}/backup` | 未完了バックアップの取り消し。`complete` は 409 |

対応 URL は YouTube（watch・shorts・live・youtu.be）とその他の URL（URL のハッシュを ID にする）。Twitter / X は未対応で 422。

## データの扱い

- 既存の DynamoDB 属性・GSI と Batch の環境変数を使い、ジョブ追跡用属性（job ID・attempt・state・削除 lock）を必要なレコードにだけ追加する。
- 再投入ごとに S3 キーへ attempt ID を含め、古い完了通知で新しい試行が完了扱いにならないようにする。
- 取り消しは S3 を確認してから Batch ジョブを止め、未完了の記録を消す（ジョブを止めないと定期再試行が再開する）。次の場合は何も変えず 409:
  - ジョブが SUCCEEDED、見つからない、状態が未知
  - 投入中、または投入結果が不明
  - S3 に該当キー配下のオブジェクトがある（FAILED でも拡張子付きファイルが後から届くため）
  - job ID を持たない古い `init` レコードは、オブジェクトがなければ取り消せる
- 送信結果が不明な投入や途中で失敗した削除は、自動再試行せず状態を残す（`*_needs_reconciliation`）。job ID のない古い `init`（`legacy_untracked`）も自動では再投入しない。
