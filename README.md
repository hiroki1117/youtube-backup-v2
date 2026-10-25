# YouTube Backup

動画 URL を登録すると yt-dlp で S3 へバックアップし、Web から一覧・検索・再生・削除できるサービス。Scrapbox のページに貼られた動画も毎時巡回して自動登録する。

| 配置 | 内容 | 配布先 |
|---|---|---|
| [frontend/](frontend/) | Vite / React / TypeScript（Cognito ログイン） | Amplify Hosting |
| [backend/](backend/) | FastAPI の API とイベント処理（[詳細](backend/README.md)） | Lambda 7 関数（共通 ZIP） |
| [batch/](batch/) | yt-dlp で S3 へ置くジョブ（`scripts/yt-dlp-script`）と、YouTube のコメントだけを取得するジョブ（`scripts/youtube-comments`）のイメージ | ECR `youtube-downloader-ytdlp`・`youtube-backup-comments-youtube` |
| [openapi/](openapi/) | backend から生成した API 定義 | — |

AWS リソース・IAM・Lambda 設定は [infra](https://github.com/hiroki1117/infra/tree/main/youtube-backup) が管理し、このリポジトリはコードとイメージだけを扱う。

## 公開ドキュメント

| リンク | 確認できること |
|---|---|
| [ドキュメント入口](https://hiroki1117.github.io/youtube-backup-v2/) | Storybook と OpenAPI への案内 |
| [Storybook](https://hiroki1117.github.io/youtube-backup-v2/storybook/) | 合成データによる画面・状態の例 |
| [OpenAPI](https://hiroki1117.github.io/youtube-backup-v2/openapi/) | API のエンドポイントと入出力仕様 |

## セットアップ

必要なもの: [mise](https://mise.jdx.dev)（Node・pnpm・Python を [mise.toml](mise.toml) で固定）、Git 2.32 以上。Docker は batch image をローカルで build するときだけ。

```bash
mise trust && mise install
mise run install                       # frontend + backend の依存
cp frontend/.env.example frontend/.env # 公開設定値のみ。秘密値は入れない
mise run dev                           # frontend の開発サーバー
```

- `mise run <タスク>` なら PATH 設定は不要。シェルで `pnpm` / `python` を直接使うなら `mise activate`（Windows は `%LOCALAPPDATA%\mise\shims` を PATH に追加）。
- backend のローカル起動は [backend/README.md](backend/README.md)。

## 検証

```bash
mise run check     # frontend の型・lint・format・テスト、backend の Ruff・pytest
mise run storybook # http://localhost:6006
make build         # frontend と Storybook
```

`make` は `.venv/bin/python` 前提のため Windows では使えない。

## 開発ドキュメント（GitHub Pages）

```bash
pnpm --dir frontend build-storybook
pnpm --dir docs/site install --frozen-lockfile --ignore-scripts
node docs/site/build.mjs   # build/docs に Storybook と OpenAPI リファレンスを生成
python -m http.server 8000 --directory build/docs
```

- `http://localhost:8000/` で確認できる。Pages のリポジトリサブパスにも対応し、Storybook の MSW worker は自身と同じディレクトリから取得する。
- [docs.yml](.github/workflows/docs.yml): PR は build と artifact 保存。対象パスの main 更新で同じ artifact を Pages へ自動公開（公開元は GitHub Actions、生成物は `build/docs/`）。
- 手動実行は既定の `publish=false` なら build のみ。`publish=true`（main のみ）で再 build 成功後に再公開。
- 実 `VITE_*`・secrets は使わず、Storybook は合成認証と MSW を使う。OpenAPI は自前配信の Redoc CE で表示し、API の実行機能は持たない。
- OpenAPI の原本は [openapi/openapi.json](openapi/openapi.json)。backend 変更後は `make -C backend export` で更新。

## 依存ライブラリの継続更新

[Dependabot](.github/dependabot.yml) が毎週月曜 09:00（Asia/Tokyo）に frontend・Redoc ドキュメント（pnpm）、backend（pip）、batch（yt-dlp・awscli と Docker ベースイメージ）、GitHub Actions を確認する。minor/patch は更新設定ごとにまとめ、major は個別 PR にする。未完了の version update PR は各更新設定で最大 3 件。自動 merge は行わず、CI と差分を確認してから merge する。

backend の固定依存は `backend/requirements.txt`（旧 `requirements.lock`）で、CI の制約と Lambda ZIP のインストールに同じファイルを使う。`pyproject.toml` と合わせてレビューする。frontend は `package.json` と `pnpm-lock.yaml` を同じ PR で更新する。PR の CI は secrets 不要で実行され、main への merge 後は変更された領域の既存 production 配布 workflow が動く（CI の完了を待つ構成ではない）。batch 更新 PR は secrets を使わず Docker image の build とツール起動を CI で確認する。

batch の yt-dlp・awscli は各イメージの `requirements.txt`（`batch/scripts/yt-dlp-script/`・`batch/scripts/youtube-comments/`）で管理する。apt パッケージや Deno インストーラー、mise の Node/Python/pnpm 固定値はこの設定では更新されない。これらは base image 更新時に確認し、ツール更新時は mise・`.node-version`・`packageManager`・CI の指定を同じ PR で揃える。Dependabot alerts / security updates は GitHub 側の別設定。実際の更新ジョブは設定が default branch に入ってから確認する。Redoc は `/docs/site` の独立した `package.json` と `pnpm-lock.yaml` を対象にする。

## 配布

main への push で、変更のあった部分だけが production Environment の OIDC ロールで配布される。

| 部分 | workflow | 配布先 |
|---|---|---|
| frontend | [deploy-frontend.yml](.github/workflows/deploy-frontend.yml) | Amplify Hosting |
| backend | [deploy-backend.yml](.github/workflows/deploy-backend.yml) | Lambda 7 関数のコード更新と version 発行 |
| batch | [deploy-batch.yml](.github/workflows/deploy-batch.yml)・[deploy-batch-youtube-comments.yml](.github/workflows/deploy-batch-youtube-comments.yml) | ECR（`latest` と commit SHA） |

- secrets: `AWS_LAMBDA_DEPLOY_ROLE_ARN`・`AWS_FRONTEND_DEPLOY_ROLE_ARN`・`AWS_BATCH_DEPLOY_ROLE_ARN`
- variables: `AWS_REGION`・`AMPLIFY_APP_ID`・`VITE_*`
- 値は infra の Terraform output から取得する。実環境の値はコードに書かない（過去の履歴には残っているため、公開前に確認する）。
