# Backend

FastAPI routes / Pydantic を新 API の正とする実装候補。本番と未照合の旧コードは `lambda/` に保全し、新 ZIP には含めない。本番配布は未切替。
Python の要件と依存は [pyproject.toml](pyproject.toml)、解決した runtime 依存は [requirements.lock](requirements.lock)。
[AWS 公式 runtime 一覧](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html) を確認し、最新の正式安定版 Python 3.14 を採用（3.15 は preview）。

## 最短手順

Python 3.14 を用意し、`backend/` 内で:

```bash
make install
make check
make export # ../openapi/openapi.json を同じ router から生成
make package # 全 Lambda 共通の ZIP を 1 つ生成（handler は Lambda の設定で切替）
export BACKEND_LOCAL_TOKEN="$(.venv/bin/python -c 'import secrets; print(secrets.token_urlsafe(32))')"
make dev
```

別 terminal から、同じ local token を環境変数へ設定してアクセス:

```bash
curl -H "Authorization: Bearer $BACKEND_LOCAL_TOKEN" http://127.0.0.1:8000/videos
```

`make dev` は専用 memory repository を使い AWS へ接続しない。登録・更新・backup 状態は再起動で消え、URL はダミー。実動画取得の検証ではない。
wheel と ZIP は `build/` に生成（`build/backend.zip` 1 つ）。共有コードと固定 runtime 依存を同梱し、全 handler の import を個別に検査する。Layers / AWS 配布工程は追加していない。現ターゲットは Lambda python3.14 / x86_64。

## 構成と Lambda の単位

```
entrypoints/   Lambda ごとに 1 ファイル。`handler` を公開し、必要なものだけを組み立てる
  video.py  backup.py  s3_complete.py  scrapbox_scan.py  retry.py
api/           HTTP 層（routes・認証・app factory）。API の Lambda と OpenAPI 生成だけが使う
usecases/      業務ロジック（BackupService）とモデル
repositories/  Dynamo / S3 / Batch / Scrapbox（と local 用 memory 実装）
wiring/        Repository を組み立てて BackupService を返す（HTTP 非依存）
```

依存は `entrypoints` → `api`（API のみ）/ `wiring` → `usecases` → `repositories` の一方向。ZIP は 1 つで、5 つの Lambda は次の handler だけを変えて同じ ZIP を指す。

| Lambda        | handler                          |
| ------------- | -------------------------------- |
| video         | `entrypoints.video.handler`         |
| backup        | `entrypoints.backup.handler`        |
| s3_complete   | `entrypoints.s3_complete.handler`   |
| scrapbox_scan | `entrypoints.scrapbox_scan.handler` |
| retry         | `entrypoints.retry.handler`         |

Lambda を足すときは `entrypoints/` に 1 ファイル追加し、`build_lambda.py` の `HANDLERS` へ 1 行足す（import 検査と一覧出力が自動で対象になる）。

## API と境界

- `POST /videos`（body: `url`）は旧登録の意味を保ち、Video 登録と初回 backup を開始。新規受付202、既登録200。既存IDを維持し、UUIDへ変更しない。
- `GET /videos`、`GET/PATCH/DELETE /videos/{video_id}`、`GET /videos/{video_id}/playback_url`。
- `GET/POST /videos/{video_id}/backup` は1つの現在の backup を照会・操作。公開 `/backup_requests` は追加しない。失敗した追跡済みjobだけ再試行し、処理中・完了は再投入しない。
- `entrypoints.video.handler` / `entrypoints.backup.handler` は同じ router を使うリソース別 Mangum 入口（`/docs`・`/redoc`・`/openapi.json`等の自動HTTP入口は全実行appで無効。offline `app.openapi()` exportは維持）。認証は API Gateway authorizer の検証済み `sub` が必須。Bearer header だけでは Lambda を認可しない。IAMによる直接invoke制限も infra の責務。
- 旧 frontend は現APIに認証headerを付けていないため、新APIへの接続変更・Gateway authorizer設定・CORS/権限の実検証が切替前に必要。現frontendを新APIへ接続したとは扱わない。
- ローカルHTTPは runtime の `BACKEND_LOCAL_TOKEN` が必要で、未設定時は拒否。import 時の AWS接続なし。AWS resource はrequest/invocation単位で構築し、HTTP request間で共有しない。
- `entrypoints.s3_complete.handler` / `scrapbox_scan.handler` / `retry.handler` は HTTP化せず、FastAPI を読み込まない。AWS invoke/triggerの認可はinfra。`VideoRepository` はDynamo/S3/メタデータ、`JobRepository` はBatch登録・照会と必要なSSM参照を担当する。

既存Dynamo属性・GSIとbatch環境変数は維持。job/attempt/state・削除lockを必要なレコードにだけ追加し、履歴テーブルは作らない。新 attempt のS3 keyは固有directoryにして遅延イベントを区別する。削除は完了通知で現物のS3キーを確定した `complete` の「S3キー＋登録情報」のみ。`init` はBatch FAILEDでも拒否し、遅延通知や拡張子付き実体の照合を待つ。Batch cancelやS3旧version全消去は含まない。
曖昧なsubmit・部分削除はlock/stateを保持して照合待ち。job IDのない旧initレコードを自動で失敗と判断・再投入しない。

## 残る制約

AWS実データでの照合・機能検証は未実施。既存本番を新runtime/APIへ切り替えるにはlive source/layer/job/trigger・認証・追加属性/IAM条件の確認が必要。
YouTubeと既存形式のその他URL登録を実装。旧Twitter/tweepy契約は未移植で422を返す。Scrapboxは既存の上限25ページを維持し、新実装のUser-Agentを設定するがliveと完全一致とは主張しない。
一覧とretryはboundedな1ページで、履歴・全件巡回・job ID不明の復旧は未実装。旧route/レスポンス互換adapterとfrontend型生成・新クライアントへの切替も未実装。
実環境名・ARN・account ID・credentialsは環境から設定し、source/生成OpenAPIへ含めない。設定名の例は [.env.example](.env.example)。旧履歴の公開ブロッカーは root の [migration.md](../docs/migration.md) を参照。

検証（entrypoints 分離ブランチ）: Python 3.14.8 で pytest 40件・Ruff・OpenAPI 再生成差分なしを確認。event 系 handler が FastAPI/Starlette/Mangum を読み込まないこと、API 系が自分のリソースだけを公開することをテストで固定した。Linux 向け ZIP の組み立てと ZIP 内 handler import は Linux 専用のため CI（backend-package）で確認する。分離前に確認していた Uvicorn HTTP・公式 Lambda image・pip check は本ブランチで再実施していない。AWS実動や旧Twitter移植の成功とは区別する。
