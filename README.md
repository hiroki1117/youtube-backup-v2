# YouTube Backup

frontend・backend（Lambda）・batch を1つの repo で変更・検証し、各部分の独立した build / deploy を維持するための初期整備。
現在の repo 名は `youtube-backup-v2`（旧名 `youtube-backup-front-v2`）。
[Issue #41](https://github.com/hiroki1117/projects/issues/41) の移行途中で、本番のコード一致・配布切替は未完了。

| 配置                               | 役割と現在の配布元                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [frontend/](frontend/)             | Vite / React / TypeScript アプリ。既存の [deploy.yml](.github/workflows/deploy.yml) が S3 / CloudFront へ配布 |
| [backend/lambda/](backend/lambda/) | FastAPI 実装候補と旧ソース保全。詳細は [backend/README.md](backend/README.md)。本番未切替                     |
| [batch/scripts/](batch/scripts/)   | download / upload / whisper / 保守スクリプトを保全。image push は旧 `youtube-backup` の CI が継続             |
| [infra/](infra/)                   | 既存 CDK scaffold。実所有の確認前に適用・削除しない                                                           |

AWS 定義・state の管理先は [hiroki1117/infra](https://github.com/hiroki1117/infra)。
app は source・成果物作成・Lambdaコード配布、infra は関数/API等の土台と環境/IAM設定を担当する。
`youtube_backup2` はインフラ用、`youtube-backup-front` は旧 CRA 実装で、今回のアプリ移管元ではない。
出所は [source-manifest.json](docs/source-manifest.json)、境界・制約・切替条件は [migration.md](docs/migration.md) を参照。

## v2 Lambda の初回配布準備

Issue #43 の第1段階は、旧API・通知・定期イベントに接続しない専用5関数の準備。
[初回配布契約と直接invoke手順](docs/lambda-v2-deployment.md) に成果物・handler・環境・権限・app/infraの責任を記載した。
各ZIPはmanifest付きで検証し、AWS入口は既定で `validation` モード。固定の疎通入力以外は拒否する。
[手動backend配布CI](.github/workflows/deploy-backend.yml) はコード更新・hash照合・version発行を担当し、初回のみ選択した限定invokeを行う。
実AWSへの配布・invokeとIAM変更は未実施。Batch/frontend切替は次段階。

## セットアップと起動

Node / pnpm の要件・固定版と全コマンドは [frontend/package.json](frontend/package.json)、検証する Node は [CI](.github/workflows/ci.yml) を参照。
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
make -C backend package FUNCTION=video # 検証用 ZIP。本番配布なし
make -C batch check
make -C batch build IMAGE=yt-dlp-script TAG=youtube-backup-candidate:local
```

frontend の既存テスト・型・lint・format、Vite / Storybook build、新 backend の pytest・Ruff・ローカルHTTP・依存同梱ZIPと handler import、batch の構文を確認。
batch image build と AWS 上の機能検証は未完了。詳細な検証結果と環境制約は [migration.md](docs/migration.md)。
frontend の機能・画面は [src/app/](frontend/src/app/)、API境界は [src/api/](frontend/src/api/)、ドメイン型は [src/types/](frontend/src/types/) が入口。
レイヤは `components → hooks → api → types`。Storybook は `pnpm --dir frontend storybook`、設定は [.storybook/](frontend/.storybook/)。

## 配布と残る制約

既存 frontend deploy の trigger・production environment・OIDC を維持し、実行パスを frontend に変更した。
配布対象は `frontend/dist/` のみ。既存 main の最新 deploy は OIDC credential 設定で失敗しており、実配布先の確認も権限不足で未完了。
main merge は既存 deploy を起動するため、配布設定の確認と別承認が必要。

backendはmain上の手動workflowのみを用意した。実行には専用OIDC設定と別承認が必要。batch の新しい本番 workflow は追加していない。旧 CI が image の SHA / `latest` を push し、infra が `latest` を参照する間、同じ ECR へ二重配布しない。
Lambda live source / runtime / layer の照合、配布所有者・旧CI切替、CDK所有、改名時の OIDC / 外部連携整合が残る。
repo 改名・PR / merge・deploy・AWS / state / IAM / secret 変更・既存CI停止/起動は今回実施していない。
Lambdalith 化、runtime / 依存更新、image digest 固定化は別段階。

公開前提: 現在ツリーの実環境参照は環境変数化したが、旧Git履歴に固定resource名・認証主体名等が残る。公開安全性の履歴レビュー・承認された対処が必要。新APIの詳細・未移植機能は backend README を参照。
