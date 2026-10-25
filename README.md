# YouTube Backup

YouTube などの動画 URL を登録すると yt-dlp で S3 へバックアップし、Web から一覧・検索・再生・削除できるサービス。Scrapbox のページに貼られた動画も毎時巡回して自動登録する。

| 配置 | 内容 | 配布先 |
|---|---|---|
| [frontend/](frontend/) | Vite / React / TypeScript の Web アプリ（Cognito ログイン） | Amplify Hosting |
| [backend/](backend/) | FastAPI の API とイベント処理。詳細は [backend/README.md](backend/README.md) | Lambda 5 関数（共通 ZIP） |
| [batch/](batch/) | yt-dlp でダウンロードして S3 へ置くジョブのイメージ | ECR `youtube-downloader-ytdlp` |
| [openapi/](openapi/) | backend から生成した API 定義 | — |

AWS リソース・IAM・Lambda の設定（handler・環境変数・role）は [hiroki1117/infra](https://github.com/hiroki1117/infra/tree/main/youtube-backup) が管理し、このリポジトリはコードとイメージだけを扱う。

## セットアップ

Node 24 LTS（[frontend/.node-version](frontend/.node-version)）と pnpm、Python 3.14、Make が必要。Docker は batch image をローカルで build するときだけ使う。

```bash
make install                           # frontend + backend の依存
cp frontend/.env.example frontend/.env # API・Cognito の公開設定値
pnpm --dir frontend dev
```

`VITE_*` はブラウザへ公開されるため秘密値を入れない。backend のローカル起動は [backend/README.md](backend/README.md) を参照。

## 検証と build

```bash
make check # frontend の型・lint・format・テスト、backend の Ruff・pytest、batch の構文
make build # frontend と Storybook
```

部分ごとにも実行できる（`pnpm --dir frontend test`、`make -C backend check`、`make -C batch build` など）。Storybook は `pnpm --dir frontend storybook`。

### 開発ドキュメント（Pages 公開準備）

```bash
pnpm --dir frontend build-storybook
node scripts/build-docs.mjs
python -m http.server 8000 --directory build/docs
```

`http://localhost:8000/` に Storybook と読取専用 OpenAPI リファレンスの入口を生成する。OpenAPI の原本は [openapi/openapi.json](openapi/openapi.json)。backend を変更したら `make -C backend export` で更新する。Pages のリポジトリサブパスにも対応し、Storybook の MSW worker は自身と同じディレクトリから取得する。

[Documentation workflow](.github/workflows/docs.yml) は PR・main 更新で再生成し、Pages 用 artifact を保存する。push だけでは公開しない。公開承認後、管理者が Pages の Source を GitHub Actions に設定し、公開範囲・履歴と生成物・`github-pages` Environment の保護を確認してから、main に対して `workflow_dispatch` の `publish=true` を実行する。想定入口は `https://hiroki1117.github.io/youtube-backup-v2/`（未公開）。設定変更と初回公開は別途承認が必要。

生成対象は Storybook・OpenAPI JSON・静的 HTML のみ。実 `VITE_*` や secrets を注入せず、Storybook は合成認証と MSW を使う。OpenAPI ページは外部ライブラリや API 実行機能を持たない。

frontend の入口は画面が [src/app/](frontend/src/app/)、API 呼び出しが [src/api/](frontend/src/api/)、ドメイン型が [src/types/](frontend/src/types/)。レイヤは `components → hooks → api → types`。

## 配布

main への push で、変更のあった部分だけが production Environment の OIDC ロールで配布される。

| 部分 | workflow | 配布先 |
|---|---|---|
| frontend | [deploy-frontend.yml](.github/workflows/deploy-frontend.yml) | Amplify Hosting（`frontend/dist/`） |
| backend | [deploy-backend.yml](.github/workflows/deploy-backend.yml) | Lambda 5 関数のコード更新と version 発行 |
| batch | [deploy-batch.yml](.github/workflows/deploy-batch.yml) | ECR（`latest` と commit SHA。ジョブ定義は `latest` を参照） |

workflow が使う設定: secrets `AWS_LAMBDA_DEPLOY_ROLE_ARN`・`AWS_FRONTEND_DEPLOY_ROLE_ARN`・`AWS_BATCH_DEPLOY_ROLE_ARN`、variables `AWS_REGION`・`AMPLIFY_APP_ID`・`VITE_*`。値は infra の Terraform output から取得する。

リソース名・account ID などの実環境の値はコードに書かず、環境変数で渡す。ただし過去の Git 履歴には残っているため、リポジトリを公開する前に履歴を確認すること。
