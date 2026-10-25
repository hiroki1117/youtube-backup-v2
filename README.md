# YouTube Backup

YouTube などの動画 URL を登録すると yt-dlp で S3 へバックアップし、Web から一覧・検索・再生・削除できるサービス。Scrapbox のページに貼られた動画も毎時巡回して自動登録する。

| 配置 | 内容 | 配布先 |
|---|---|---|
| [frontend/](frontend/) | Vite / React / TypeScript の Web アプリ（Cognito ログイン） | Amplify Hosting |
| [backend/](backend/) | FastAPI の API とイベント処理。詳細は [backend/README.md](backend/README.md) | Lambda 5 関数（共通 ZIP） |
| [batch/](batch/) | yt-dlp でダウンロードして S3 へ置くジョブのイメージ | ECR `youtube-downloader-ytdlp` |
| [openapi/](openapi/) | backend から生成した API 定義 | — |

AWS リソース・IAM・Lambda の設定（handler・環境変数・role）は [hiroki1117/infra](https://github.com/hiroki1117/infra/tree/main/youtube-backup) が管理し、このリポジトリはコードとイメージだけを扱う。

## 公開ドキュメント

| リンク | 確認できること |
|---|---|
| [ドキュメント入口](https://hiroki1117.github.io/youtube-backup-v2/) | Storybook と OpenAPI への案内 |
| [Storybook](https://hiroki1117.github.io/youtube-backup-v2/storybook/) | 合成データによる画面・状態の例 |
| [OpenAPI](https://hiroki1117.github.io/youtube-backup-v2/openapi/) | API のエンドポイントと入出力仕様 |

## セットアップ

Node・pnpm・Python のバージョンは [mise](https://mise.jdx.dev) で固定している（[mise.toml](mise.toml)）。Mac・Linux・Windows で同じ手順になる。必要なのは Git 2.32 以上（pre-commit の lint-staged が要求）と mise。Docker は batch image をローカルで build するときだけ使う。

```bash
mise install                           # Node / pnpm / Python を mise.toml どおりに入れる
mise run install                       # frontend + backend の依存（backend/.venv を自動作成）
cp frontend/.env.example frontend/.env # API・Cognito の公開設定値（Windows は copy でも可）
mise run dev                           # frontend の開発サーバー
```

初回は `mise trust` で `mise.toml` を信頼する。`VITE_*` はブラウザへ公開されるため秘密値を入れない。backend のローカル起動は [backend/README.md](backend/README.md) を参照。

mise の入れ方: Mac は `brew install mise`、Windows は `winget install jdx.mise`。そのあと、シェルで `pnpm` や `python` を直接使うには PATH に通す必要がある（`mise activate`）。Windows の PowerShell 5.1 では `activate` がユーザー名に日本語を含むと文字化けするため、`%LOCALAPPDATA%\mise\shims` をユーザー PATH に追加する方式（`mise reshim` を併用）を勧める。`mise run <タスク>` だけなら PATH の設定は不要。`make` を使う従来の手順（Python 3.14 と pnpm を自分で用意する）も引き続き使えるが、Makefile は `.venv/bin/python` を前提とするため Windows では使えない。

## 検証と build

```bash
mise run check # frontend の型・lint・format・テスト、backend の Ruff・pytest
make check     # 上に加えて batch の構文検査（sh が必要）
make build     # frontend と Storybook
mise run storybook # Storybook（http://localhost:6006）
```

部分ごとにも実行できる（`pnpm --dir frontend test`、`make -C backend check`、`make -C batch build` など）。Storybook は `pnpm --dir frontend storybook`。

### ドキュメントの生成・公開

```bash
pnpm --dir frontend build-storybook
pnpm --dir docs/site install --frozen-lockfile --ignore-scripts
node docs/site/build.mjs
python -m http.server 8000 --directory build/docs
```

`http://localhost:8000/` に Storybook と読取専用 OpenAPI リファレンスの入口を生成する。OpenAPI の原本は [openapi/openapi.json](openapi/openapi.json)。backend を変更したら `make -C backend export` で更新する。Pages のリポジトリサブパスにも対応し、Storybook の MSW worker は自身と同じディレクトリから取得する。

[Documentation workflow](.github/workflows/docs.yml) は PR で build と artifact の保存を行い、対象パスの main 更新では build 成功後に同じ artifact を Pages へ自動公開する。公開元は GitHub Actions、生成物は `build/docs/`。

手動の `workflow_dispatch` は既定の `publish=false` なら build のみ。main で `publish=true` を指定すると、再 build に成功した artifact を再公開する。main 以外のブランチや PR からは公開しない。

サイトの組み立ては [docs/site/build.mjs](docs/site/build.mjs) が担当する。生成対象は Storybook・OpenAPI JSON・静的 HTML のみ。実 `VITE_*` や secrets を注入せず、Storybook は合成認証と MSW を使う。OpenAPI は自前配信の Redoc CE で表示し、API の実行機能は持たない。

frontend の入口は画面が [src/app/](frontend/src/app/)、API 呼び出しが [src/api/](frontend/src/api/)、ドメイン型が [src/types/](frontend/src/types/)。レイヤは `components → hooks → api → types`。

## 依存ライブラリの継続更新

[Dependabot](.github/dependabot.yml) が毎週月曜 09:00（Asia/Tokyo）に frontend・Redoc ドキュメント（pnpm）、backend（pip）、batch（yt-dlp・awscli と Docker ベースイメージ）、GitHub Actions を確認する。minor/patch は ecosystem ごとにまとめ、major は個別 PR にする。未完了の version update PR は各 ecosystem 最大 3 件。自動 merge は行わず、CI と差分を確認してから merge する。

backend の固定依存は `backend/requirements.txt`（旧 `requirements.lock`）で、CI の制約と Lambda ZIP のインストールに同じファイルを使う。`pyproject.toml` と合わせてレビューする。frontend は `package.json` と `pnpm-lock.yaml` を同じ PR で更新する。PR の CI は secrets 不要で実行され、main への merge 後は変更された領域の既存 production 配布 workflow が動く（CI の完了を待つ構成ではない）。batch 更新 PR は secrets を使わず Docker image の build とツール起動を CI で確認する。

batch の yt-dlp・awscli は `batch/scripts/yt-dlp-script/requirements.txt` で管理する。apt パッケージや Deno インストーラー、mise の Node/Python/pnpm 固定値はこの設定では更新されない。これらは base image 更新時に確認し、ツール更新時は mise・`.node-version`・`packageManager`・CI の指定を同じ PR で揃える。Dependabot alerts / security updates は GitHub 側の別設定。実際の更新ジョブは設定が default branch に入ってから確認する。Redoc は `/docs/site` の独立した `package.json` と `pnpm-lock.yaml` を対象にする。

## 配布

main への push で、変更のあった部分だけが production Environment の OIDC ロールで配布される。

| 部分 | workflow | 配布先 |
|---|---|---|
| frontend | [deploy-frontend.yml](.github/workflows/deploy-frontend.yml) | Amplify Hosting（`frontend/dist/`） |
| backend | [deploy-backend.yml](.github/workflows/deploy-backend.yml) | Lambda 5 関数のコード更新と version 発行 |
| batch | [deploy-batch.yml](.github/workflows/deploy-batch.yml) | ECR（`latest` と commit SHA。ジョブ定義は `latest` を参照） |

workflow が使う設定: secrets `AWS_LAMBDA_DEPLOY_ROLE_ARN`・`AWS_FRONTEND_DEPLOY_ROLE_ARN`・`AWS_BATCH_DEPLOY_ROLE_ARN`、variables `AWS_REGION`・`AMPLIFY_APP_ID`・`VITE_*`。値は infra の Terraform output から取得する。

リソース名・account ID などの実環境の値はコードに書かず、環境変数で渡す。ただし過去の Git 履歴には残っているため、リポジトリを公開する前に履歴を確認すること。
