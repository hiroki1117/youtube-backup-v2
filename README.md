# YouTube Backup

frontend・backend（Lambda）・batch を1つの repo で変更・検証し、各部分を独立して build / deploy する。

| 配置                               | 役割と現在の配布元                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [frontend/](frontend/)             | Vite / React / TypeScript アプリ。[deploy-frontend.yml](.github/workflows/deploy-frontend.yml) が Amplify Hosting へ配布 |
| [backend/](backend/)             | FastAPI 実装。[deploy-backend.yml](.github/workflows/deploy-backend.yml) が Lambda へ配布。詳細は [backend/README.md](backend/README.md) |
| [batch/scripts/](batch/scripts/)   | yt-dlp image のスクリプト。main push で `deploy-batch.yml` が ECR へ push|

AWS 定義・state の管理先は [hiroki1117/infra](https://github.com/hiroki1117/infra)。
app は source と成果物作成、infra は AWS 設定と成果物参照を担当する。

## セットアップと起動

Node は24 LTSを使用し、CIと配布ビルドの固定版は [frontend/.node-version](frontend/.node-version) で共有する。Node / pnpm の要件と全コマンドは [frontend/package.json](frontend/package.json)、検証する Node は [CI](.github/workflows/ci.yml) を参照。
backend の Python 要件・セットアップは [backend/README.md](backend/README.md) を参照。Make、shell も使用する。Docker は batch image のローカル build に必要。
pnpm を用意した後、repo 直下で実行する（専用モノレポ framework は使用しない）。

```bash
make install # frontend + backend（Python要件を先に満たす）
cp frontend/.env.example frontend/.env # 公開構成値を設定
pnpm --dir frontend dev
```

環境変数の説明は [frontend/.env.example](frontend/.env.example)。`.env` は frontend 内から読み込む。
`VITE_*` はブラウザへ公開されるため秘密値を入れない。
開発サーバーの起動と HTTP 応答はダミー構成値で確認済み。本番認証・API 疎通は未確認。

## 検証・build

repo 全体の検証と frontend の成果物作成:

```bash
make check # frontend 品質検査、backend pytest/Ruff、batch 構文
make build # frontend と Storybook
```

各部分も独立して実行できる:

```bash
pnpm --dir frontend typecheck
pnpm --dir frontend test
pnpm --dir frontend build
make -C backend check
make -C backend package # 検証用 ZIP 1つ。本番配布なし
make -C batch check
make -C batch build IMAGE=yt-dlp-script TAG=youtube-backup-candidate:local
```

frontend の既存テスト・型・lint・format、Vite / Storybook build、新 backend の pytest・Ruff・ローカルHTTP・依存同梱ZIPと handler import、batch の構文を確認。
batch image build と AWS 上の機能検証は CI 上で確認する。
frontend の機能・画面は [src/app/](frontend/src/app/)、API境界は [src/api/](frontend/src/api/)、ドメイン型は [src/types/](frontend/src/types/) が入口。
レイヤは `components → hooks → api → types`。Storybook は `pnpm --dir frontend storybook`、設定は [.storybook/](frontend/.storybook/)。

## 配布

main への push で、変更のあった部分だけが production Environment の OIDC ロールで配布される。

| 部分 | workflow | 配布先 |
|---|---|---|
| frontend | [deploy-frontend.yml](.github/workflows/deploy-frontend.yml) | Amplify Hosting（`frontend/dist/`） |
| backend | [deploy-backend.yml](.github/workflows/deploy-backend.yml) | Lambda 5 関数（共通 ZIP） |
| batch | [deploy-batch.yml](.github/workflows/deploy-batch.yml) | ECR `youtube-downloader-ytdlp`（`latest` と commit SHA） |

AWS リソース・IAM・Lambda の設定は infra 側が所有し、各 workflow はコードとイメージだけを扱う。

公開前提: 現在ツリーの実環境参照は環境変数化したが、旧Git履歴に固定resource名・認証主体名等が残る。公開前に履歴レビューと承認された対処が必要。新APIの詳細・未移植機能は backend README を参照。
