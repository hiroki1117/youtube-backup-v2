# 所有境界と切替条件

## 現在の根拠

- frontend 移動元: `youtube-backup-front-v2@721ed65a95f97320b1eff7142a23f4d7bdf64801`。
- backend / batch 移管元: [source-manifest.json](source-manifest.json) の `youtube-backup` commit。移管時は内容を変更せずコピーし、LICENSE を各部分へ同梱した。公開安全性のため、その後の変更で保守scriptの固定table名を環境変数へ置換した。新しい配布元として有効化していない。
- `youtube_backup2@ba09a86` は storage / IAM 等の Terraform、旧 front `ef24fa6` は CRA。名称の似た repo をアプリ正本と扱わない。
- 依頼時の運用情報: infra `youtube-backup/prod` へ基盤48件の state 統合済み。旧 Lambda9 / API / 通知は旧管理のまま稼働維持。本作業で AWS/state の再監査はしていない。
- infra の取得済み main `e89f75c` にある [監査資料](https://github.com/hiroki1117/infra/blob/e89f75c/docs/youtube-backup-ownership.md) は以前の段階の記録。state と live hash の差は submit/retry/scrapbox の3件、他6件は state hash のみ一致。これは旧 source と live の一致を証明しない。最新運用情報を過去資料で上書きしない。
- 依頼時の追加情報: scrapbox live に User-Agent 追加あり。他6件も旧 source との比較が未完了。本コピーに live 修正を推測で足していない。

## アプリと infra の契約

| 領域                                                   | 所有・配布                                                                                           |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| frontend source / dist                                 | app repo。deploy-frontend.yml が Amplify Hosting へ配布                                              |
| Lambda source / 候補 ZIP                               | app repo に保全。旧 Terraform は source_dir を ZIP 化していた。候補 ZIP は依存未同梱で本番配布しない |
| Lambda runtime / layer / env参照 / IAM / trigger / API | infra 側の管理範囲。旧管理からの移行は未完了。code 更新の唯一の所有者も切替前に確定する              |
| Dockerfile / script / image build                      | app source に保全。現在の ECR push は旧 youtube-backup の youtubedl_build / ytdlp_build のみ         |
| ECR / Batch compute・queue・job definition / image参照 | infra。現在 `latest` 参照。SHA タグの存在だけで digest 固定済みとは扱わない                          |
| CDK scaffold                                           | この repo の infra/ に保全。live S3/CloudFront との対応と所有者は未確認                              |

Lambda 全9件は `main.lambda_handler`、旧定義では python3.8。boto3 は runtime、submit の tweepy は外部 Klayers に依存し、旧 ZIP は vendor 工程なし。
Python 3 の AST 検査は本番 runtime・layer・SSM・IAM・API 動作の検証ではない。
API YAML / Batch definition / Terraform はこの app repo に重複定義しない。

## 段階と検証・切戻し

1. 今回: frontend 移動と CI パス修正、旧 source の出所付き保全、独立したローカル検証。旧 repo / 本番配布元は維持。
2. 配布準備: 承認された読み取りで9 Lambda の live ZIP / CodeSha256 / runtime / layer / env参照・trigger を記録し、ファイル単位で source と比較。秘密値を保存しない。submit/retry/scrapbox の差分原因と他6件の同一性を確定し、必要な live 修正を別 commit で採用する。
3. 再現性: 検証済み source から依存・runtime を保つ immutable ZIP を作成して hash を記録。Batch は稼働 image digest・元 commit・job revision を記録。upload / whisper / 保守 script の利用者と実行経路は未確認。
4. 切替前: API の一覧/登録/取得/削除/更新/署名 URL、S3完了通知、Scrapbox定期処理、再投入、Batch download を隔離環境・承認された手順で確認。旧配布元と新配布元の二重更新を防ぐため、切替担当と旧 CI 停止・再開手順を合意してから新 workflow を有効化する。
5. 切替後: 同じ確認を行う。異常時は記録済み live ZIP / layer / env契約・image digest / job revision へ戻す。未照合の旧 source を切戻し artifact に使わない。state は別の infra 復旧手順に従う。

frontend は切替前の dist と配布設定を保持し、不具合時は承認後に前回成果物を再配布する。ディレクトリ整備だけの rollback は変更 commit の revert で対応する（main merge は既存 deploy を起動するため別承認）。

改名時は remote、workflow参照、Actions環境/Variables/Secrets、OIDC の実際の `sub`（production environment 使用時は environment 形式）、branch protection / required checks、webhook / 外部連携・文書 URL を確認する。この作業では変更しない。
CDK は stack/resource/state と infra 定義の対応を確認後に移管または整理し、確認前の deploy / destroy / 削除はしない。

## 既知の制約

`youtube-upload-script/main.sh` は `#!/bin/sh` だが bash 配列を使用する。構文検査は bash で行い、POSIX sh での実行成功とは扱わない。
同 Dockerfile の pip install 引数や古い base image / 依存も移管元のまま。upload / whisper の build・実稼働確認は未完了。
外部サイトから取得する Deno / Whisper 等は完全固定ではない。挙動修正・依存固定化は別段階で扱う。

## このブランチの検証（2026-10-12）

- README の `make install` / `make check` を repo 直下から確認。pnpm 10.34.5 の frozen install、Node 20.20.2 の型検査・lint・format・223 tests / 32 files が成功。line coverage 95.99%。lint の既存 warning は6件。
- ダミー構成値で frontend dev server の起動・HTTP200・Vite client/entry の応答を確認。本番認証/API疎通は未実施。
- Vite / Storybook build が成功。既存の bundle size warning あり。
- Lambda9件と batch Python の AST、download / whisper の sh 構文、upload の bash 構文が成功。Lambda 候補 ZIP9件の内容も source と一致。
- 旧ソースの末尾空白も内容保全のため維持。移管ファイル以外の `git diff --check` は成功。
- 移管元 commit / SHA256、初期整備時の frontend source と lockfile の無変更、workflow YAML・参照パス、既存 trigger / deploy 設定の保持を確認。
- yt-dlp Docker build は未成功。下記の追加切り分けを参照。その他 image の build / AWS実行は未実施。
- Node 24.19.0 では既存テストの AbortSignal / Request 互換エラーで5件失敗。CI の Node20 では全件成功。Node24対応は本整備の検証済み範囲外。
- GitHub Actions の実行、prod deploy、AWS/state/IAM/secret 変更、repo 改名、PR/main merge、Project board 更新は実施していない。

## 追加の読み取り確認（2026-10-12）

Batch build は Dockerfile の最初の RUN (`pip install --upgrade pip` / `yt-dlp[default]==2026.8.19`) で `https://pypi.org/simple/pip/` と `/simple/yt-dlp/` に接続できず、`[Errno 101] Network is unreachable`。Docker Hub の base image 取得は成功していた。既存の HTTP(S) proxy を Docker の標準 build-arg で渡すと接続は進み、proxy の CA が container 内で信頼されず `CERTIFICATE_VERIFY_FAILED: self-signed certificate in certificate chain` になった。TLS検証の無効化・別経路への迂回は行っていない。

同じ許可済み proxy と既存 CA を使用する host では PyPI への HTTPS が成功し、Python3.12 用の `pip download --only-binary=:all: 'yt-dlp[default]==2026.8.19' awscli==1.32.0` で依存全体の解決・取得が成功した。版が存在しないことによる失敗ではない。image build の完了には、許可済み proxy / CA を通常の検証付きで利用できる build 環境が必要。取得物は一時ディレクトリのみで app/旧source/本番image に変更を加えていない。

CDK は基盤導入 commit `be3a2f1` から scaffold と説明され、`infra/bin/app.ts` の stack 名は `YoutubeBackupFrontV2`。workflow / Make / frontend package から CDK の呼び出しはなく、deploy は Actions Variables の配布先を使用する。実デプロイ・所有の根拠は確認できず、未デプロイとも断定しない。既存 main の [最新 deploy run](https://github.com/hiroki1117/youtube-backup-front-v2/actions/runs/36311709384) は移動前 commit `721ed65` の実行で `Configure AWS credentials (OIDC)` が失敗。直近5 runも失敗しており、本変更を本番配布成功の根拠にはしない。

既存環境認証で STS identity は成功したが、Lambda `ListFunctions`、CloudFormation `ListStacks` と指定 stack の `DescribeStackResources` は AccessDenied。GitHub Actions Variables の取得も integration 権限で HTTP403。秘密値を返す Lambda configuration API は使用せず、追加 credential / AssumeRole / 権限拡張も行っていない。このため live Lambda source/hash・CDK所有・実配布先の照合は未完了。

参照レビューでは、pnpm action v6 の `package_json_file` input の存在、frontend 内の alias / env / Storybook / components 設定、CIの cwd / cache / artifact、Husky・Dependabot の変更を確認し、追加の参照漏れは見つからなかった。

PR は「配布を切り替えない初期整備」としてレビューできる状態。PR作成には別の許可が必要で、作成後は既存CIの実行結果を確認する。main merge は既存 frontend deploy を起動するため、実配布先・OIDC等の確認と別承認が必要。live照合、唯一の配布所有者、旧CIとの切替、CDK所有確認は、本番切替と Issue #41 全体完了に向けた必須事項として残る。

## 新backend実装候補・公開安全性

`feat/fastapi-backend` では [backend/README.md](../backend/README.md) の新API・イベント入口を追加。旧sourceと新runtimeの同一性や本番切替を意味しない。OpenAPIは新FastAPI routerから生成し、旧infra側API YAMLは旧契約の保全資料として扱う。

public設定を読み取り確認。旧履歴の `src/api/client.test.ts`、`src/test/factories.ts`、`src/test/handlers.ts`、`src/types/video.test.ts` に環境由来と見られるS3参照、`batch/scripts/workaroundscript/update_init2complete.py` に固定table名、`docs/migration.md` に実認証主体名がある。現在ツリーの固定table/SSM名・認証主体名は環境変数化または除去し、テスト構成は明確なダミーにした。元SHAと公開向け変更後SHAは既存source manifestで区別する。

限定パターン検査ではaccount ID・access key・秘密鍵・署名URLのliteralは検出していないが、全秘密情報の不存在を保証しない。履歴の修正/force push・公開設定変更・credential失効は行っていない。通常commitで旧履歴は消えないため、履歴の公開レビューと必要な対処の別承認が残る。

履歴範囲: 旧 `src/` の4 test/fixtureパスは `742711f` に固定S3参照があり、集約前main基点 `721ed65` の祖先（元front由来）。保守scriptのtable/S3参照は `7e0ae72` で旧repoから集約して追加、文書の主体名は `dcdf3c3` の監査追記で追加し `be3a991` にも残る。後2件は公開済み `chore/app-repository-foundation` と、それを継承する `feat/fastapi-backend` の履歴に含まれる。検査対象はローカルで取得済みの到達可能履歴であり、未取得remote refs・外部infra/旧repo・削除済みblob・Actionsログ等は完全監査していない。検出したものは識別情報で、認証情報の漏洩を検出したという意味ではない。値そのものは文書・検査出力へ再掲しない。

追加レビューでSSM名の数字を含む項目の置換漏れを確認し、submit/retryの保管ソースを修正した。以前の限定検査だけでは完全除去を確認できていなかったため、既知のSSM prefixを持つliteralを保管Python全体でAST確認した。公開済み `29c8a56` にもこの固定参照が残り、その履歴の対処は未承認。値は再掲しない。

削除レビューでは、拡張子なしのplaceholderを削除しても upload済み実体が残る競合をfakeで再現した。新APIは `init` をBatch FAILEDでも削除せず409とし、完了通知で現物pathを確定するまで保持する。Repositoryの削除lockにも `upload_status=complete` 条件を追加した。現物が不明なケースの削除成功やAWS実データの無残存は検証済みと扱わない。実行appの自動docs/OpenAPI HTTP入口は無効化し、offline exportは維持する。
